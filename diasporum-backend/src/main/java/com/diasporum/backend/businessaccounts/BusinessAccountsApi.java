package com.diasporum.backend.businessaccounts;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Public API of the businessaccounts module: account lookup and active
 * membership checks for cross-module authorization (e.g. messaging business
 * participants, events business-account management). Other modules consume
 * this interface only — never {@code businessaccounts.internal.*}.
 */
public interface BusinessAccountsApi {

    /** True when {@code userId} is an accepted, non-revoked member of the account. */
    boolean isActiveMember(UUID userId, UUID businessAccountId);

    /** All business account ids where {@code userId} is an active accepted member. */
    List<UUID> activeAccountIdsOf(UUID userId);

    /** Public-safe account view — id, display name and lifecycle status. */
    Optional<BusinessAccountSummary> accountSummary(UUID businessAccountId);

    /** Batch account summaries for list enrichment. */
    Map<UUID, BusinessAccountSummary> accountSummaries(Collection<UUID> businessAccountIds);

    /**
     * The account's stable representative user: {@code created_by_user_id},
     * falling back to the active accepted OWNER. Mirrors the messaging
     * schema's "canonical representative profile" for a business side.
     */
    Optional<UUID> representativeUserId(UUID businessAccountId);

    /** Batch canonical representatives for block and contact checks. */
    Map<UUID, UUID> representativeUserIds(Collection<UUID> businessAccountIds);

    /**
     * User ids of all accepted, non-revoked members of an {@code ACTIVE}
     * account — realtime fan-out targets every current member of a business
     * participant, so live membership (not a stale participant row) decides
     * who may receive conversation events.
     */
    List<UUID> activeMemberIds(UUID businessAccountId);

    /**
     * The user's accepted, non-revoked membership in an ACTIVE or SUSPENDED
     * account — the same revalidation rule as the workspace endpoint.
     */
    Optional<AccountMembershipView> membership(UUID userId, UUID accountId);

    /** All accepted, active workspaces of the user, ordered by name. */
    List<AccountMembershipView> membershipsOf(UUID userId);

    /** Workspace membership view — no internals. */
    record AccountMembershipView(UUID accountId, String accountName,
            String status, String role) {
    }

    /** Cross-module-safe business account projection. */
    record BusinessAccountSummary(UUID id, String accountName, String status) {
    }
}
