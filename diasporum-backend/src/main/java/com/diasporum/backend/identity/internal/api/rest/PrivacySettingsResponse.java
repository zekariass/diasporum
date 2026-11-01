package com.diasporum.backend.identity.internal.api.rest;

/** Own-user privacy settings response — self-view only. */
public record PrivacySettingsResponse(boolean profileDiscoverable,
        boolean showProfileToCommunity, boolean showCity,
        boolean showOnlineStatus, boolean allowFollowers,
        boolean allowMessageRequests, String dmPermission,
        boolean allowPeopleSuggestions, boolean allowMatchmakingDiscovery) {
}
