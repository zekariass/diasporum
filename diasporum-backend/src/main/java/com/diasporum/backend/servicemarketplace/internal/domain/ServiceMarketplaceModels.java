package com.diasporum.backend.servicemarketplace.internal.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Domain records for the Service Marketplace lead-generation workflows. */
public final class ServiceMarketplaceModels {
    private ServiceMarketplaceModels() {
    }

    public record Page<T>(List<T> items, String nextCursor) {
    }

    public record Category(UUID id, String categoryKey, UUID parentId,
            String displayName, String description, int sortOrder) {
    }

    public record ProviderInput(UUID businessAccountId, String displayName,
            String description, Double baseLatitude, Double baseLongitude,
            BigDecimal radiusKm, List<UUID> categoryIds) {
    }

    public record Provider(UUID id, UUID ownerUserId, UUID businessAccountId,
            String displayName, String description, Double baseLatitude,
            Double baseLongitude, BigDecimal radiusKm, String status,
            String verificationStatus, List<Category> categories,
            Double distanceMeters, boolean canManage, Instant createdAt,
            Instant updatedAt) {
        public Provider with(List<Category> nextCategories, Double distance,
                boolean manageable) {
            return new Provider(id, ownerUserId, businessAccountId, displayName,
                    description, baseLatitude, baseLongitude, radiusKm, status,
                    verificationStatus, nextCategories, distance, manageable,
                    createdAt, updatedAt);
        }
    }

    public record RequestInput(UUID serviceCategoryId, UUID countryId,
            UUID addressId, Double latitude, Double longitude, String title,
            String description, BigDecimal budgetMin, BigDecimal budgetMax,
            String currencyCode, LocalDate preferredDate, Instant expiresAt,
            List<UUID> mediaIds) {
    }

    public record ServiceRequest(UUID id, UUID customerUserId,
            String customerDisplayName, UUID serviceCategoryId,
            String categoryDisplayName, UUID countryId, UUID addressId,
            Double latitude, Double longitude, String title, String description,
            BigDecimal budgetMin, BigDecimal budgetMax, String currencyCode,
            LocalDate preferredDate, String status, Instant expiresAt,
            Instant publishedAt, List<UUID> mediaIds, Double distanceMeters,
            boolean canManage, Instant createdAt, Instant updatedAt) {
        public ServiceRequest with(String displayName, List<UUID> media,
                Double distance, boolean manageable) {
            return new ServiceRequest(id, customerUserId, displayName,
                    serviceCategoryId, categoryDisplayName, countryId, addressId,
                    latitude, longitude, title, description, budgetMin, budgetMax,
                    currencyCode, preferredDate, status, expiresAt, publishedAt,
                    media, distance, manageable, createdAt, updatedAt);
        }
    }

    public record ResponseInput(UUID serviceProviderId, String responseType,
            String message, BigDecimal quotedAmount, String currencyCode) {
    }

    public record ProviderResponse(UUID id, UUID serviceRequestId,
            UUID serviceProviderId, String providerDisplayName,
            UUID respondedByUserId, String responseType, String message,
            BigDecimal quotedAmount, String currencyCode, String status,
            Instant createdAt, Instant updatedAt) {
    }

    public record LeadInput(UUID serviceProviderId, boolean enableChat,
            boolean unlockContactDetails) {
    }

    public record ContactAddress(UUID id, String addressLine1,
            String addressLine2, String city, String region, String postalCode,
            String formattedAddress, Double latitude, Double longitude) {
    }

    public record LeadAccess(UUID id, UUID serviceRequestId,
            UUID serviceProviderId, boolean chatEnabled,
            boolean contactDetailsUnlocked, String status, UUID grantedByUserId,
            Instant accessedAt, ContactAddress contactAddress) {
        public LeadAccess withAddress(ContactAddress address) {
            return new LeadAccess(id, serviceRequestId, serviceProviderId,
                    chatEnabled, contactDetailsUnlocked, status, grantedByUserId,
                    accessedAt, address);
        }
    }

    public record ReviewInput(UUID serviceProviderId, int rating,
            String reviewText) {
    }

    public record Review(UUID id, UUID serviceRequestId, UUID serviceProviderId,
            UUID reviewerUserId, String reviewerDisplayName, int rating,
            String reviewText, String status, String providerResponse,
            Instant createdAt, Instant updatedAt) {
    }

    public record ReportInput(String targetType, UUID targetId,
            String reasonCode, String description) {
    }

    public record Report(UUID id, UUID reporterUserId, String targetType,
            UUID targetId, String reasonCode, String description, String status,
            Instant createdAt, Instant resolvedAt, String resolutionNote) {
    }

    public record ProviderSearch(UUID categoryId, Double originLatitude,
            Double originLongitude, BigDecimal radiusKm, String query,
            String sort) {
    }

    public record RequestSearch(UUID serviceProviderId, UUID categoryId,
            UUID countryId, String city, BigDecimal budgetMin,
            BigDecimal budgetMax, String currencyCode,
            LocalDate preferredDateFrom, LocalDate preferredDateTo,
            BigDecimal maxDistanceKm, String sort) {
    }

    public record Cursor(String sort, String fingerprint, String primary,
            String secondary, UUID id) {
    }
}
