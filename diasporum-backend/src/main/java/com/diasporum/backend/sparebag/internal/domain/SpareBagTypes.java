package com.diasporum.backend.sparebag.internal.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Internal domain projections and commands for Spare Bag. */
public final class SpareBagTypes {

    private SpareBagTypes() {
    }

    public record ListingInput(String listingType, UUID communityId,
            String visibilityScope, UUID originAirportId,
            UUID destinationAirportId, String title, String description,
            LocalDate travelDateStart, LocalDate travelDateEnd,
            BigDecimal requestedWeightKg, Integer requestedParcelCount,
            BigDecimal availableCapacityKg, Integer availableParcelCount,
            BigDecimal maxSingleParcelKg, BigDecimal priceAmount,
            String priceUnit, String priceCurrency, String collectionPlace,
            UUID collectionAddressId, String handoverPlace,
            UUID handoverAddressId, String handoverNotes,
            List<String> categoryKeys, List<UUID> mediaIds) {
    }

    public record Airport(UUID id, UUID countryId, String iataCode,
            String icaoCode, String name, String city, String countryName,
            String countryIso2) {
    }

    public record Category(String key, String displayName, int sortOrder) {
    }

    public record Address(UUID id, UUID ownerUserId, UUID countryId,
            String visibility, String addressLine1, String addressLine2,
            String city, String region, String postalCode,
            String formattedAddress) {
    }

    public record Listing(UUID id, UUID ownerUserId, String listingType,
            UUID communityId, String visibilityScope, Airport originAirport,
            Airport destinationAirport, String title, String description,
            LocalDate travelDateStart, LocalDate travelDateEnd,
            BigDecimal requestedWeightKg, Integer requestedParcelCount,
            BigDecimal availableCapacityKg, Integer availableParcelCount,
            BigDecimal maxSingleParcelKg, BigDecimal priceAmount,
            String priceUnit, String priceCurrency, String collectionPlace,
            UUID collectionAddressId, String handoverPlace,
            UUID handoverAddressId, String handoverNotes, String status,
            Instant publishedAt, Instant closesAt, Instant createdAt,
            Instant updatedAt) {

        public LocalDate effectiveEndDate() {
            return travelDateEnd == null ? travelDateStart : travelDateEnd;
        }
    }

    public record Owner(UUID id, String username, String displayName,
            UUID avatarMediaId) {
    }

    public record ListingView(Listing listing, List<Category> categories,
            List<UUID> mediaIds, Owner owner, boolean saved, boolean canManage,
            Address collectionAddress, Address handoverAddress) {
    }

    public record ContactRequest(UUID id, UUID senderListingId,
            UUID passengerListingId, UUID requestedByUserId,
            UUID respondedByUserId, UUID directConversationId, String status,
            BigDecimal parcelWeightKg, BigDecimal proposedPriceAmount,
            String proposedPriceUnit, String priceCurrency, String message,
            String responseNote, Instant createdAt, Instant updatedAt,
            Instant respondedAt, Instant expiresAt) {
    }

    public record ContactInput(UUID ownListingId, UUID targetListingId,
            BigDecimal parcelWeightKg, BigDecimal proposedPriceAmount,
            String proposedPriceUnit, String priceCurrency, String message,
            String idempotencyKey) {
    }

    public record ContactView(ContactRequest contact,
            ListingView senderListing, ListingView passengerListing,
            Owner otherOwner, boolean incoming) {
    }

    public record DiscoveryFilters(String listingType, UUID communityId,
            UUID originCountryId, UUID destinationCountryId,
            UUID originAirportId, UUID destinationAirportId,
            LocalDate dateFrom, LocalDate dateTo, BigDecimal maxPrice,
            BigDecimal minimumCapacityKg, String priceCurrency,
            String categoryKey, BigDecimal maxWeightKg, String sort) {
    }

    public record DiscoveryCounts(long passengerOffers, long senderRequests) {
    }

    public record Page<T>(List<T> items, String nextCursor) {
    }
}
