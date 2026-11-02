package com.diasporum.backend.billing;

import java.util.UUID;

/** Public billing entitlement operations for consumer modules. */
public interface BillingApi {

    /**
     * Atomically consumes one personal-plan quota unit. Missing, disabled or
     * incompletely configured entitlements fail closed. Repeating an operation
     * with the same idempotency key returns its original success without
     * consuming another unit.
     */
    EntitlementDecision consumePersonalQuota(UUID userId, String featureKey,
            String targetType, UUID targetId, String idempotencyKey);

    record EntitlementDecision(boolean allowed, String reason,
            long remaining) {
    }
}
