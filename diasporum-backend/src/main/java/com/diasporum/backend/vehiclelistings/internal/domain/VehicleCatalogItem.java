package com.diasporum.backend.vehiclelistings.internal.domain;

import java.util.UUID;

public record VehicleCatalogItem(UUID id, String key, String displayName, int sortOrder) {
}
