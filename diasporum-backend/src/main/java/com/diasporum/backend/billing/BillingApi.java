package com.diasporum.backend.billing;

import java.util.UUID;

/** Public provider-neutral entitlement operations for consumer modules. */
public interface BillingApi {

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
