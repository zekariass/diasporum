package com.diasporum.backend.vehiclelistings.internal.domain;

import java.util.UUID;

/** Safe seller projection. Business representatives remain private. */
public record VehicleSeller(UUID userId, String displayName, String username,
        UUID businessAccountId, String businessName) {
}
