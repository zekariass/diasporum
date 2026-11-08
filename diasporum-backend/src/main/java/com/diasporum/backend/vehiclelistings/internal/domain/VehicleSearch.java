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
        String sort, String driveType, Integer seats, Integer doors,
        Integer registrationYearMin, Integer registrationYearMax, UUID businessListingId,
        String mileageUnit, String colour, String pricePeriod) {

    public VehicleSearch(String keyword, String purpose, UUID categoryId, UUID makeId,
            UUID modelId, UUID variantId, Integer yearMin, Integer yearMax,
            Integer mileageMin, Integer mileageMax, BigDecimal priceMin, BigDecimal priceMax,
            String currency, String fuelType, String transmission, String bodyType,
            String condition, Integer engineSizeMin, Integer engineSizeMax, UUID countryId,
            UUID communityId, String city, String region, Double originLatitude,
            Double originLongitude, Double radiusMeters, Map<String, String> attributeFilters,
            String sort, String driveType, Integer seats, Integer doors,
            Integer registrationYearMin, Integer registrationYearMax, UUID businessListingId) {
        this(keyword, purpose, categoryId, makeId, modelId, variantId, yearMin, yearMax,
                mileageMin, mileageMax, priceMin, priceMax, currency, fuelType, transmission,
                bodyType, condition, engineSizeMin, engineSizeMax, countryId, communityId,
                city, region, originLatitude, originLongitude, radiusMeters, attributeFilters,
                sort, driveType, seats, doors, registrationYearMin, registrationYearMax,
                businessListingId, "KM", null, null);
    }

    public VehicleSearch {
        attributeFilters = attributeFilters == null ? Map.of() : Map.copyOf(attributeFilters);
        sort = sort == null || sort.isBlank() ? "NEWEST" : sort;
    }
}
