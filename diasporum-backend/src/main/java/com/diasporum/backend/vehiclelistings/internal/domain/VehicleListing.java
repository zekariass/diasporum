package com.diasporum.backend.vehiclelistings.internal.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

/** Safe vehicle projection containing no exact address or private contact data. */
public record VehicleListing(UUID id, UUID countryId, UUID communityId,
        UUID ownerUserId, UUID businessAccountId, UUID businessListingId,
        UUID createdByUserId,
        String visibilityScope, String listingPurpose, UUID categoryId, UUID makeId,
        UUID modelId, UUID variantId, String categoryKey, String categoryName,
        String makeName, String modelName, String variantName, String title,
        String description, Integer modelYear, Integer mileage, String mileageUnit,
        String fuelType, String transmission, String driveType, String bodyType,
        Integer engineSizeCc, String colour, Integer doors, Integer seats,
        String conditionKey, Integer registrationYear, Integer previousOwners,
        Map<String, Object> additionalAttributes, LocalDate motExpiry,
        String serviceHistory, BigDecimal priceAmount, String currencyCode,
        String pricePeriod, BigDecimal rentalDeposit, Integer mileageAllowance,
        String rentalConditions, UUID addressId, String status, Instant expiresAt,
        Instant publishedAt, Instant createdAt, Instant updatedAt, boolean saved,
        Double distanceMeters, VehicleLocation location) {
}
