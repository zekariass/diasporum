package com.diasporum.backend.vehiclelistings.internal.domain;

import java.util.UUID;

/** Public general-area location; never contains exact coordinates or postal data. */
public record VehicleLocation(UUID countryId, String city, String region,
        String formattedAddress) {
}
