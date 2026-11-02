package com.diasporum.backend.vehiclelistings.internal.domain;

import java.util.UUID;

public record VehicleCursor(String sort, String sortKey, UUID id, String fingerprint) {
}
