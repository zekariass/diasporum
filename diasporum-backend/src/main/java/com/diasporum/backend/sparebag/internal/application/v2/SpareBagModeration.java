package com.diasporum.backend.sparebag.internal.application.v2;

import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.forbidden;

import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.SpareBagModerationRepository;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Moderation gate for v2 postings. No public moderation contract writes
 * {@code moderation_queue}, so - following the shop's moderation-gating
 * precedent - this module owns its admin endpoints and status changes, and
 * additionally records submissions/decisions in {@code moderation_queue}
 * (content types {@code SPARE_BAG_SENDER_REQUEST} /
 * {@code SPARE_BAG_TRAVELLER_JOURNEY}, as allowed by the V31 CHECK) so a
 * future moderation console has data to work from.
 */
@Component
public class SpareBagModeration {

    public static final String SENDER_REQUEST = "SPARE_BAG_SENDER_REQUEST";
    public static final String TRAVELLER_JOURNEY = "SPARE_BAG_TRAVELLER_JOURNEY";

    private final SpareBagModerationRepository repository;

    public SpareBagModeration(SpareBagModerationRepository repository) {
        this.repository = repository;
    }

    public void submit(String contentType, UUID contentId) {
        repository.enqueue(contentType, contentId);
    }

    /**
     * Resolves the open queue row with {@code queueDecision} (APPROVE/REJECT, the
     * queue's vocabulary) and writes moderation_actions + audit_logs keyed by the
     * module action (APPROVE/REJECT/REMOVE).
     */
    public void decide(UUID moderator, String contentType, UUID contentId, UUID ownerUserId,
            UUID countryId, String action, String queueDecision, String actionType,
            String reason) {
        repository.resolve(contentType, contentId, queueDecision, reason, moderator);
        repository.action(moderator, ownerUserId, countryId, contentType, contentId,
                actionType, reason, action);
        repository.audit(moderator, "SPARE_BAG_" + action, contentType, contentId);
    }

    /** Traveller verification decision: action + audit (no queue content type exists). */
    public void recordVerification(UUID admin, UUID profileUserId, UUID profileId,
            String decision, String actionType, String reason) {
        repository.action(admin, profileUserId, null, null, null, actionType,
                reason == null ? decision : reason, decision);
        repository.audit(admin, "SPARE_BAG_TRAVELLER_" + decision,
                "SPARE_BAG_TRAVELLER_PROFILE", profileId);
    }

    public int autoResolveStale() {
        return repository.autoResolveStale();
    }

    // =================== role checks ===================

    public boolean isModerator(UUID actor, UUID fromCountryId, UUID toCountryId) {
        if (repository.isGlobalModerator(actor)) {
            return true;
        }
        Set<UUID> countries = repository.moderatorCountries(actor);
        return countries.contains(fromCountryId) || countries.contains(toCountryId);
    }

    /** GLOBAL admin/moderator, or a COUNTRY-scoped moderator for either route end. */
    public void requireModerator(UUID actor, UUID fromCountryId, UUID toCountryId) {
        if (!isModerator(actor, fromCountryId, toCountryId)) {
            throw forbidden("MODERATOR_REQUIRED");
        }
    }

    /**
     * Country scope for moderation listings: {@code null} = global, otherwise
     * the countries the actor moderates; 403 when the actor moderates nothing.
     */
    public Set<UUID> moderatorScope(UUID actor) {
        if (repository.isGlobalModerator(actor)) {
            return null;
        }
        Set<UUID> countries = repository.moderatorCountries(actor);
        if (countries.isEmpty()) {
            throw forbidden("MODERATOR_REQUIRED");
        }
        return countries;
    }

    /** Same rule as {@code TicketingAccess.requirePlatformAdmin}. */
    public void requirePlatformAdmin(UUID actor) {
        if (!repository.isPlatformAdmin(actor)) {
            throw forbidden("PLATFORM_ADMIN_REQUIRED");
        }
    }
}
