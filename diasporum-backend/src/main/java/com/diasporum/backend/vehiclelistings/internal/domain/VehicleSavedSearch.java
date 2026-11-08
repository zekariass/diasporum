package com.diasporum.backend.vehiclelistings.internal.domain;

import java.time.Instant;
import java.util.UUID;

/** A discovery filter set saved by a user for reuse. */
public record VehicleSavedSearch(UUID id, UUID userId, String name, VehicleSearch filters,
        Instant createdAt) {
}
