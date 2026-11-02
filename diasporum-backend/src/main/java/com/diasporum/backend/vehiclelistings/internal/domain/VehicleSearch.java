package com.diasporum.backend.vehiclelistings.internal.domain;

import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;

/** Validated discovery inputs; nearby coordinates are never persisted. */
public record VehicleSearch(String keyword, String purpose, UUID categoryId, UUID makeId,
        UUID modelId, UUID variantId, Integer yearMin, Integer yearMax,
        Integer mileageMin, Integer mileageMax, BigDecimal priceMin, BigDecimal priceMax,
        String currency, String fuelType, String transmission, String bodyType,
        String condition, Integer engineSizeMin, Integer engineSizeMax, UUID countryId,
        UUID communityId, String city, String region, Double originLatitude,
        Double originLongitude, Double radiusMeters, Map<String, String> attributeFilters,
        String sort) {

    public VehicleSearch {
        attributeFilters = attributeFilters == null ? Map.of() : Map.copyOf(attributeFilters);
        sort = sort == null || sort.isBlank() ? "NEWEST" : sort;
    }
}
