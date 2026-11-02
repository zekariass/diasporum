package com.diasporum.backend.billing;

import java.util.UUID;

/**
 * Feature-generic entitlement consumption for other modules. Billing owns
 * allowance resolution, quota accounting and idempotency; callers own the
 * business operation and invoke this API in the same database transaction.
 */
public interface BillingApi {

    /**
     * Resolve current eligibility and consume an allowance atomically.
     * Retrying the same account/idempotency key returns the original usage
     * record without consuming another unit.
     */
    ConsumptionResult consume(ConsumptionCommand command);

    /** Exactly one of {@code userId} and {@code businessAccountId} is required. */
    record ConsumptionCommand(UUID userId, UUID businessAccountId,
            String featureKey, long quantity, String targetType, UUID targetId,
            String idempotencyKey) {
    }

    record ConsumptionResult(UUID usageRecordId, boolean alreadyConsumed) {
    }
}
