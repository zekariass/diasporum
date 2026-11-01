package com.diasporum.backend.identity.internal.application;

import com.diasporum.backend.identity.internal.api.rest.UpdateProfileRequest;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Own-profile management: read, sparse PATCH updates, completion policy and
 * username availability. The profile id always comes from the resolved
 * internal identity — never from client input.
 *
 * <p>Completion policy: {@code display_name}, {@code username},
 * {@code origin_country_id} and {@code current_country_id} all non-null.
 * {@code profile_completed_at} is set once on the transition to complete and
 * is never reset. Account status is independent of completion.
 */
@Service
public class ProfileService {

    /** Sparse PATCH only writes non-null fields; use "" to clear bio/city. */
    private static final java.util.regex.Pattern USERNAME_PATTERN =
            java.util.regex.Pattern.compile("^[a-z0-9_]{3,20}$");

    private static final Set<String> RESERVED_USERNAMES = Set.of(
            "admin", "administrator", "root", "system", "diasporum", "support",
            "help", "moderator", "mod", "official", "api", "www", "mail",
            "null", "undefined", "security", "abuse", "noreply", "team", "staff",
            "community", "announcements", "news");

    private static final String PROFILE_SELECT =
            "SELECT p.id, p.username, p.display_name, p.bio, p.city, p.date_of_birth,"
                    + " p.origin_country_id, p.current_country_id, u.account_status::text,"
                    + " p.profile_completed_at,"
                    + " (SELECT media_id FROM profile_media WHERE user_id=p.id AND variant='AVATAR') AS avatar_media_id"
                    + " FROM profiles p JOIN users u ON u.id=p.id WHERE p.id=?";

    private final JdbcTemplate jdbc;
    private final TaxonomyApi taxonomy;

    public ProfileService(JdbcTemplate jdbc, TaxonomyApi taxonomy) {
        this.jdbc = jdbc;
        this.taxonomy = taxonomy;
    }

    public record ProfileView(UUID id, String username, String displayName,
            String bio, String city, LocalDate dateOfBirth, UUID originCountryId,
            UUID currentCountryId, String accountStatus,
            boolean profileCompleted, UUID avatarMediaId) {
    }

    private ProfileView row(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new ProfileView(rs.getObject("id", UUID.class), rs.getString("username"),
                rs.getString("display_name"), rs.getString("bio"), rs.getString("city"),
                rs.getObject("date_of_birth", LocalDate.class),
                rs.getObject("origin_country_id", UUID.class),
                rs.getObject("current_country_id", UUID.class),
                rs.getString("account_status"),
                rs.getTimestamp("profile_completed_at") != null,
                rs.getObject("avatar_media_id", UUID.class));
    }

    public ProfileView getProfile(UUID profileId) {
        try {
            return jdbc.queryForObject(PROFILE_SELECT, this::row, profileId);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFILE_NOT_FOUND");
        }
    }

    @Transactional
    public ProfileView updateProfile(UUID profileId, UpdateProfileRequest req) {
        // Ensure a profile row exists for new users (onboarding builds it step-by-step).
        jdbc.update("INSERT INTO profiles(id) VALUES(?) ON CONFLICT(id) DO NOTHING", profileId);
        if (req.username() != null) {
            applyUsername(profileId, normalize(req.username()));
        }
        if (req.displayName() != null) {
            jdbc.update("UPDATE profiles SET display_name=?, updated_at=now() WHERE id=?",
                    req.displayName().trim(), profileId);
        }
        if (req.bio() != null) {
            jdbc.update("UPDATE profiles SET bio=?, updated_at=now() WHERE id=?",
                    req.bio().isBlank() ? null : req.bio(), profileId);
        }
        if (req.city() != null) {
            jdbc.update("UPDATE profiles SET city=?, updated_at=now() WHERE id=?",
                    req.city().isBlank() ? null : req.city().trim(), profileId);
        }
        if (req.dateOfBirth() != null) {
            jdbc.update("UPDATE profiles SET date_of_birth=?, updated_at=now() WHERE id=?",
                    req.dateOfBirth(), profileId);
        }
        if (req.originCountryId() != null) {
            requireActiveCountry(req.originCountryId());
            jdbc.update("UPDATE profiles SET origin_country_id=?, updated_at=now() WHERE id=?",
                    req.originCountryId(), profileId);
        }
        if (req.currentCountryId() != null) {
            requireActiveCountry(req.currentCountryId());
            jdbc.update("UPDATE profiles SET current_country_id=?, updated_at=now() WHERE id=?",
                    req.currentCountryId(), profileId);
        }
        if (req.avatarMediaId() != null) {
            applyAvatar(profileId, req.avatarMediaId());
        }
        refreshCompletion(profileId);
        return getProfile(profileId);
    }

    private void applyUsername(UUID profileId, String normalized) {
        if (!USERNAME_PATTERN.matcher(normalized).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_USERNAME");
        }
        if (RESERVED_USERNAMES.contains(normalized)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "USERNAME_RESERVED");
        }
        try {
            jdbc.update("UPDATE profiles SET username=?, updated_at=now() WHERE id=?",
                    normalized, profileId);
        } catch (DataIntegrityViolationException e) {
            // ux_profiles_username_ci — another account holds it (incl. race loser)
            throw new ResponseStatusException(HttpStatus.CONFLICT, "USERNAME_TAKEN");
        }
    }

    static String normalize(String username) {
        return username == null ? null : username.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Links a completed AVATAR upload to the profile. The asset must exist,
     * belong to this user, and have finished uploading (status READY) —
     * otherwise the reference is rejected rather than stored blindly.
     */
    private void applyAvatar(UUID profileId, UUID mediaId) {
        Integer usable = jdbc.queryForObject(
                "SELECT count(*) FROM media_objects"
                        + " WHERE id=? AND owner_user_id=? AND purpose='AVATAR'"
                        + " AND status='READY'",
                Integer.class, mediaId, profileId);
        if (usable == null || usable == 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_AVATAR_MEDIA");
        }
        jdbc.update("INSERT INTO profile_media(user_id, media_id, variant) VALUES(?,?,'AVATAR')"
                        + " ON CONFLICT(user_id, variant) DO UPDATE SET media_id=EXCLUDED.media_id",
                profileId, mediaId);
    }

    private void requireActiveCountry(UUID countryId) {
        if (!taxonomy.isCountryActive(countryId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_COUNTRY");
        }
    }

    private void refreshCompletion(UUID profileId) {
        jdbc.update("UPDATE profiles SET profile_completed_at=now(), updated_at=now()"
                + " WHERE id=? AND profile_completed_at IS NULL"
                + " AND display_name IS NOT NULL AND username IS NOT NULL"
                + " AND origin_country_id IS NOT NULL AND current_country_id IS NOT NULL",
                profileId);
    }

    public Map<String, Object> completion(UUID profileId) {
        var p = getProfile(profileId);
        List<String> missing = new java.util.ArrayList<>();
        if (p.displayName() == null) missing.add("displayName");
        if (p.username() == null) missing.add("username");
        if (p.originCountryId() == null) missing.add("originCountryId");
        if (p.currentCountryId() == null) missing.add("currentCountryId");
        return Map.of("complete", missing.isEmpty(), "missing", missing);
    }

    public Map<String, Object> usernameAvailability(String raw) {
        String u = normalize(raw);
        if (u == null || !USERNAME_PATTERN.matcher(u).matches()) {
            return Map.of("username", u == null ? "" : u, "available", false,
                    "reason", "INVALID_FORMAT");
        }
        if (RESERVED_USERNAMES.contains(u)) {
            return Map.of("username", u, "available", false, "reason", "RESERVED");
        }
        Integer taken = jdbc.queryForObject(
                "SELECT count(*) FROM profiles WHERE username IS NOT NULL AND lower(username)=?",
                Integer.class, u);
        boolean free = taken == null || taken == 0;
        return Map.of("username", u, "available", free,
                "reason", free ? "AVAILABLE" : "TAKEN");
    }

}
