package com.diasporum.backend.sparebag.internal.application.v2;

import com.diasporum.backend.community.CommunityApi;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Design doc section 6.6: a posting is visible to users of communities whose
 * {@code destination_country_id} equals the posting's {@code from_country_id}
 * OR {@code to_country_id}. The "home country" case (origin = destination = X)
 * is the same rule: that community's destination is X, so it matches every
 * posting going to or from X.
 *
 * <p>Communities are resolved only through {@link CommunityApi}: the viewer's
 * ACTIVE memberships, each resolved to its {@code CommunityContext}. A
 * membership whose context is not resolvable (inactive community, account not
 * active, origin mismatch) contributes nothing - the same tolerance
 * {@code CommunityAccessPolicyService.myAccess} applies.
 */
@Component
public class SpareBagVisibility {

    private final CommunityApi community;

    public SpareBagVisibility(CommunityApi community) {
        this.community = community;
    }

    public Set<UUID> visibleCountries(UUID viewer) {
        Set<UUID> countries = new LinkedHashSet<>();
        for (var membership : community.membershipsOf(viewer)) {
            try {
                countries.add(community.context(viewer, membership.communityId())
                        .destinationCountryId());
            } catch (ResponseStatusException e) {
                // unresolvable community context: grants no visibility
            }
        }
        return countries;
    }

    public boolean canSee(UUID viewer, UUID fromCountryId, UUID toCountryId) {
        Set<UUID> countries = visibleCountries(viewer);
        return countries.contains(fromCountryId) || countries.contains(toCountryId);
    }
}
