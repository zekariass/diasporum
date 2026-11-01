package com.diasporum.backend.community.internal.application;

import com.diasporum.backend.community.CommunityApi;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Delegating implementation of {@link CommunityApi}. */
@Service
public class CommunityApiImpl implements CommunityApi {

    private final CommunityService service;
    private final com.diasporum.backend.taxonomy.TaxonomyApi taxonomy;

    public CommunityApiImpl(CommunityService service,
            com.diasporum.backend.taxonomy.TaxonomyApi taxonomy) {
        this.service = service;
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
}
