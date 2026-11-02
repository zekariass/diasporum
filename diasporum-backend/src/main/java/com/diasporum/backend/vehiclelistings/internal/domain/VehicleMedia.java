package com.diasporum.backend.vehiclelistings.internal.domain;

import java.util.UUID;

public record VehicleMedia(UUID id, String downloadUrl, int sortOrder, boolean cover) {
}
