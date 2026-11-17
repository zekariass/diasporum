package com.diasporum.backend.sparebag.internal.domain;

import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Owner;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * v10.15 Spare Bag model (V31 section 7 + V39): traveller profiles, traveller
 * journeys, sender requests with items/media, per-country rules and
 * request/journey match requests. Coexists with the legacy listing model in
 * {@link SpareBagTypes}.
 */
public final class SpareBagV2Types {

    private SpareBagV2Types() {
    }

    // =================== reference data ===================

    public record MeasurementUnit(String unitCode, String displayName, String unitType) {
    }

    /** Raw per-country row; {@code configured=false} means no row exists and
     * the column defaults apply. */
    public record CountryConfig(UUID countryId, boolean enabled,
            boolean requiresItemDisclosure, List<String> prohibitedCategories,
            String legalNotice, boolean configured) {
    }

    /** Effective rules for a route: enabled = AND, disclosure = OR,
     * prohibited = union over the origin and destination country. */
    public record CountryRules(boolean enabled, boolean requiresItemDisclosure,
            Set<String> prohibitedCategories) {
    }

    public record CountryConfigInput(Boolean enabled, Boolean requiresItemDisclosure,
            List<String> prohibitedCategories, String legalNotice) {
    }

    // =================== traveller profiles ===================

    public record RegularRoute(UUID fromCountryId, UUID toCountryId) {
    }

    public record TravellerProfile(UUID id, UUID userId, String displayName, String bio,
            String verificationStatus, List<String> acceptedItemCategories,
            List<RegularRoute> regularRoutes, String status, Instant createdAt,
            Instant updatedAt) {

        public boolean verified() {
            return "VERIFIED".equals(verificationStatus);
        }
    }

    public record TravellerProfileInput(String displayName, String bio,
            List<String> acceptedItemCategories, List<RegularRoute> regularRoutes) {
    }

    public record TravellerProfileView(TravellerProfile profile, Owner owner,
            boolean verified, boolean canManage) {
    }

    // =================== journeys ===================

    public record Journey(UUID id, UUID travellerProfileId, UUID ownerUserId,
            UUID fromCountryId, String fromCity, UUID toCountryId, String toCity,
            UUID fromAirportId, UUID toAirportId, String pickupLocation,
            String deliveryLocation, LocalDate travelDate, LocalDate travelDateEnd,
            BigDecimal availableCapacityKg, BigDecimal maxSingleParcelKg,
            BigDecimal pricePerKg, BigDecimal pricePerPiece, String priceCurrency,
            List<String> acceptedCategories, String notes, String status,
            Instant publishedAt, Instant closesAt, Instant createdAt, Instant updatedAt,
            String travellerVerificationStatus, String travellerStatus) {

        public LocalDate effectiveEndDate() {
            return travelDateEnd == null ? travelDate : travelDateEnd;
        }
    }

    public record JourneyInput(UUID fromCountryId, String fromCity, UUID toCountryId,
            String toCity, UUID fromAirportId, UUID toAirportId, String pickupLocation,
            String deliveryLocation, LocalDate travelDate, LocalDate travelDateEnd,
            BigDecimal availableCapacityKg, BigDecimal maxSingleParcelKg,
            BigDecimal pricePerKg, BigDecimal pricePerPiece, String priceCurrency,
            List<String> acceptedCategories, String notes, Instant closesAt) {
    }

    public record TravellerSummary(UUID profileId, UUID userId, String displayName,
            String username, UUID avatarMediaId, boolean verified) {
    }

    public record JourneyView(Journey journey, TravellerSummary traveller,
            boolean canManage) {
    }

    public record JourneyFilters(UUID fromCountryId, UUID toCountryId, LocalDate dateFrom,
            LocalDate dateTo, String category, boolean verifiedOnly) {
    }

    // =================== sender requests ===================

    public record SenderRequest(UUID id, UUID ownerUserId, UUID fromCountryId,
            String fromCity, UUID toCountryId, String toCity, String description,
            String status, Instant publishedAt, Instant closesAt, Instant createdAt,
            Instant updatedAt) {
    }

    public record SenderItem(UUID id, UUID senderRequestId, String itemName,
            String itemDescription, String categoryKey, BigDecimal quantity,
            String unitCode, BigDecimal perUnitAmount, String perUnitUnit,
            BigDecimal declaredValueAmount, String declaredValueCurrency, int sortOrder) {
    }

    public record SenderItemInput(String itemName, String itemDescription,
            String categoryKey, BigDecimal quantity, String unitCode,
            BigDecimal perUnitAmount, String perUnitUnit, BigDecimal declaredValueAmount,
            String declaredValueCurrency) {
    }

    public record SenderRequestInput(UUID fromCountryId, String fromCity,
            UUID toCountryId, String toCity, String description, Instant closesAt,
            List<SenderItemInput> items, List<UUID> mediaIds) {
    }

    public record SenderRequestView(SenderRequest request, List<SenderItem> items,
            List<UUID> mediaIds, Owner owner, boolean canManage) {
    }

    public record SenderRequestFilters(UUID fromCountryId, UUID toCountryId,
            String category) {
    }

    // =================== matching ===================

    public record MatchRequest(UUID id, UUID senderRequestId, UUID journeyId,
            UUID requestedByUserId, UUID respondedByUserId, UUID directConversationId,
            String status, String message, String responseNote, Instant respondedAt,
            Instant createdAt, Instant updatedAt) {
    }

    public record MatchInput(UUID senderRequestId, UUID journeyId, String message,
            String idempotencyKey) {
    }

    public record MatchView(MatchRequest match, SenderRequest senderRequest,
            Journey journey, Owner otherParty, boolean incoming) {
    }

    // =================== moderation ===================

    public record ModerationItem(String type, UUID id, UUID ownerUserId,
            UUID fromCountryId, String fromCity, UUID toCountryId, String toCity,
            Instant submittedAt) {
    }

    /** Row ids touched by a bulk transition, with the owner to notify. */
    public record Touched(UUID id, UUID ownerUserId) {
    }
}
