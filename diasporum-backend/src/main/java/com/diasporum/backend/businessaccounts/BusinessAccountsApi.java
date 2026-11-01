package com.diasporum.backend.businessaccounts;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Public API of the businessaccounts module: account lookup and active
 * membership checks for cross-module authorization (e.g. messaging business
 * participants). Other modules consume this interface only — never
 * {@code businessaccounts.internal.*}.
 */
public interface BusinessAccountsApi {

    /** True when {@code userId} is an accepted, non-revoked member of the account. */
    boolean isActiveMember(UUID userId, UUID businessAccountId);

    /** All business account ids where {@code userId} is an active accepted member. */
    List<UUID> activeAccountIdsOf(UUID userId);

    /** Public-safe account view — id, display name and lifecycle status. */
    Optional<BusinessAccountSummary> accountSummary(UUID businessAccountId);

    /**
     * The account's stable representative user: {@code created_by_user_id},
     * falling back to the active accepted OWNER. Mirrors the messaging
     * schema's "canonical representative profile" for a business side.
     */
    Optional<UUID> representativeUserId(UUID businessAccountId);

    /**
     * User ids of all accepted, non-revoked members of an {@code ACTIVE}
     * account — realtime fan-out targets every current member of a business
     * participant, so live membership (not a stale participant row) decides
     * who may receive conversation events.
     */
    List<UUID> activeMemberIds(UUID businessAccountId);

    /** Cross-module-safe business account projection. */
    record BusinessAccountSummary(UUID id, String accountName, String status) {
    }
}
