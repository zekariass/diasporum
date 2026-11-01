package com.diasporum.backend.identity.internal.application;

import com.diasporum.backend.identity.IdentityApi;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Lookup-only implementation of {@link IdentityApi}. Shares the module's own
 * persistence; provisions nothing.
 */
@Service
public class IdentityApiImpl implements IdentityApi {

    private final JdbcTemplate jdbc;
    private final ProfileService profiles;

    public IdentityApiImpl(JdbcTemplate jdbc, ProfileService profiles) {
        this.jdbc = jdbc;
        this.profiles = profiles;
    }

    @Override
    public Optional<IdentityView> findByExternalId(String issuer, String subject) {
        return jdbc.query(
                        "SELECT user_id, issuer, subject FROM external_identities"
                                + " WHERE issuer=? AND subject=?",
                        (rs, i) -> new IdentityView(rs.getObject("user_id", UUID.class),
                                rs.getString("issuer"), rs.getString("subject")),
                        issuer, subject)
                .stream().findFirst();
    }

    @Override
    public List<ProfileSummary> profileSummaries(java.util.Collection<UUID> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        String placeholders = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        return jdbc.query("SELECT p.id, p.username, p.display_name, u.account_status::text,"
                        + " p.profile_completed_at IS NOT NULL AS done,"
                        + " p.origin_country_id, p.current_country_id"
                        + " FROM profiles p JOIN users u ON u.id=p.id"
                        + " WHERE p.id IN (" + placeholders + ")",
                (rs, i) -> new ProfileSummary(rs.getObject("id", UUID.class),
                        rs.getString("username"), rs.getString("display_name"),
                        rs.getString("account_status"), rs.getBoolean("done"),
                        rs.getObject("origin_country_id", UUID.class),
                        rs.getObject("current_country_id", UUID.class)),
                ids.toArray());
    }

    @Override
    public Optional<UUID> activeCommunityId(UUID profileId) {
        return jdbc.query("SELECT active_community_id FROM user_settings WHERE user_id=?",
                        (rs, i) -> rs.getObject(1, UUID.class), profileId)
                .stream().filter(java.util.Objects::nonNull).findFirst();
    }

    @Override
    public void setActiveCommunity(UUID profileId, UUID communityId) {
        jdbc.update("UPDATE user_settings SET active_community_id=?, updated_at=now()"
                + " WHERE user_id=?", communityId, profileId);
    }

    @Override
    public void setDefaultCommunity(UUID profileId, UUID communityId) {
        jdbc.update("INSERT INTO user_settings(user_id,default_community_id,updated_at)"
                + " VALUES(?,?,now()) ON CONFLICT(user_id)"
                + " DO UPDATE SET default_community_id=?, updated_at=now()",
                profileId, communityId, communityId);
    }

    @Override
    public Optional<ProfileSummary> profileSummary(UUID profileId) {
        try {
            var p = profiles.getProfile(profileId);
            return Optional.of(new ProfileSummary(p.id(), p.username(),
                    p.displayName(), p.accountStatus(), p.profileCompleted(),
                    p.originCountryId(), p.currentCountryId()));
        } catch (org.springframework.web.server.ResponseStatusException e) {
            if (e.getStatusCode().value() == 404) {
                return Optional.empty();
            }
            throw e;
        }
    }
}
