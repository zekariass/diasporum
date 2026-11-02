package com.diasporum.backend.propertylistings.internal.application;

import tools.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** DTOs and commands for the property module. No persistence entity is exposed. */
public final class PropertyModels {

    private PropertyModels() {
    }

    public record AddressInput(String addressLine1, String addressLine2, String city,
            String region, String postalCode, String formattedAddress,
            Double latitude, Double longitude) {
    }

    public record ContactInput(String phone, String whatsapp, String email,
            String preferredMethod, Boolean showPhone, Boolean showWhatsapp,
            Boolean showEmail) {
    }

    public record PropertyCommand(UUID countryId, UUID communityId,
            UUID businessAccountId, UUID propertyTypeId, String visibilityScope,
            String listingPurpose, String title, String description,
            java.util.Map<String, Object> additionalAttributes,
            BigDecimal priceAmount, String currencyCode, String pricePeriod,
            AddressInput address, Integer bedrooms, Integer bathrooms,
            Integer receptionRooms, BigDecimal floorArea, String floorAreaUnit,
            String furnishedStatus, BigDecimal rentalDeposit, Boolean billsIncluded,
            Integer minimumTenancyMonths, LocalDate availabilityDate, String tenure,
            String conditionKey, List<UUID> communityIds, List<UUID> amenityIds,
            ContactInput contact) {
    }

    public record PropertyTypeView(UUID id, String typeKey, String displayName) {
    }

    public record AmenityView(UUID id, String amenityKey, String displayName) {
    }

    public record PublicLocation(String city, String region, Double latitude,
            Double longitude) {
    }

    /** Safe projection: deliberately no address id, exact point or private address fields. */
    public record PropertyRow(UUID id, UUID countryId, UUID communityId, UUID ownerUserId,
            UUID businessAccountId, UUID createdByUserId, UUID propertyTypeId,
            String visibilityScope, String listingPurpose, String title,
            String description, JsonNode additionalAttributes, BigDecimal priceAmount,
            String currencyCode, String pricePeriod, Integer bedrooms,
            Integer bathrooms, Integer receptionRooms, BigDecimal floorArea,
            String floorAreaUnit, String furnishedStatus, BigDecimal rentalDeposit,
            Boolean billsIncluded, Integer minimumTenancyMonths,
            LocalDate availabilityDate, String tenure, String conditionKey,
            String status, Instant expiresAt, Instant publishedAt, Instant closedAt,
            Instant createdAt, Instant updatedAt) {
    }

    public record Listed(PropertyRow property, PropertyTypeView propertyType,
            PublicLocation location, UUID coverMediaId, boolean saved,
            Instant cursorTime) {
    }

    public record PropertyItem(PropertyRow property, PropertyTypeView propertyType,
            PublicLocation location, UUID coverMediaId, boolean saved,
            boolean canManage) {
    }

    public record SearchCriteria(UUID countryId, UUID communityId, UUID propertyTypeId,
            String listingPurpose, BigDecimal minPrice, BigDecimal maxPrice,
            Integer minBedrooms, Integer maxBedrooms, Integer bathrooms,
            String furnishedStatus, String city, String search, Double latitude,
            Double longitude, Double radiusKm) {
    }

    public record PropertyPage(List<PropertyItem> items, String nextCursor) {
    }

    public record PropertyMediaView(UUID mediaId, int sortOrder, boolean cover) {
    }

    public record ContactView(String phone, String whatsapp, String email,
            String preferredMethod) {
    }

    public record OwnerView(String displayName, String businessAccountName) {
    }

    public record PropertyDetail(PropertyItem item, List<PropertyMediaView> media,
            List<AmenityView> amenities, ContactView contact, OwnerView owner) {
    }
}
