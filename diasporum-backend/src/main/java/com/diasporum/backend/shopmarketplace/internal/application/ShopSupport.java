package com.diasporum.backend.shopmarketplace.internal.application;

import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.notifications.NotificationsApi;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressView;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Shared identity, media, JSON, cursor and error helpers for the marketplace module. */
@Component
public class ShopSupport {
    private static final Logger log = LoggerFactory.getLogger(ShopSupport.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final JdbcTemplate jdbc;
    private final IdentityApi identity;
    private final MediaApi media;
    private final NotificationsApi notifications;

    public ShopSupport(JdbcTemplate jdbc, IdentityApi identity, MediaApi media,
            NotificationsApi notifications) {
        this.jdbc = jdbc;
        this.identity = identity;
        this.media = media;
        this.notifications = notifications;
    }

    public JdbcTemplate jdbc() {
        return jdbc;
    }

    public ProfileSummary requireActive(UUID userId) {
        ProfileSummary profile = identity.profileSummary(userId)
                .orElseThrow(() -> forbidden("ACTIVE_PROFILE_REQUIRED"));
        if (!"ACTIVE".equals(profile.accountStatus()) || !profile.profileCompleted()) {
            throw forbidden("ACTIVE_PROFILE_REQUIRED");
        }
        return profile;
    }

    public java.util.Optional<ProfileSummary> profile(UUID userId) {
        return identity.profileSummary(userId);
    }

    public Map<UUID, String> displayNames(Collection<UUID> userIds) {
        Map<UUID, String> names = new HashMap<>();
        if (userIds.isEmpty()) {
            return names;
        }
        identity.profileSummaries(userIds.stream().filter(Objects::nonNull).distinct().toList())
                .forEach(p -> names.put(p.id(), p.displayName() == null ? "Member" : p.displayName()));
        return names;
    }

    /** Parent-authorised short-lived download URLs; callers decide visibility first. */
    public Map<UUID, String> urls(Collection<UUID> mediaIds) {
        List<UUID> ids = mediaIds.stream().filter(Objects::nonNull).distinct().toList();
        // HashMap tolerates null-key lookups (Map.of NPEs) — callers pass optional media ids.
        if (ids.isEmpty()) {
            return new HashMap<>();
        }
        try {
            return new HashMap<>(media.authorizedDownloadUrls(ids));
        } catch (ResponseStatusException e) {
            // Storage disabled locally: cards still render with placeholders.
            log.debug("media URLs unavailable: {}", e.getReason());
            return new HashMap<>();
        }
    }

    public String url(UUID mediaId) {
        return mediaId == null ? null : urls(List.of(mediaId)).get(mediaId);
    }

    public void requireMedia(UUID mediaId, UUID ownerUserId, String purpose) {
        if (!media.validateForAttach(mediaId, ownerUserId, purpose) || !media.isReady(mediaId)) {
            throw badRequest("MEDIA_NOT_READY_OR_NOT_OWNED");
        }
    }

    public void notify(UUID recipient, String type, String title, String body, String targetType,
            UUID targetId, String dedupeKey) {
        if (recipient == null) {
            return;
        }
        try {
            notifications.notify(recipient, type, title, body, targetType, targetId, dedupeKey);
        } catch (RuntimeException e) {
            log.warn("marketplace notification {} failed: {}", type, e.getMessage());
        }
    }

    // ------------------------------------------------------------------ addresses

    public static final String ADDRESS_COLS = "a.id AS address_id,a.country_id AS address_country_id,"
            + "c.iso2 AS address_country_code,c.name AS address_country_name,a.address_line_1,"
            + "a.address_line_2,a.city AS address_city,a.region AS address_region,"
            + "a.postal_code AS address_postal_code,a.formatted_address";

    public static AddressView address(ResultSet rs) throws SQLException {
        UUID id = rs.getObject("address_id", UUID.class);
        if (id == null) {
            return null;
        }
        return new AddressView(id, rs.getObject("address_country_id", UUID.class),
                rs.getString("address_country_code"), rs.getString("address_country_name"),
                rs.getString("address_line_1"), rs.getString("address_line_2"),
                rs.getString("address_city"), rs.getString("address_region"),
                rs.getString("address_postal_code"), rs.getString("formatted_address"));
    }

    // ------------------------------------------------------------------ JSON

    public static String json(Object value) {
        try {
            return JSON.writeValueAsString(value == null ? Map.of() : value);
        } catch (Exception e) {
            throw badRequest("INVALID_JSON");
        }
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> map(String json) {
        if (json == null || json.isBlank()) {
            return new LinkedHashMap<>();
        }
        try {
            return JSON.readValue(json, LinkedHashMap.class);
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    @SuppressWarnings("unchecked")
    public static List<Object> list(String json) {
        if (json == null || json.isBlank()) {
            return new ArrayList<>();
        }
        try {
            return JSON.readValue(json, ArrayList.class);
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    // ------------------------------------------------------------------ cursors

    /** Opaque keyset cursor: sort|value|id, base64url. */
    public static String cursor(String sort, String value, UUID id) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (sort + "|" + value + "|" + id).getBytes(StandardCharsets.UTF_8));
    }

    public static String[] decodeCursor(String cursor, String sort) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8)
                    .split("\\|", -1);
            if (parts.length != 3 || !parts[0].equals(sort)) {
                throw badRequest("INVALID_CURSOR");
            }
            UUID.fromString(parts[2]);
            return parts;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw badRequest("INVALID_CURSOR");
        }
    }

    public static int pageSize(Integer size) {
        return size == null || size <= 0 ? 20 : Math.min(size, 50);
    }

    // ------------------------------------------------------------------ misc

    public static String placeholders(int count) {
        return String.join(",", Collections.nCopies(count, "?"));
    }

    public static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toInstant();
    }

    public static String trim(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    public static String slug(String value) {
        String s = value == null ? "" : java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "").toLowerCase().replaceAll("[^a-z0-9]+", "-")
                .replaceAll("(^-+|-+$)", "");
        if (s.length() > 60) {
            s = s.substring(0, 60).replaceAll("-+$", "");
        }
        return s.isEmpty() ? "item" : s;
    }

    public static ResponseStatusException badRequest(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }

    public static ResponseStatusException forbidden(String reason) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, reason);
    }

    public static ResponseStatusException notFound(String reason) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, reason);
    }

    public static ResponseStatusException conflict(String reason) {
        return new ResponseStatusException(HttpStatus.CONFLICT, reason);
    }

    public static ResponseStatusException unavailable(String reason) {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, reason);
    }
}
