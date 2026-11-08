package com.diasporum.backend.businessdirectory.internal.domain;

import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/** Public-safe directory projections. Persistence rows never cross the REST boundary. */
public final class DirectoryTypes {

    private DirectoryTypes() {
    }

    public record CategoryView(UUID id, UUID countryId, String name, String slug,
            String iconKey, boolean active) {
    }

    public record AddressView(String addressLine1, String addressLine2, String city,
            String region, String postalCode, String formattedAddress,
            Double latitude, Double longitude) {
    }

    public record OpeningHourView(int dayOfWeek, LocalTime openTime,
            LocalTime closeTime, boolean closed) {
    }

    public record BranchView(UUID id, UUID businessId, UUID addressId,
            String locationName, String phone, boolean primary, boolean active,
            String timezone, AddressView address, List<OpeningHourView> hours) {
    }

    public record MediaView(UUID mediaId, int sortOrder, String role) {
    }

    public record BusinessView(UUID id, UUID countryId, CategoryView category,
            String name, String slug, String description, String phone, String email,
            String websiteUrl, String verificationStatus, String status,
            String visibilityScope, UUID communityId, BigDecimal averageRating,
            int reviewCount, boolean sponsored, Instant createdAt, Instant updatedAt,
            boolean saved, boolean canManage, UUID businessAccountId,
            String businessAccountName,
            UUID logoMediaId, UUID coverMediaId, Double distanceMeters,
            long listingCount, long locationCount) {
    }

    public record ReviewView(UUID id, UUID businessId, int rating, String body,
            String ownerResponse, Instant ownerRespondedAt, Instant createdAt,
            Instant updatedAt, ProfileSummary reviewer, boolean mine) {
    }

    public record Page<T>(List<T> items, String nextCursor) {
    }
}
