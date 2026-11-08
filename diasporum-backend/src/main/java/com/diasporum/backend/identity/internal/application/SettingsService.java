package com.diasporum.backend.identity.internal.application;

import com.diasporum.backend.identity.internal.api.rest.PrivacySettingsResponse;
import com.diasporum.backend.identity.internal.api.rest.SettingsResponse;
import com.diasporum.backend.identity.internal.api.rest.UpdatePrivacySettingsRequest;
import com.diasporum.backend.identity.internal.api.rest.UpdateSettingsRequest;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Own-user settings ({@code user_settings}) and privacy settings
 * ({@code user_privacy_settings}). Rows are created by the
 * {@code trg_bootstrap_profile_settings} trigger at profile insert, so a
 * missing row is a data anomaly, not a normal state.
 */
@Service
public class SettingsService {

    private final JdbcTemplate jdbc;
    private final com.diasporum.backend.taxonomy.TaxonomyApi taxonomy;

    public SettingsService(JdbcTemplate jdbc,
            com.diasporum.backend.taxonomy.TaxonomyApi taxonomy) {
        this.jdbc = jdbc;
        this.taxonomy = taxonomy;
    }

    public SettingsResponse getSettings(UUID profileId) {
        try {
            return jdbc.queryForObject(
                    "SELECT default_community_id, active_community_id,"
                            + " preferred_language_code, theme"
                            + " FROM user_settings WHERE user_id=?",
                    (rs, i) -> new SettingsResponse(
                            rs.getObject("default_community_id", UUID.class),
                            rs.getObject("active_community_id", UUID.class),
                            rs.getString("preferred_language_code"),
                            rs.getString("theme")),
                    profileId);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "SETTINGS_NOT_FOUND");
        }
    }

    public PrivacySettingsResponse getPrivacySettings(UUID profileId) {
        try {
            return jdbc.queryForObject(
                    "SELECT profile_discoverable, show_profile_to_community, show_city,"
                            + " show_online_status, allow_followers, allow_message_requests,"
                            + " dm_permission, allow_people_suggestions, allow_matchmaking_discovery"
                            + " FROM user_privacy_settings WHERE user_id=?",
                    (rs, i) -> new PrivacySettingsResponse(
                            rs.getBoolean("profile_discoverable"),
                            rs.getBoolean("show_profile_to_community"),
                            rs.getBoolean("show_city"),
                            rs.getBoolean("show_online_status"),
                            rs.getBoolean("allow_followers"),
                            rs.getBoolean("allow_message_requests"),
                            rs.getString("dm_permission"),
                            rs.getBoolean("allow_people_suggestions"),
                            rs.getBoolean("allow_matchmaking_discovery")),
                    profileId);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PRIVACY_SETTINGS_NOT_FOUND");
        }
    }

    @Transactional
    public SettingsResponse updateSettings(UUID profileId, UpdateSettingsRequest req) {
        if (req.activeCommunityId() != null || req.defaultCommunityId() != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "COMMUNITY_CONTEXT_MANAGED_BY_COMMUNITY_API");
        }
        if (req.preferredLanguageCode() != null) {
            jdbc.update("UPDATE user_settings SET preferred_language_code=?,"
                    + " updated_at=now() WHERE user_id=?",
                    req.preferredLanguageCode().toLowerCase(), profileId);
        }
        if (req.theme() != null) {
            jdbc.update("UPDATE user_settings SET theme=?, updated_at=now()"
                    + " WHERE user_id=?", req.theme(), profileId);
        }
        return getSettings(profileId);
    }

    @Transactional
    public PrivacySettingsResponse updatePrivacySettings(UUID profileId,
            UpdatePrivacySettingsRequest r) {
        apply(profileId, "profile_discoverable", r.profileDiscoverable());
        apply(profileId, "show_profile_to_community", r.showProfileToCommunity());
        apply(profileId, "show_city", r.showCity());
        apply(profileId, "show_online_status", r.showOnlineStatus());
        apply(profileId, "allow_followers", r.allowFollowers());
        apply(profileId, "allow_message_requests", r.allowMessageRequests());
        apply(profileId, "allow_people_suggestions", r.allowPeopleSuggestions());
        apply(profileId, "allow_matchmaking_discovery", r.allowMatchmakingDiscovery());
        if (r.dmPermission() != null) {
            jdbc.update("UPDATE user_privacy_settings SET dm_permission=?,"
                    + " updated_at=now() WHERE user_id=?", r.dmPermission(), profileId);
        }
        return getPrivacySettings(profileId);
    }

    private void apply(UUID profileId, String column, Boolean value) {
        if (value != null) {
            // column names are hardcoded call-site constants — safe from injection
            jdbc.update("UPDATE user_privacy_settings SET " + column + "=?,"
                    + " updated_at=now() WHERE user_id=?", value, profileId);
        }
    }

    private void requireCommunity(UUID communityId) {
        if (!taxonomy.isCommunityActive(communityId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_COMMUNITY");
        }
    }
}
