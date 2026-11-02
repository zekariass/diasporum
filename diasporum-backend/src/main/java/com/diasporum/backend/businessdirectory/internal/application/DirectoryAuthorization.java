package com.diasporum.backend.businessdirectory.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi.AccountMembershipView;

/** Fixed directory capabilities; live membership is checked by BusinessAccountsApi. */
public final class DirectoryAuthorization {

    private DirectoryAuthorization() {
    }

    public static boolean canManageProfiles(String role) {
        return "OWNER".equals(role) || "ADMINISTRATOR".equals(role)
                || "EDITOR".equals(role);
    }

    public static boolean isActiveManager(AccountMembershipView membership) {
        return membership != null && "ACTIVE".equals(membership.status())
                && canManageProfiles(membership.role());
    }
}
