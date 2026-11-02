package com.diasporum.backend.vehiclelistings.internal.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Client-editable fields; ownership and lifecycle status are server-controlled. */
public record VehicleInput(UUID businessAccountId, String visibilityScope, UUID communityId,
        List<UUID> selectedCommunityIds, String listingPurpose, UUID categoryId, UUID makeId,
        UUID modelId, UUID variantId, String title, String description, Integer modelYear,
        Integer mileage, String mileageUnit, String fuelType, String transmission,
        String driveType, String bodyType, Integer engineSizeCc, String colour, Integer doors,
        Integer seats, String condition, Integer registrationYear, Integer previousOwners,
        Map<String, Object> additionalAttributes, LocalDate motExpiry, String serviceHistory,
        BigDecimal priceAmount, String currencyCode, String pricePeriod,
        BigDecimal rentalDeposit, Integer mileageAllowance, String rentalConditions,
        LocationInput location, List<UUID> featureIds, Instant expiresAt,
        boolean clearLocation, boolean clearExpiry, Set<String> clearFields) {

    public VehicleInput {
        clearFields = clearFields == null ? Set.of() : Set.copyOf(clearFields);
    }

    public record LocationInput(String city, String region, String formattedAddress,
            Double discoveryLatitude, Double discoveryLongitude) {
    }
}
