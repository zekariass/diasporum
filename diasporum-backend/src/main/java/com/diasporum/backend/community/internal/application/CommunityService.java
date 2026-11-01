package com.diasporum.backend.community.internal.application;

import com.diasporum.backend.community.CommunityApi.MembershipView;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.social.SocialApi;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import com.diasporum.backend.taxonomy.TaxonomyApi.CommunityView;
import com.diasporum.backend.taxonomy.TaxonomyApi.CountryView;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Membership lifecycle, active-community switching, member listing and
 * community-role authorization over {@code community_memberships}.
 * Catalogue data comes from {@link TaxonomyApi}; identity/profile data from
 * {@link IdentityApi}; block filtering from {@link SocialApi}.
 * Eligibility is also enforced by the DB trigger
 * {@code trg_membership_origin_country} as a safety net.
 */
@Service
public class CommunityService {

    private final JdbcTemplate jdbc;
    private final IdentityApi identity;
    private final TaxonomyApi taxonomy;
    private final SocialApi social;

    public CommunityService(JdbcTemplate jdbc, IdentityApi identity,
            TaxonomyApi taxonomy, SocialApi social) {
        this.jdbc = jdbc;
        this.identity = identity;
        this.taxonomy = taxonomy;
        this.social = social;
    }

    private static MembershipView row(java.sql.ResultSet rs, int i)
            throws java.sql.SQLException {
        return new MembershipView(rs.getObject("community_id", UUID.class),
                rs.getObject("user_id", UUID.class), rs.getString("role"),
                rs.getString("status"), rs.getTimestamp("joined_at").toInstant());
    }

    private static final String SELECT = "SELECT community_id,user_id,role::text,"
            + " status::text,joined_at FROM community_memberships";

    private ProfileSummary requireUser(UUID userId) {
        return identity.profileSummary(userId).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
    }

    private CommunityView requireCommunity(UUID communityId) {
        var c = taxonomy.findCommunityById(communityId).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "COMMUNITY_NOT_FOUND"));
        if (!c.active()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "COMMUNITY_INACTIVE");
        }
        return c;
    }

    public Optional<MembershipView> membershipOf(UUID userId, UUID communityId) {
        return jdbc.query(SELECT + " WHERE community_id=? AND user_id=?",
                        CommunityService::row, communityId, userId)
                .stream().findFirst();
    }

    public boolean isActiveMember(UUID userId, UUID communityId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM community_memberships"
                + " WHERE community_id=? AND user_id=? AND status='ACTIVE'",
                Integer.class, communityId, userId);
        return n != null && n > 0;
    }

    public List<MembershipView> membershipsOf(UUID userId) {
        return jdbc.query(SELECT + " WHERE user_id=? AND status='ACTIVE'"
                + " ORDER BY joined_at", CommunityService::row, userId);
    }

    /** Eligible-to-join communities: active catalogue entries matching the
     * user's origin country (mirrors the DB trigger's rule). */
    public List<CommunityView> availableCommunities(UUID userId) {
        var p = requireUser(userId);
        if (p.originCountryId() == null) {
            return List.of();
        }
        return taxonomy.communitiesForOriginCountry(p.originCountryId());
    }

    // ---- onboarding: preview + auto-assign ----

    /** The community the user will automatically join, based on their
     * origin + current country pair. 404 when either is unset or no
     * matching active community exists. */
    public CommunityPreviewResult communityPreview(UUID userId) {
        var p = requireUser(userId);
        return previewFor(p);
    }

    private CommunityPreviewResult previewFor(ProfileSummary p) {
        if (p.originCountryId() == null || p.currentCountryId() == null) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "COUNTRIES_NOT_SET");
        }
        var community = taxonomy.findCommunityByPair(p.originCountryId(),
                        p.currentCountryId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "COMMUNITY_NOT_FOUND"));
        if (!community.active()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "COMMUNITY_INACTIVE");
        }
        var origin = taxonomy.findCountryById(community.originCountryId()).orElse(null);
        var dest = taxonomy.findCountryById(community.destinationCountryId()).orElse(null);
        return new CommunityPreviewResult(community, origin, dest);
    }

    /** Completes onboarding: creates membership (idempotent), sets
     * default_community_id + active_community_id, all in one transaction. */
    @Transactional
    public OnboardingResult completeOnboarding(UUID userId) {
        var p = requireUser(userId);
        var preview = previewFor(p);
        var community = preview.community();
        var membership = join(userId, community.id());
        identity.setDefaultCommunity(userId, community.id());
        identity.setActiveCommunity(userId, community.id());
        return new OnboardingResult(membership, community);
    }

    public record CommunityPreviewResult(CommunityView community,
            CountryView originCountry, CountryView destinationCountry) {}

    public record OnboardingResult(MembershipView membership, CommunityView community) {}

    // ---- join / leave ----

    @Transactional
    public MembershipView join(UUID userId, UUID communityId) {
        var p = requireUser(userId);
        // Mirrors the login gate: pending-verification accounts may proceed
        // while email verification is deferred (see AuthService.register).
        if (!"ACTIVE".equals(p.accountStatus())
                && !"PENDING_VERIFICATION".equals(p.accountStatus())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "ACCOUNT_NOT_ACTIVE");
        }
        var community = requireCommunity(communityId);
        if (p.originCountryId() == null
                || !p.originCountryId().equals(community.originCountryId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "COMMUNITY_ORIGIN_MISMATCH");
        }
        var existing = membershipOf(userId, communityId);
        if (existing.isPresent()) {
            var m = existing.get();
            if ("ACTIVE".equals(m.status())) {
                return m;                       // idempotent — already a member
            }
            if ("SUSPENDED".equals(m.status())) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                        "MEMBERSHIP_SUSPENDED");
            }
            // LEFT → reactivate
            jdbc.update("UPDATE community_memberships SET status='ACTIVE',"
                            + " left_at=null, joined_at=now(), updated_at=now()"
                            + " WHERE community_id=? AND user_id=?",
                    communityId, userId);
            return membershipOf(userId, communityId).orElseThrow();
        }
        try {
            jdbc.update("INSERT INTO community_memberships(community_id,user_id)"
                    + " VALUES(?,?)", communityId, userId);
        } catch (DuplicateKeyException e) {
            return membershipOf(userId, communityId).orElseThrow();  // race winner
        }
        return membershipOf(userId, communityId).orElseThrow();
    }

    @Transactional
    public void leave(UUID userId, UUID communityId) {
        var m = membershipOf(userId, communityId).orElse(null);
        if (m == null || "LEFT".equals(m.status())) {
            return;                                 // idempotent no-op
        }
        jdbc.update("UPDATE community_memberships SET status='LEFT',"
                + " left_at=now(), updated_at=now() WHERE community_id=?"
                + " AND user_id=?", communityId, userId);
        // Leaving the active community clears the persisted selection.
        identity.activeCommunityId(userId)
                .filter(communityId::equals)
                .ifPresent(c -> identity.setActiveCommunity(userId, null));
    }

    // ---- active community ----

    public Optional<UUID> activeCommunityId(UUID userId) {
        return identity.activeCommunityId(userId);
    }

    @Transactional
    public void setActiveCommunity(UUID userId, UUID communityId) {
        if (communityId == null) {
            identity.setActiveCommunity(userId, null);
            return;
        }
        var community = requireCommunity(communityId);
        if (!isActiveMember(userId, community.id())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "NOT_A_MEMBER");
        }
        identity.setActiveCommunity(userId, communityId);
    }

    // ---- members ----

    public int activeMemberCount(UUID communityId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM community_memberships"
                + " WHERE community_id=? AND status='ACTIVE'",
                Integer.class, communityId);
        return n == null ? 0 : n;
    }

    /** Members visible to {@code viewer}: ACTIVE members only, minus users
     * blocked in either direction (viewer must itself be an active member). */
    public List<MembershipView> members(UUID viewerId, UUID communityId,
            int page, int size) {
        if (!isActiveMember(viewerId, communityId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_A_MEMBER");
        }
        return jdbc.query(SELECT + " WHERE community_id=? AND status='ACTIVE'"
                        + " ORDER BY joined_at LIMIT ? OFFSET ?",
                CommunityService::row, communityId, size, page * size);
    }

    public Set<UUID> hiddenMembers(UUID viewerId, List<MembershipView> members) {
        var ids = members.stream().map(MembershipView::userId).toList();
        return social.blockedWith(viewerId, ids);
    }

    // ---- roles ----

    public boolean hasRole(UUID userId, UUID communityId, String role) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM community_memberships"
                + " WHERE community_id=? AND user_id=? AND status='ACTIVE'"
                + " AND role=?::community_role",
                Integer.class, communityId, userId, role);
        return n != null && n > 0;
    }

    public boolean isCommunityAdmin(UUID userId, UUID communityId) {
        return hasRole(userId, communityId, "COMMUNITY_ADMIN");
    }

    public boolean isModeratorOrAbove(UUID userId, UUID communityId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM community_memberships"
                + " WHERE community_id=? AND user_id=? AND status='ACTIVE'"
                + " AND role IN ('MODERATOR','COMMUNITY_ADMIN')",
                Integer.class, communityId, userId);
        return n != null && n > 0;
    }

    /** COMMUNITY_ADMIN-only member removal → status LEFT (history preserved).
     * The last COMMUNITY_ADMIN cannot be removed. */
    @Transactional
    public void removeMember(UUID actorId, UUID communityId, UUID targetId) {
        if (!isCommunityAdmin(actorId, communityId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ADMIN_REQUIRED");
        }
        if (actorId.equals(targetId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "USE_LEAVE");
        }
        var target = membershipOf(targetId, communityId).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "MEMBERSHIP_NOT_FOUND"));
        if ("COMMUNITY_ADMIN".equals(target.role())
                && countByRole(communityId, "COMMUNITY_ADMIN") <= 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "LAST_ADMIN");
        }
        jdbc.update("UPDATE community_memberships SET status='LEFT',"
                + " left_at=now(), updated_at=now() WHERE community_id=?"
                + " AND user_id=?", communityId, targetId);
        identity.activeCommunityId(targetId)
                .filter(communityId::equals)
                .ifPresent(c -> identity.setActiveCommunity(targetId, null));
    }

    /** COMMUNITY_ADMIN-only role change; last COMMUNITY_ADMIN cannot be demoted. */
    @Transactional
    public MembershipView changeRole(UUID actorId, UUID communityId,
            UUID targetId, String role) {
        if (!isCommunityAdmin(actorId, communityId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ADMIN_REQUIRED");
        }
        var target = membershipOf(targetId, communityId).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "MEMBERSHIP_NOT_FOUND"));
        if (!"ACTIVE".equals(target.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "MEMBERSHIP_NOT_ACTIVE");
        }
        if ("COMMUNITY_ADMIN".equals(target.role())
                && !"COMMUNITY_ADMIN".equals(role)
                && countByRole(communityId, "COMMUNITY_ADMIN") <= 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "LAST_ADMIN");
        }
        try {
            jdbc.update("UPDATE community_memberships SET role=?::community_role,"
                    + " updated_at=now() WHERE community_id=? AND user_id=?",
                    role, communityId, targetId);
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_ROLE");
        }
        return membershipOf(targetId, communityId).orElseThrow();
    }

    private int countByRole(UUID communityId, String role) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM community_memberships"
                + " WHERE community_id=? AND status='ACTIVE' AND role=?::community_role",
                Integer.class, communityId, role);
        return n == null ? 0 : n;
    }
}
