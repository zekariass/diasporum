package com.diasporum.backend.vehiclelistings.internal.domain;

import java.util.UUID;

public record VehicleFeature(UUID id, String featureKey, String displayName) {
}
