package com.diasporum.backend.jobs.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi.AccountMembershipView;

/** Fixed Jobs-management capabilities for active Business Account members. */
public final class JobAuthorization {

    private JobAuthorization() {
    }

    public static boolean canManageJobs(String role) {
        return "OWNER".equals(role) || "ADMINISTRATOR".equals(role)
                || "EDITOR".equals(role) || "LISTING_MANAGER".equals(role);
    }

    public static AccountMembershipView asActiveJobManager(
            AccountMembershipView membership) {
        return membership != null && "ACTIVE".equals(membership.status())
                && canManageJobs(membership.role()) ? membership : null;
    }
}
