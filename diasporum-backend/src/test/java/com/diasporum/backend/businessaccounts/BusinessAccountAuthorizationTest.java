package com.diasporum.backend.businessaccounts;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountAuthorization;
import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountAuthorization.Capabilities;
import org.junit.jupiter.api.Test;

/** Verifies every fixed business role against the application capability policy. */
class BusinessAccountAuthorizationTest {

    @Test
    void ownerHasEveryWorkspaceCapability() {
        assertEquals(new Capabilities(true, true, true, true, true),
                BusinessAccountAuthorization.capabilitiesFor("OWNER"));
    }

    @Test
    void administratorCannotManageBilling() {
        assertEquals(new Capabilities(true, true, true, false, true),
                BusinessAccountAuthorization.capabilitiesFor("ADMINISTRATOR"));
    }

    @Test
    void editorOnlyManagesProfiles() {
        assertEquals(new Capabilities(true, false, false, false, false),
                BusinessAccountAuthorization.capabilitiesFor("EDITOR"));
    }

    @Test
    void listingManagerOnlyManagesListings() {
        assertEquals(new Capabilities(false, true, false, false, false),
                BusinessAccountAuthorization.capabilitiesFor("LISTING_MANAGER"));
    }

    @Test
    void billingManagerOnlyManagesBilling() {
        assertEquals(new Capabilities(false, false, false, true, false),
                BusinessAccountAuthorization.capabilitiesFor("BILLING_MANAGER"));
    }

    @Test
    void unknownRoleHasNoCapabilities() {
        assertEquals(new Capabilities(false, false, false, false, false),
                BusinessAccountAuthorization.capabilitiesFor("UNKNOWN"));
    }

    @Test
    void ownerRanksAboveAdministratorAndStaffRoles() {
        assertTrue(BusinessAccountAuthorization.rankOf("OWNER")
                > BusinessAccountAuthorization.rankOf("ADMINISTRATOR"));
        assertTrue(BusinessAccountAuthorization.rankOf("ADMINISTRATOR")
                > BusinessAccountAuthorization.rankOf("EDITOR"));
        assertTrue(BusinessAccountAuthorization.rankOf("EDITOR")
                > BusinessAccountAuthorization.rankOf("UNKNOWN"));
    }

    @Test
    void ownerRoleIsNeverInvitable() {
        assertTrue(BusinessAccountAuthorization.invitable("ADMINISTRATOR"));
        assertTrue(BusinessAccountAuthorization.invitable("EDITOR"));
        assertTrue(BusinessAccountAuthorization.invitable("LISTING_MANAGER"));
        assertTrue(BusinessAccountAuthorization.invitable("BILLING_MANAGER"));
        assertFalse(BusinessAccountAuthorization.invitable("OWNER"));
        assertFalse(BusinessAccountAuthorization.invitable("UNKNOWN"));
    }
}
