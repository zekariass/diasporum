package com.diasporum.backend.billing;

import java.util.UUID;

/** Public provider-neutral entitlement and idempotent usage operations. */
public interface BillingApi {

    /** Consumes one configured feature unit or throws an entitlement/quota error. */
    void consumePersonalFeature(UUID userId, String featureKey, String idempotencyKey);

    /**
     * Atomically consumes one personal-plan quota unit. Missing, disabled or
     * incompletely configured entitlements fail closed. Repeating an operation
     * with the same idempotency key returns its original success without
     * consuming another unit.
     */
    EntitlementDecision consumePersonalQuota(UUID userId, String featureKey,
            String targetType, UUID targetId, String idempotencyKey);

    /**
     * Atomically consumes one configured entitlement. Repeating the same
     * idempotency key is safe. NOT_CONFIGURED lets a feature follow its
     * approved rollout behavior without inventing a grant or payment flow.
     */
    ConsumptionResult consume(UUID userId, UUID businessAccountId,
            String featureKey, String targetType, UUID targetId,
            String idempotencyKey);

    /**
     * Feature-generic entitlement consumption with explicit quantities.
     * Grants take precedence over subscription allowances and a replayed
     * idempotency key returns the original usage record. Denials raise
     * ResponseStatusException instead of returning a result.
     * Exactly one of {@code userId} and {@code businessAccountId} is required.
     */
    QuotaConsumption consume(ConsumptionCommand command);

    record ConsumptionCommand(UUID userId, UUID businessAccountId,
            String featureKey, long quantity, String targetType, UUID targetId,
            String idempotencyKey) {
    }

    record QuotaConsumption(UUID usageRecordId, boolean alreadyConsumed) {
    }

    record EntitlementDecision(boolean allowed, String reason,
            long remaining) {
    }

    enum ConsumptionResult {
        CONSUMED,
        ALREADY_CONSUMED,
        NOT_CONFIGURED,
        ENTITLEMENT_REQUIRED
    }
}
