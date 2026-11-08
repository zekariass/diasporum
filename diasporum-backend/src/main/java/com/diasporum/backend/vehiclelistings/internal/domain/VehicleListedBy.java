package com.diasporum.backend.vehiclelistings.internal.domain;

import java.math.BigDecimal;
import java.util.UUID;

/** Public Business Profile the listing is published under, when associated. */
public record VehicleListedBy(UUID businessId, String name, String categoryName,
        String verificationStatus, BigDecimal averageRating, Integer reviewCount) {
}
