package com.diasporum.backend.community;

import com.diasporum.backend.billing.BillingApi.ActionEligibility;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Public API of the community module: membership, active-community context,
 * and community-level authorization. Other modules consume this interface
 * only — never {@code community.internal.*}. The community *catalogue* is
 * Taxonomy-owned; this module owns participation only.
 */
public interface CommunityApi {

    /** True if {@code userId} has {@code status='ACTIVE'} membership in the community. */
    boolean isActiveMember(UUID userId, UUID communityId);

    /** Current membership record for a user, any status. */
    Optional<MembershipView> membershipOf(UUID userId, UUID communityId);

    /** All ACTIVE memberships of a user. */
    List<MembershipView> membershipsOf(UUID userId);

    int activeMemberCount(UUID communityId);

    /** The user's persisted active community selection, if set. */
    Optional<UUID> activeCommunityId(UUID userId);

    /**
     * Authorizes and persists a new active community. Fails unless the user
     * has ACTIVE membership. This is the only sanctioned write path for the
     * active-community selection.
     */
    void setActiveCommunity(UUID userId, UUID communityId);

    /** True if the user may access community-scoped content: active member
     * of an active community. */
    boolean canAccess(UUID userId, UUID communityId);

    boolean hasRole(UUID userId, UUID communityId, String role);

    /** MODERATOR or COMMUNITY_ADMIN — community moderation authority. */
    boolean isModeratorOrAbove(UUID userId, UUID communityId);

    boolean isCommunityAdmin(UUID userId, UUID communityId);

    /** Validated Default/Extended context, including effective scoped modules. */
    CommunityContext context(UUID userId, UUID communityId);

    /** The persisted active context, validated against current membership. */
    CommunityContext activeContext(UUID userId);

    /** Fail-closed authorization for a module in an explicit community. */
    CommunityContext requireModule(UUID userId, UUID communityId, String moduleKey);

    /** Fail-closed authorization in the user's persisted active community. */
    CommunityContext requireActiveModule(UUID userId, String moduleKey);

    /** Non-mutating action decision; community and feature are server-resolved. */
    ActionEligibility actionEligibility(UUID userId, String actionKey);

    /** Consume the configured Extended action after its feature transaction succeeds. */
    void consumeExtendedAction(UUID userId, UUID communityId, String actionKey,
            String idempotencyKey);

    record CommunityContext(UUID communityId, String communityName,
            String accessType, UUID originCountryId, UUID destinationCountryId,
            Map<String, Boolean> modules) {

        public boolean isDefault() {
            return "DEFAULT".equals(accessType);
        }

        public boolean moduleEnabled(String moduleKey) {
            return modules.getOrDefault(moduleKey, false);
        }
    }

    /** Membership record view — no internals. */
    record MembershipView(UUID communityId, UUID userId, String role,
            String status, java.time.Instant joinedAt) {
    }
}
