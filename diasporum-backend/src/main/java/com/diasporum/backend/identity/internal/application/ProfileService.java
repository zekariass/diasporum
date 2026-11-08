package com.diasporum.backend.identity.internal.application;

import com.diasporum.backend.identity.IdentityApi.CountriesChangedEvent;
import com.diasporum.backend.identity.internal.api.rest.UpdateProfileRequest;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
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
    private final ApplicationEventPublisher events;

    public ProfileService(JdbcTemplate jdbc, TaxonomyApi taxonomy,
            ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.taxonomy = taxonomy;
        this.events = events;
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
        jdbc.queryForObject("SELECT id FROM profiles WHERE id=? FOR UPDATE", UUID.class, profileId);
        var previous = getProfile(profileId);
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
            // Supplying a birth date is the eligibility confirmation act —
            // matchmaking_account_is_adult() requires this stamp alongside
            // the 18+ DOB check, so it must be written here or no account
            // can ever become adult-eligible.
            // DOB is one-time: the IS NULL predicate makes the write atomic,
            // so a concurrent second submission loses instead of overwriting.
            int written = jdbc.update(
                    "UPDATE profiles SET date_of_birth=?, age_eligibility_confirmed_at=now(),"
                            + " updated_at=now() WHERE id=? AND date_of_birth IS NULL",
                    req.dateOfBirth(), profileId);
            if (written == 0) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "DATE_OF_BIRTH_ALREADY_SET");
            }
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
        var updated = getProfile(profileId);
        boolean countriesChanged = !java.util.Objects.equals(previous.originCountryId(),
                updated.originCountryId()) || !java.util.Objects.equals(
                previous.currentCountryId(), updated.currentCountryId());
        if (previous.profileCompleted() && countriesChanged) {
            events.publishEvent(new CountriesChangedEvent(profileId,
                    previous.originCountryId(), previous.currentCountryId(),
                    updated.originCountryId(), updated.currentCountryId()));
        }
        return updated;
    }

    public record CatalogChoice(UUID id, String label) {}
    public record CompatibilityView(List<UUID> interestIds, List<UUID> languageIds,
            List<CatalogChoice> interests, List<CatalogChoice> languages, boolean hasDiscoveryLocation) {}

    @Transactional(readOnly = true)
    public CompatibilityView compatibility(UUID actor) {
        requireActiveProfile(actor);
        return new CompatibilityView(
                jdbc.query("SELECT interest_id FROM user_interests WHERE user_id=? ORDER BY interest_id",
                        (rs, i) -> rs.getObject(1, UUID.class), actor),
                jdbc.query("SELECT language_id FROM user_languages WHERE user_id=? ORDER BY language_id",
                        (rs, i) -> rs.getObject(1, UUID.class), actor),
                jdbc.query("SELECT id,display_name FROM interests WHERE is_active ORDER BY sort_order,display_name,id",
                        (rs, i) -> new CatalogChoice(rs.getObject(1, UUID.class), rs.getString(2))),
                taxonomy.activeLanguages().stream().map(l -> new CatalogChoice(l.id(), l.displayName())).toList(),
                Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM user_discovery_locations WHERE user_id=?)",
                        Boolean.class, actor)));
    }

    @Transactional
    public CompatibilityView replaceCompatibility(UUID actor, List<UUID> interests, List<UUID> languages) {
        requireActiveProfile(actor);
        if (interests == null || languages == null || interests.size() > 30 || languages.size() > 30
                || interests.stream().anyMatch(java.util.Objects::isNull)
                || languages.stream().anyMatch(java.util.Objects::isNull)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_PROFILE_COMPATIBILITY");
        }
        jdbc.queryForObject("SELECT id FROM profiles WHERE id=? FOR UPDATE", UUID.class, actor);
        for (UUID id : interests) {
            if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM interests WHERE id=? AND is_active)", Boolean.class, id))) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_INTEREST");
            }
        }
        for (UUID id : languages) {
            if (!taxonomy.findLanguageById(id).map(TaxonomyApi.LanguageView::active).orElse(false)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_LANGUAGE");
            }
        }
        // Keep existing rows, including language proficiency; remove only deselected relationships.
        var current = compatibility(actor);
        for (UUID id : current.interestIds()) if (!interests.contains(id))
            jdbc.update("DELETE FROM user_interests WHERE user_id=? AND interest_id=?", actor, id);
        for (UUID id : current.languageIds()) if (!languages.contains(id))
            jdbc.update("DELETE FROM user_languages WHERE user_id=? AND language_id=?", actor, id);
        for (UUID id : interests) jdbc.update("INSERT INTO user_interests(user_id,interest_id) VALUES(?,?) ON CONFLICT DO NOTHING", actor, id);
        for (UUID id : languages) jdbc.update("INSERT INTO user_languages(user_id,language_id) VALUES(?,?) ON CONFLICT DO NOTHING", actor, id);
        return compatibility(actor);
    }

    @Transactional
    public void saveDiscoveryLocation(UUID actor, double latitude, double longitude, boolean consent) {
        requireActiveProfile(actor);
        if (!consent || !Double.isFinite(latitude) || !Double.isFinite(longitude)
                || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_DISCOVERY_LOCATION");
        }
        // Quantize before persistence. Neither the input point nor the stored point is returned.
        double lat = Math.round(latitude * 50) / 50.0;
        double lon = Math.round(longitude * 50) / 50.0;
        jdbc.update("INSERT INTO user_discovery_locations(user_id,location,location_source,precision_radius_m)"
                + " VALUES(?,ST_SetSRID(ST_MakePoint(?,?),4326)::geography,'DEVICE_APPROXIMATE',3000)"
                + " ON CONFLICT(user_id) DO UPDATE SET location=EXCLUDED.location,"
                + " location_source=EXCLUDED.location_source,precision_radius_m=3000,consented_at=now(),updated_at=now()",
                actor, lon, lat);
    }

    @Transactional
    public void removeDiscoveryLocation(UUID actor) {
        requireActiveProfile(actor);
        jdbc.update("DELETE FROM user_discovery_locations WHERE user_id=?", actor);
    }

    @Transactional
    public void confirmAgeEligibility(UUID actor) {
        requireActiveProfile(actor);
        int updated = jdbc.update("UPDATE profiles p SET age_eligibility_confirmed_at="
                + "COALESCE(p.age_eligibility_confirmed_at,now()) FROM users u"
                + " WHERE p.id=? AND u.id=p.id AND u.account_status='ACTIVE' AND u.deleted_at IS NULL"
                + " AND p.date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date", actor);
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "MATCHMAKING_ADULT_REQUIRED");
        }
    }

    private ProfileView requireActiveProfile(UUID actor) {
        var profile = getProfile(actor);
        if (!"ACTIVE".equals(profile.accountStatus()) || !Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT deleted_at IS NULL FROM users WHERE id=?", Boolean.class, actor))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ACCOUNT_NOT_ACTIVE");
        }
        return profile;
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
