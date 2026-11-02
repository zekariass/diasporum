package com.diasporum.backend.businessdirectory.internal.api.rest;

import com.diasporum.backend.businessdirectory.internal.application.BusinessBranchService;
import com.diasporum.backend.businessdirectory.internal.application.BusinessDirectoryAdminService;
import com.diasporum.backend.businessdirectory.internal.application.BusinessDirectoryService;
import com.diasporum.backend.businessdirectory.internal.application.BusinessEngagementService;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.BranchView;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.BusinessView;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.CategoryView;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.MediaView;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.Page;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.ReviewView;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Business Directory REST API; actor identity always comes from the JWT principal. */
@RestController
@RequestMapping("/api/v1")
public class BusinessDirectoryController {

    private final BusinessDirectoryService directory;
    private final BusinessBranchService branches;
    private final BusinessEngagementService engagement;
    private final BusinessDirectoryAdminService admin;

    public BusinessDirectoryController(BusinessDirectoryService directory,
            BusinessBranchService branches, BusinessEngagementService engagement,
            BusinessDirectoryAdminService admin) {
        this.directory = directory;
        this.branches = branches;
        this.engagement = engagement;
        this.admin = admin;
    }

    public record CreateBusinessRequest(UUID countryId, UUID businessAccountId,
            @NotNull UUID categoryId, @NotBlank @Size(max = 180) String name,
            @NotBlank @Size(max = 8000) String description,
            @Size(max = 30) String phone, @Size(max = 320) String email,
            @Size(max = 2000) String websiteUrl, String visibilityScope,
            UUID communityId, List<UUID> selectedCommunityIds) {
    }

    public record UpdateBusinessRequest(UUID categoryId, Boolean clearCategory,
            @Size(max = 180) String name, @Size(max = 8000) String description,
            @Size(max = 30) String phone, @Size(max = 320) String email,
            @Size(max = 2000) String websiteUrl, String visibilityScope,
            UUID communityId, List<UUID> selectedCommunityIds) {
    }

    public record AddressRequest(@Size(max = 240) String addressLine1,
            @Size(max = 240) String addressLine2, @Size(max = 120) String city,
            @Size(max = 120) String region, @Size(max = 40) String postalCode,
            @Size(max = 1000) String formattedAddress,
            @Min(-90) @Max(90) Double latitude,
            @Min(-180) @Max(180) Double longitude, Boolean clearCoordinates) {
    }

    public record BranchRequest(@Size(max = 200) String locationName,
            @Size(max = 30) String phone, Boolean primary, Boolean active,
            @Size(max = 100) String timezone, @Valid AddressRequest address) {
    }

    public record HoursRequest(@NotNull List<@Valid HourRequest> hours) {
    }

    public record HourRequest(@Min(1) @Max(7) int dayOfWeek, LocalTime openTime,
            LocalTime closeTime, boolean closed) {
    }

    public record MediaRequest(@NotNull UUID mediaId, @Min(0) @Max(10000) int sortOrder,
            String role) {
    }

    public record UpdateMediaRequest(@Min(0) @Max(10000) Integer sortOrder, String role) {
    }

    public record ReviewRequest(@Min(1) @Max(5) int rating,
            @Size(max = 4000) String body) {
    }

    public record ReviewResponseRequest(@Size(max = 4000) String response) {
    }

    public record ReportRequest(@NotBlank String reason,
            @Size(max = 4000) String details) {
    }

    public record VerificationRequest(@NotBlank String status,
            @NotBlank @Size(max = 2000) String reason) {
    }

    public record CategoryRequest(UUID countryId, @NotBlank @Size(max = 120) String name,
            @NotBlank @Size(max = 100) String slug, @Size(max = 80) String iconKey) {
    }

    public record CategoryStateRequest(@NotNull Boolean active) {
    }

    public record BusinessDetail(BusinessView business, List<BranchView> locations,
            List<MediaView> media) {
    }

    // =================== categories ===================

    @GetMapping("/businesses/categories")
    public Map<String, Object> categories(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID countryId) {
        principal.userId();
        return Map.of("items", directory.categories(countryId));
    }

    @PostMapping("/admin/business-categories")
    public ResponseEntity<CategoryView> createCategory(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody CategoryRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(admin.createCategory(
                principal.userId(), request.countryId(), request.name(), request.slug(),
                request.iconKey()));
    }

    @PatchMapping("/admin/business-categories/{categoryId}")
    public CategoryView categoryState(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID categoryId, @Valid @RequestBody CategoryStateRequest request) {
        return admin.setCategoryActive(principal.userId(), categoryId, request.active());
    }

    // =================== profiles and lifecycle ===================

    @PostMapping("/businesses")
    public ResponseEntity<BusinessView> create(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody CreateBusinessRequest r) {
        return ResponseEntity.status(HttpStatus.CREATED).body(directory.create(
                principal.userId(), new BusinessDirectoryService.CreateCommand(r.countryId(),
                        r.businessAccountId(), r.categoryId(), r.name(), r.description(),
                        r.phone(), r.email(), r.websiteUrl(), r.visibilityScope(),
                        r.communityId(), r.selectedCommunityIds())));
    }

    @GetMapping("/businesses/{businessId}")
    public BusinessDetail detail(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        UUID viewer = principal.userId();
        return new BusinessDetail(directory.detail(viewer, businessId),
                branches.list(viewer, businessId), directory.media(viewer, businessId));
    }

    @PatchMapping("/businesses/{businessId}")
    public BusinessView update(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @Valid @RequestBody UpdateBusinessRequest r) {
        return directory.update(principal.userId(), businessId,
                new BusinessDirectoryService.UpdateCommand(r.categoryId(),
                        Boolean.TRUE.equals(r.clearCategory()), r.name(), r.description(),
                        r.phone(), r.email(), r.websiteUrl(), r.visibilityScope(),
                        r.communityId(), r.selectedCommunityIds()));
    }

    @PostMapping("/businesses/{businessId}/publish")
    public BusinessView publish(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        return directory.publish(principal.userId(), businessId);
    }

    @PostMapping("/businesses/{businessId}/unpublish")
    public BusinessView unpublish(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        return directory.unpublish(principal.userId(), businessId);
    }

    @DeleteMapping("/businesses/{businessId}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        directory.delete(principal.userId(), businessId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me/businesses")
    public Page<BusinessView> managed(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID businessAccountId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return directory.managed(principal.userId(), businessAccountId, cursor, size);
    }

    // =================== discovery ===================

    @GetMapping("/businesses")
    public Page<BusinessView> discover(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID countryId,
            @RequestParam(required = false) UUID communityId,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) String city,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Boolean verifiedOnly,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude,
            @RequestParam(required = false) Integer radiusMeters,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return directory.discover(principal.userId(),
                new BusinessDirectoryService.SearchCommand(countryId, communityId, categoryId,
                        city, search, verifiedOnly, latitude, longitude, radiusMeters, sort,
                        cursor, size));
    }

    // =================== branches and hours ===================

    @GetMapping("/businesses/{businessId}/locations")
    public Map<String, Object> locations(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        return Map.of("items", branches.list(principal.userId(), businessId));
    }

    @PostMapping("/businesses/{businessId}/locations")
    public ResponseEntity<BranchView> createBranch(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @Valid @RequestBody BranchRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(branches.create(
                principal.userId(), businessId, branchCommand(request)));
    }

    @PatchMapping("/businesses/{businessId}/locations/{locationId}")
    public BranchView updateBranch(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @PathVariable UUID locationId,
            @Valid @RequestBody BranchRequest request) {
        return branches.update(principal.userId(), businessId, locationId,
                branchCommand(request));
    }

    @DeleteMapping("/businesses/{businessId}/locations/{locationId}")
    public ResponseEntity<Void> deactivateBranch(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @PathVariable UUID locationId) {
        branches.deactivate(principal.userId(), businessId, locationId);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/businesses/{businessId}/locations/{locationId}/hours")
    public Map<String, Object> hours(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @PathVariable UUID locationId,
            @Valid @RequestBody HoursRequest request) {
        return Map.of("items", branches.replaceHours(principal.userId(), businessId, locationId,
                request.hours().stream().map(h -> new BusinessBranchService.HourCommand(
                        h.dayOfWeek(), h.openTime(), h.closeTime(), h.closed())).toList()));
    }

    private static BusinessBranchService.BranchCommand branchCommand(BranchRequest r) {
        var a = r.address();
        var address = a == null ? null : new BusinessBranchService.AddressCommand(
                a.addressLine1(), a.addressLine2(), a.city(), a.region(), a.postalCode(),
                a.formattedAddress(), a.latitude(), a.longitude(),
                Boolean.TRUE.equals(a.clearCoordinates()));
        return new BusinessBranchService.BranchCommand(r.locationName(), r.phone(), r.primary(),
                r.active(), r.timezone(), address);
    }

    // =================== media ===================

    @GetMapping("/businesses/{businessId}/media")
    public Map<String, Object> media(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        return Map.of("items", directory.media(principal.userId(), businessId));
    }

    @PostMapping("/businesses/{businessId}/media")
    public ResponseEntity<MediaView> attachMedia(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @Valid @RequestBody MediaRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(directory.attachMedia(
                principal.userId(), businessId, request.mediaId(), request.sortOrder(),
                request.role()));
    }

    @PatchMapping("/businesses/{businessId}/media/{mediaId}")
    public MediaView updateMedia(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @PathVariable UUID mediaId,
            @Valid @RequestBody UpdateMediaRequest request) {
        return directory.updateMedia(principal.userId(), businessId, mediaId,
                request.sortOrder(), request.role());
    }

    @DeleteMapping("/businesses/{businessId}/media/{mediaId}")
    public ResponseEntity<Void> detachMedia(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @PathVariable UUID mediaId) {
        directory.detachMedia(principal.userId(), businessId, mediaId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/businesses/{businessId}/media/{mediaId}/download-url")
    public Map<String, String> mediaUrl(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @PathVariable UUID mediaId) {
        return Map.of("downloadUrl", directory.mediaDownloadUrl(principal.userId(),
                businessId, mediaId));
    }

    // =================== reviews and ratings ===================

    @GetMapping("/businesses/{businessId}/reviews")
    public Page<ReviewView> reviews(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return engagement.reviews(principal.userId(), businessId, cursor, size);
    }

    @PostMapping("/businesses/{businessId}/reviews")
    public ResponseEntity<ReviewView> createReview(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @Valid @RequestBody ReviewRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(engagement.createReview(
                principal.userId(), businessId, request.rating(), request.body()));
    }

    @PatchMapping("/businesses/{businessId}/reviews/{reviewId}")
    public ReviewView updateReview(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @PathVariable UUID reviewId,
            @Valid @RequestBody ReviewRequest request) {
        return engagement.updateReview(principal.userId(), businessId, reviewId,
                request.rating(), request.body());
    }

    @DeleteMapping("/businesses/{businessId}/reviews/{reviewId}")
    public ResponseEntity<Void> deleteReview(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @PathVariable UUID reviewId) {
        engagement.deleteReview(principal.userId(), businessId, reviewId);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/businesses/{businessId}/reviews/{reviewId}/response")
    public ReviewView reviewResponse(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @PathVariable UUID reviewId,
            @Valid @RequestBody ReviewResponseRequest request) {
        return engagement.respondToReview(principal.userId(), businessId, reviewId,
                request.response());
    }

    @GetMapping("/businesses/{businessId}/rating")
    public BusinessEngagementService.RatingSummary rating(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        return engagement.rating(principal.userId(), businessId);
    }

    @PostMapping("/businesses/{businessId}/report")
    public ResponseEntity<Map<String, Object>> reportBusiness(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @Valid @RequestBody ReportRequest request) {
        UUID id = engagement.reportBusiness(principal.userId(), businessId, request.reason(),
                request.details());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id.toString()));
    }

    @PostMapping("/businesses/{businessId}/reviews/{reviewId}/report")
    public ResponseEntity<Map<String, Object>> reportReview(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @PathVariable UUID reviewId,
            @Valid @RequestBody ReportRequest request) {
        UUID id = engagement.reportReview(principal.userId(), businessId, reviewId,
                request.reason(), request.details());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id.toString()));
    }

    // =================== saves ===================

    @PutMapping("/businesses/{businessId}/save")
    public ResponseEntity<Void> save(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        engagement.save(principal.userId(), businessId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/businesses/{businessId}/save")
    public ResponseEntity<Void> unsave(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        engagement.unsave(principal.userId(), businessId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me/businesses/saved")
    public Page<BusinessView> saved(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return engagement.saved(principal.userId(), cursor, size);
    }

    // =================== verification and contact ===================

    @GetMapping("/businesses/{businessId}/verification")
    public BusinessDirectoryAdminService.VerificationView verification(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        return admin.verification(principal.userId(), businessId);
    }

    @PostMapping("/businesses/{businessId}/verification/request")
    public BusinessDirectoryAdminService.VerificationView requestVerification(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        return admin.requestVerification(principal.userId(), businessId);
    }

    @PatchMapping("/admin/businesses/{businessId}/verification")
    public BusinessDirectoryAdminService.VerificationView changeVerification(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId, @Valid @RequestBody VerificationRequest request) {
        return admin.changeVerification(principal.userId(), businessId, request.status(),
                request.reason());
    }

    @PostMapping("/businesses/{businessId}/contact")
    public Map<String, String> contact(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID businessId) {
        return Map.of("conversationId", directory.contact(principal.userId(), businessId)
                .toString());
    }
}
