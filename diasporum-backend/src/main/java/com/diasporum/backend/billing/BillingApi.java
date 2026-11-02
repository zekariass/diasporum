package com.diasporum.backend.billing;

import java.util.UUID;

/** Public entitlement and idempotent usage operations for personal features. */
public interface BillingApi {

    /** Consumes one configured feature unit or throws an entitlement/quota error. */
    void consumePersonalFeature(UUID userId, String featureKey, String idempotencyKey);
}
