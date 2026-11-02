package com.diasporum.backend.media.internal.application;

import com.diasporum.backend.media.internal.infrastructure.integration.storage.MediaProperties;
import com.diasporum.backend.media.internal.infrastructure.integration.storage.StorageClient;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Media upload lifecycle over {@code media_objects}. Storage ops go through
 * {@link StorageClient}; no R2/SDK types leave this module.
 * The DB row doubles as the upload session (PENDING_UPLOAD + TTL).
 */
@Service
public class MediaService {

    // M4: MESSAGE_IMAGE and MESSAGE_DOCUMENT added for direct-message attachments.
    private static final Map<String, List<String>> ALLOWED = Map.ofEntries(
            Map.entry("AVATAR", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("FEED_IMAGE", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("EVENT", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("JOB", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("VEHICLE", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("FEED_VIDEO", List.of("video/mp4", "video/quicktime")),
            Map.entry("MESSAGE_AUDIO", List.of("audio/mpeg", "audio/ogg", "audio/mp4")),
            Map.entry("DOCUMENT", List.of("application/pdf", "application/msword",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/vnd.ms-excel",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "application/vnd.ms-powerpoint",
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    "text/plain")),
            Map.entry("MESSAGE_IMAGE", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("MESSAGE_DOCUMENT", List.of("application/pdf", "application/msword",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/vnd.ms-excel",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "application/vnd.ms-powerpoint",
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    "text/plain")));
    private final JdbcTemplate jdbc;
    private final org.springframework.beans.factory.ObjectProvider<StorageClient>
            storageProvider;
    private final MediaProperties props;

    public MediaService(JdbcTemplate jdbc,
            org.springframework.beans.factory.ObjectProvider<StorageClient> storageProvider,
            MediaProperties props) {
        this.jdbc = jdbc;
        this.storageProvider = storageProvider;
        this.props = props;
    }

    /** Storage is optional — with R2 disabled the app still starts and media
     * endpoints answer 503 rather than breaking the whole context. */
    private StorageClient storage() {
        return storageProvider.getIfAvailable(() -> {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "MEDIA_STORAGE_DISABLED");
        });
    }

    public record AssetView(UUID id, UUID ownerId, String purpose, String status,
            String mimeType, Long sizeBytes, String detectedMimeType) {
    }

    private AssetView view(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new AssetView(rs.getObject("id", UUID.class),
                rs.getObject("owner_user_id", UUID.class),
                rs.getString("purpose"), rs.getString("status"),
                rs.getString("mime_type"), rs.getObject("size_bytes", Long.class),
                rs.getString("detected_mime_type"));
    }

    private static final String SELECT = "SELECT id,owner_user_id,purpose,"
            + "status::text,mime_type,size_bytes,detected_mime_type FROM media_objects";

    public Optional<AssetView> asset(UUID id) {
        return jdbc.query(SELECT + " WHERE id=?", this::view, id)
                .stream().findFirst();
    }

    public List<AssetView> assets(java.util.Collection<UUID> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        String ph = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        return jdbc.query(SELECT + " WHERE id IN (" + ph + ")",
                this::view, ids.toArray());
    }

    private AssetView requireAsset(UUID id) {
        return asset(id).orElseThrow(() -> new ResponseStatusException(
                HttpStatus.NOT_FOUND, "MEDIA_NOT_FOUND"));
    }

    private String keyFor(UUID owner, String purpose, UUID assetId) {
        return owner + "/" + purpose.toLowerCase() + "/" + assetId;
    }

    // ---- upload session ----

    public record InitResult(UUID assetId, String uploadUrl) {
    }

    @Transactional
    public InitResult initiate(UUID owner, String purpose, String mimeType,
            Long declaredSize) {
        var allowed = ALLOWED.get(purpose);
        if (allowed == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "UNSUPPORTED_PURPOSE");
        }
        if (!allowed.contains(mimeType)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "UNSUPPORTED_MIME_TYPE");
        }
        if (declaredSize != null && declaredSize > props.maxUploadBytes()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "FILE_TOO_LARGE");
        }
        UUID assetId = UUID.randomUUID();
        String key = keyFor(owner, purpose, assetId);
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                        + "object_key,purpose,mime_type) VALUES(?,?,?,?,?,?)",
                assetId, owner, props.bucket(), key, purpose, mimeType);
        return new InitResult(assetId,
                storage().presignPut(key, mimeType, props.uploadUrlTtl()));
    }

    @Transactional
    public AssetView complete(UUID owner, UUID assetId, Long declaredSize) {
        var a = requireAsset(assetId);
        if (!a.ownerId().equals(owner)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_OWNER");
        }
        if (!"PENDING_UPLOAD".equals(a.status())) {
            return a;                               // idempotent — already moved on
        }
        // session expiry
        Instant created = jdbc.queryForObject(
                "SELECT created_at FROM media_objects WHERE id=?", Instant.class, assetId);
        if (created != null && created.isBefore(
                Instant.now().minus(props.sessionTtl()))) {
            jdbc.update("UPDATE media_objects SET status='REJECTED',"
                    + " rejection_reason='upload_expired' WHERE id=?", assetId);
            throw new ResponseStatusException(HttpStatus.GONE, "UPLOAD_EXPIRED");
        }
        // verify actual stored object
        String key = jdbc.queryForObject(
                "SELECT object_key FROM media_objects WHERE id=?", String.class, assetId);
        var meta = storage().head(key).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "OBJECT_NOT_UPLOADED"));
        if (meta.sizeBytes() > props.maxUploadBytes()) {
            jdbc.update("UPDATE media_objects SET status='REJECTED',"
                    + " rejection_reason='size_exceeded' WHERE id=?", assetId);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "FILE_TOO_LARGE");
        }
        jdbc.update("UPDATE media_objects SET status='READY',"
                        + " size_bytes=?, detected_mime_type=?, uploaded_at=now()"
                        + " WHERE id=?",
                meta.sizeBytes(), meta.contentType(), assetId);
        return asset(assetId).orElseThrow();
    }

    public void cancel(UUID owner, UUID assetId) {
        var a = requireAsset(assetId);
        if (!a.ownerId().equals(owner)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_OWNER");
        }
        jdbc.update("DELETE FROM media_objects WHERE id=? AND status='PENDING_UPLOAD'",
                assetId);
    }

    // ---- access ----

    @Transactional
    public String downloadUrl(UUID requester, UUID assetId) {
        var a = requireAsset(assetId);
        if (!"READY".equals(a.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "MEDIA_NOT_READY");
        }
        if (!a.ownerId().equals(requester)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_OWNER");
        }
        String key = jdbc.queryForObject(
                "SELECT object_key FROM media_objects WHERE id=?", String.class, assetId);
        return storage().presignGet(key, props.downloadUrlTtl());
    }

    /** Cross-module authorized access — caller owns the parent-resource authz. */
    public String authorizedDownloadUrl(UUID assetId) {
        var a = requireAsset(assetId);
        if (!"READY".equals(a.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "MEDIA_NOT_READY");
        }
        String key = jdbc.queryForObject(
                "SELECT object_key FROM media_objects WHERE id=?", String.class, assetId);
        return storage().presignGet(key, props.downloadUrlTtl());
    }

    /** Batch parent-authorized access with one metadata query. */
    public Map<UUID, String> authorizedDownloadUrls(Collection<UUID> assetIds) {
        if (assetIds == null || assetIds.isEmpty()) {
            return Map.of();
        }
        var ids = assetIds.stream().distinct().toList();
        String placeholders = String.join(",",
                java.util.Collections.nCopies(ids.size(), "?"));
        record StoredAsset(UUID id, String key, String status) {
        }
        var stored = jdbc.query("SELECT id,object_key,status::text FROM media_objects "
                        + "WHERE id IN (" + placeholders + ")",
                (rs, i) -> new StoredAsset(rs.getObject("id", UUID.class),
                        rs.getString("object_key"), rs.getString("status")),
                ids.toArray());
        if (stored.size() != ids.size()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "MEDIA_NOT_FOUND");
        }
        var storage = storage();
        Map<UUID, String> urls = new LinkedHashMap<>();
        for (var asset : stored) {
            if (!"READY".equals(asset.status())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "MEDIA_NOT_READY");
            }
            urls.put(asset.id(), storage.presignGet(asset.key(), props.downloadUrlTtl()));
        }
        return urls;
    }

    // ---- deletion ----

    @Transactional
    public void delete(UUID requester, UUID assetId) {
        var a = requireAsset(assetId);
        if (!a.ownerId().equals(requester)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_OWNER");
        }
        if ("DELETED".equals(a.status())) {
            return;                                 // idempotent
        }
        jdbc.update("UPDATE media_objects SET status='DELETED', deleted_at=now()"
                + " WHERE id=?", assetId);
        try {
            String key = jdbc.queryForObject(
                    "SELECT object_key FROM media_objects WHERE id=?",
                    String.class, assetId);
            storage().delete(key);
        } catch (RuntimeException e) {
            // R2 delete failed — enqueue DELETE_OBJECT job for retry instead of
            // rolling back the status flip (DB and storage aren't transactional).
            jdbc.update("INSERT INTO media_processing_jobs(media_id,operation_key)"
                            + " VALUES(?,'DELETE_OBJECT') ON CONFLICT DO NOTHING",
                    assetId);
        }
    }
}
