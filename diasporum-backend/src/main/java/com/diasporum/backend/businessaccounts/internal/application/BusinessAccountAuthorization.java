package com.diasporum.backend.businessaccounts.internal.application;

/**
 * Fixed business-role capabilities. Frontend role labels are never treated as
 * authorization; protected operations must call this policy after validating
 * accepted, active membership in the target account.
 */
public final class BusinessAccountAuthorization {

    private BusinessAccountAuthorization() {
    }

    public static Capabilities capabilitiesFor(String role) {
        return switch (role) {
            case "OWNER" -> new Capabilities(true, true, true, true, true);
            case "ADMINISTRATOR" -> new Capabilities(true, true, true, false, true);
            case "EDITOR" -> new Capabilities(true, false, false, false, false);
            case "LISTING_MANAGER" -> new Capabilities(false, true, false, false, false);
            case "BILLING_MANAGER" -> new Capabilities(false, false, false, true, false);
            default -> new Capabilities(false, false, false, false, false);
        };
    }

    public record Capabilities(
            boolean manageProfiles,
            boolean manageListings,
            boolean manageTeam,
            boolean manageBilling,
            boolean manageSettings) {
    }
}
