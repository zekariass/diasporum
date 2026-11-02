package com.diasporum.backend.propertylistings.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.businessaccounts.BusinessAccountsApi.AccountMembershipView;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyRow;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Live personal/business authorization; client-supplied roles are never trusted. */
@Component
class PropertyAuthorization {

    private static final Set<String> LISTING_MANAGERS = Set.of(
            "OWNER", "ADMINISTRATOR", "LISTING_MANAGER");

    private final BusinessAccountsApi businessAccounts;

    PropertyAuthorization(BusinessAccountsApi businessAccounts) {
        this.businessAccounts = businessAccounts;
    }

    AccountMembershipView requireBusinessManager(UUID actor, UUID accountId) {
        var membership = businessAccounts.membership(actor, accountId)
                .filter(m -> "ACTIVE".equals(m.status()))
                .filter(m -> LISTING_MANAGERS.contains(m.role()))
                .orElse(null);
        if (membership == null) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.FORBIDDEN,
                    "BUSINESS_LISTING_ROLE_REQUIRED");
        }
        return membership;
    }

    boolean canManage(UUID actor, PropertyRow property) {
        if (actor.equals(property.ownerUserId())) {
            return true;
        }
        if (property.businessAccountId() == null) {
            return false;
        }
        return businessAccounts.membership(actor, property.businessAccountId())
                .filter(m -> "ACTIVE".equals(m.status()))
                .map(AccountMembershipView::role)
                .filter(LISTING_MANAGERS::contains)
                .isPresent();
    }
}
