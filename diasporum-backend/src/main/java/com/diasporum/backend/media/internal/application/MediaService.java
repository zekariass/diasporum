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
            Map.entry("MATCHMAKING_PROFILE_PHOTO", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("MATCHMAKING_PROFILE_BLURRED", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("BUSINESS", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("PROPERTY", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("SPARE_BAG_LISTING", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("VEHICLE", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("SERVICE_REQUEST", List.of("image/jpeg", "image/png", "image/webp")),
            Map.entry("FEED_VIDEO", List.of("video/mp4", "video/quicktime")),
            Map.entry("FEED_AUDIO", List.of("audio/mpeg", "audio/mp4",
                    "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav",
                    "audio/webm", "audio/ogg")),
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
            String mimeType, Long sizeBytes, String detectedMimeType, Long durationMs) {
    }

    private AssetView view(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new AssetView(rs.getObject("id", UUID.class),
                rs.getObject("owner_user_id", UUID.class),
                rs.getString("purpose"), rs.getString("status"),
                rs.getString("mime_type"), rs.getObject("size_bytes", Long.class),
                rs.getString("detected_mime_type"),
                rs.getObject("duration_ms", Integer.class) == null ? null
                        : rs.getObject("duration_ms", Integer.class).longValue());
    }

    private static final String SELECT = "SELECT id,owner_user_id,purpose,"
            + "status::text,mime_type,size_bytes,detected_mime_type,duration_ms"
            + " FROM media_objects";

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
        return initiate(owner, purpose, mimeType, declaredSize, null);
    }

    @Transactional
    public InitResult initiate(UUID owner, String purpose, String mimeType,
            Long declaredSize, Long declaredDurationMs) {
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
        if ("FEED_AUDIO".equals(purpose) && declaredDurationMs != null
                && declaredDurationMs > props.audioMaxDurationMs()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "AUDIO_TOO_LONG");
        }
        UUID assetId = UUID.randomUUID();
        String key = keyFor(owner, purpose, assetId);
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                        + "object_key,purpose,mime_type,duration_ms)"
                        + " VALUES(?,?,?,?,?,?,?)",
                assetId, owner, props.bucket(), key, purpose, mimeType,
                declaredDurationMs);
        return new InitResult(assetId,
                storage().presignPut(key, mimeType, props.uploadUrlTtl()));
    }

    @Transactional
    public AssetView complete(UUID owner, UUID assetId, Long declaredSize) {
        return complete(owner, assetId, declaredSize, null);
    }

    @Transactional
    public AssetView complete(UUID owner, UUID assetId, Long declaredSize,
            Long declaredDurationMs) {
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
        Long effectiveDuration = declaredDurationMs != null
                ? declaredDurationMs : a.durationMs();
        if ("FEED_AUDIO".equals(a.purpose()) && effectiveDuration != null
                && effectiveDuration > props.audioMaxDurationMs()) {
            jdbc.update("UPDATE media_objects SET status='REJECTED',"
                    + " rejection_reason='duration_exceeded' WHERE id=?", assetId);
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "AUDIO_TOO_LONG");
        }
        jdbc.update("UPDATE media_objects SET status='READY',"
                        + " size_bytes=?, detected_mime_type=?, duration_ms=?,"
                        + " uploaded_at=now() WHERE id=?",
                meta.sizeBytes(), meta.contentType(), effectiveDuration, assetId);
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

    // ---- server-side derivatives ----

    /**
     * Blurred rendition of a READY image asset for privacy-controlled display.
     * The derivative lives under a deterministic object key, so repeated calls
     * for the same source resolve to the same READY media row instead of
     * stacking duplicates. Failures degrade to {@link Optional#empty()} so a
     * derivative problem never blocks the caller's own operation.
     */
    @Transactional
    public Optional<UUID> blurredImageDerivative(UUID sourceAssetId,
            String purpose) {
        var source = asset(sourceAssetId).orElse(null);
        if (source == null || !"READY".equals(source.status())
                || source.mimeType() == null
                || !source.mimeType().startsWith("image/")) {
            return Optional.empty();
        }
        String sourceKey = jdbc.queryForObject(
                "SELECT object_key FROM media_objects WHERE id=?",
                String.class, sourceAssetId);
        String derivedKey = "derivatives/" + UUID.nameUUIDFromBytes(
                (purpose + ":" + sourceKey).getBytes(java.nio.charset.StandardCharsets.UTF_8)) + ".jpg";
        var existing = jdbc.query("SELECT id FROM media_objects"
                        + " WHERE bucket_name=? AND object_key=? AND status='READY' AND purpose=?",
                (rs, i) -> rs.getObject("id", UUID.class),
                props.bucket(), derivedKey, purpose).stream().findFirst();
        if (existing.isPresent()) {
            return existing;
        }
        byte[] blurred;
        try {
            var original = storage().get(sourceKey).orElse(null);
            if (original == null) {
                return Optional.empty();
            }
            blurred = ImageDerivatives.blur(original);
            storage().put(derivedKey, blurred, "image/jpeg");
        } catch (RuntimeException e) {
            return Optional.empty();
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO media_objects(id,owner_user_id,bucket_name,"
                        + "object_key,purpose,mime_type,status,size_bytes,"
                        + "detected_mime_type,uploaded_at)"
                        + " VALUES(?,?,?,?,?,'image/jpeg','READY',?,'image/jpeg',now())"
                        + " ON CONFLICT (bucket_name,object_key) DO NOTHING",
                id, source.ownerId(), props.bucket(), derivedKey, purpose,
                blurred.length);
        return jdbc.query("SELECT id FROM media_objects"
                        + " WHERE bucket_name=? AND object_key=? AND status='READY' AND purpose=?",
                (rs, i) -> rs.getObject("id", UUID.class),
                props.bucket(), derivedKey, purpose).stream().findFirst();
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
