package com.diasporum.backend.events.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountApi.AccountMembershipView;

/**
 * Fixed event-management capabilities per business role, defined by the events
 * module (v10.12 rule: role capabilities live in the owning module's policy
 * classes, not in generic permission tables). Frontend role labels are never
 * authorization; callers must first validate accepted, active membership via
 * {@code BusinessAccountApi}.
 */
public final class EventAuthorization {

    private EventAuthorization() {
    }

    /** Business roles that may create and manage events on behalf of an account. */
    public static boolean canManageEvents(String role) {
        return "OWNER".equals(role) || "ADMINISTRATOR".equals(role)
                || "EDITOR".equals(role);
    }

    /** Membership with event-management capability, or null. */
    public static AccountMembershipView asEventManager(
            AccountMembershipView membership) {
        return membership != null && canManageEvents(membership.role())
                ? membership : null;
    }
}
