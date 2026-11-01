package com.diasporum.backend.identity.internal.api.rest;

import jakarta.validation.constraints.Pattern;

/** Sparse PATCH body for privacy settings. */
public record UpdatePrivacySettingsRequest(Boolean profileDiscoverable,
        Boolean showProfileToCommunity, Boolean showCity,
        Boolean showOnlineStatus, Boolean allowFollowers,
        Boolean allowMessageRequests,
        @Pattern(regexp = "^(NONE|MUTUAL_FOLLOWERS|COMMUNITY_MEMBERS|INTERACTED_USERS|EVERYONE)$")
        String dmPermission,
        Boolean allowPeopleSuggestions, Boolean allowMatchmakingDiscovery) {
}
