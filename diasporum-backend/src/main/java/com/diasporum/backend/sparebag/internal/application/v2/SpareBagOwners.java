package com.diasporum.backend.sparebag.internal.application.v2;

import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Owner;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Batch owner summaries via {@link IdentityApi} (no profile SQL in this module). */
@Component
public class SpareBagOwners {

    private final IdentityApi identity;

    public SpareBagOwners(IdentityApi identity) {
        this.identity = identity;
    }

    public Map<UUID, Owner> owners(Collection<UUID> userIds) {
        Map<UUID, Owner> out = new HashMap<>();
        if (userIds.isEmpty()) {
            return out;
        }
        for (var p : identity.profileSummaries(new LinkedHashSet<>(userIds))) {
            out.put(p.id(), new Owner(p.id(), p.username(), p.displayName(), p.avatarMediaId()));
        }
        return out;
    }

    public Owner owner(UUID userId) {
        return owners(java.util.List.of(userId)).getOrDefault(userId,
                new Owner(userId, null, null, null));
    }
}
