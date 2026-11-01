package com.diasporum.backend.businessaccounts;

import static org.junit.jupiter.api.Assertions.assertEquals;

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
}
