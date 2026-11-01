package com.diasporum.backend.businessaccounts;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Public API of the business-account module: accepted, active workspace
 * memberships. Other modules consume this interface only — never
 * {@code businessaccounts.internal.*}. Role semantics are defined by the
 * consuming module's policy classes (fixed capabilities per role).
 */
public interface BusinessAccountApi {

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
}
