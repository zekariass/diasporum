package com.diasporum.backend.community.internal.application;

import com.diasporum.backend.billing.BillingApi.ActionEligibility;
import com.diasporum.backend.community.CommunityApi;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Delegating implementation of {@link CommunityApi}. */
@Service
public class CommunityApiImpl implements CommunityApi {

    private final CommunityService service;
    private final CommunityAccessPolicyService accessPolicy;
    private final com.diasporum.backend.taxonomy.TaxonomyApi taxonomy;

    public CommunityApiImpl(CommunityService service,
            CommunityAccessPolicyService accessPolicy,
            com.diasporum.backend.taxonomy.TaxonomyApi taxonomy) {
        this.service = service;
        this.accessPolicy = accessPolicy;
        this.taxonomy = taxonomy;
    }

    @Override
    public boolean isActiveMember(UUID userId, UUID communityId) {
        return service.isActiveMember(userId, communityId);
    }

    @Override
    public Optional<MembershipView> membershipOf(UUID userId, UUID communityId) {
        return service.membershipOf(userId, communityId);
    }

    @Override
    public List<MembershipView> membershipsOf(UUID userId) {
        return service.membershipsOf(userId);
    }

    @Override
    public int activeMemberCount(UUID communityId) {
        return service.activeMemberCount(communityId);
    }

    @Override
    public Optional<UUID> activeCommunityId(UUID userId) {
        return service.activeCommunityId(userId);
    }

    @Override
    public void setActiveCommunity(UUID userId, UUID communityId) {
        service.setActiveCommunity(userId, communityId);
    }

    @Override
    public boolean canAccess(UUID userId, UUID communityId) {
        return service.isActiveMember(userId, communityId)
                && taxonomy.isCommunityActive(communityId);
    }

    @Override
    public boolean hasRole(UUID userId, UUID communityId, String role) {
        return service.hasRole(userId, communityId, role);
    }

    @Override
    public boolean isModeratorOrAbove(UUID userId, UUID communityId) {
        return service.isModeratorOrAbove(userId, communityId);
    }

    @Override
    public boolean isCommunityAdmin(UUID userId, UUID communityId) {
        return service.hasRole(userId, communityId, "COMMUNITY_ADMIN");
    }

    @Override
    public CommunityContext context(UUID userId, UUID communityId) {
        return accessPolicy.context(userId, communityId);
    }

    @Override
    public CommunityContext activeContext(UUID userId) {
        return accessPolicy.activeContext(userId);
    }

    @Override
    public CommunityContext requireModule(UUID userId, UUID communityId, String moduleKey) {
        return accessPolicy.requireModule(userId, communityId, moduleKey);
    }

    @Override
    public CommunityContext requireActiveModule(UUID userId, String moduleKey) {
        return accessPolicy.requireActiveModule(userId, moduleKey);
    }

    @Override
    public ActionEligibility actionEligibility(UUID userId, String actionKey) {
        return accessPolicy.actionEligibility(userId, actionKey);
    }

    @Override
    public void consumeExtendedAction(UUID userId, UUID communityId, String actionKey,
            String idempotencyKey) {
        accessPolicy.consumeExtendedAction(userId, communityId, actionKey, idempotencyKey);
    }
}
