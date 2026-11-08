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

    /**
     * Role hierarchy for membership management. A manager may only act on
     * members whose role ranks strictly below their own; the OWNER alone can
     * manage administrators, and ownership itself changes only through an
     * explicit transfer.
     */
    public static int rankOf(String role) {
        return switch (role) {
            case "OWNER" -> 40;
            case "ADMINISTRATOR" -> 30;
            case "EDITOR" -> 20;
            case "LISTING_MANAGER" -> 20;
            case "BILLING_MANAGER" -> 20;
            default -> 0;
        };
    }

    /** Roles a pending invitation may carry; OWNER must always be accepted. */
    public static boolean invitable(String role) {
        return switch (role) {
            case "ADMINISTRATOR", "EDITOR", "LISTING_MANAGER", "BILLING_MANAGER" -> true;
            default -> false;
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
