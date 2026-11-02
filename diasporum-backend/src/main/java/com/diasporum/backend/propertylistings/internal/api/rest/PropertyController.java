package com.diasporum.backend.propertylistings.internal.api.rest;

import com.diasporum.backend.propertylistings.internal.application.PropertyDiscoveryService;
import com.diasporum.backend.propertylistings.internal.application.PropertyEngagementService;
import com.diasporum.backend.propertylistings.internal.application.PropertyLifecycleService;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyCommand;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyDetail;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyPage;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.SearchCriteria;
import com.diasporum.backend.propertylistings.internal.application.PropertyQueryService;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Property Marketplace REST API. Ownership always comes from the authenticated principal. */
@RestController
@RequestMapping("/api/v1")
public class PropertyController {

    private final PropertyLifecycleService lifecycle;
    private final PropertyQueryService query;
    private final PropertyDiscoveryService discovery;
    private final PropertyEngagementService engagement;

    public PropertyController(PropertyLifecycleService lifecycle,
            PropertyQueryService query, PropertyDiscoveryService discovery,
            PropertyEngagementService engagement) {
        this.lifecycle = lifecycle;
        this.query = query;
        this.discovery = discovery;
        this.engagement = engagement;
    }

    public record MediaOrderRequest(@NotNull List<UUID> mediaIds, UUID coverMediaId) {
    }

    public record ReportRequest(@NotBlank String reason,
            @Size(max = 4000) String details) {
    }

    @GetMapping("/properties/types")
    public Map<String, Object> types(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam UUID countryId) {
        principal.userId();
        return Map.of("items", query.types(countryId));
    }

    @GetMapping("/properties/amenities")
    public Map<String, Object> amenities(
            @AuthenticationPrincipal DiasporumUserPrincipal principal) {
        principal.userId();
        return Map.of("items", query.amenities());
    }

    @PostMapping("/properties")
    public ResponseEntity<PropertyDetail> create(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody PropertyCommand command) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(lifecycle.create(principal.userId(), command));
    }

    @PutMapping("/properties/{propertyId}")
    public PropertyDetail update(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId, @RequestBody PropertyCommand command) {
        return lifecycle.update(principal.userId(), propertyId, command);
    }

    @GetMapping("/properties/{propertyId}")
    public PropertyDetail detail(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId) {
        return query.detail(principal.userId(), propertyId);
    }

    @PostMapping("/properties/{propertyId}/publish")
    public PropertyDetail publish(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId) {
        return lifecycle.publish(principal.userId(), propertyId);
    }

    @PostMapping("/properties/{propertyId}/pause")
    public PropertyDetail pause(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId) {
        return lifecycle.pause(principal.userId(), propertyId);
    }

    @PostMapping("/properties/{propertyId}/reopen")
    public PropertyDetail reopen(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId) {
        return lifecycle.reopen(principal.userId(), propertyId);
    }

    @PostMapping("/properties/{propertyId}/close")
    public PropertyDetail close(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId) {
        return lifecycle.close(principal.userId(), propertyId);
    }

    @GetMapping("/properties")
    public PropertyPage discover(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID countryId,
            @RequestParam(required = false) UUID communityId,
            @RequestParam(required = false) UUID propertyTypeId,
            @RequestParam(required = false) String listingPurpose,
            @RequestParam(required = false) BigDecimal minPrice,
            @RequestParam(required = false) BigDecimal maxPrice,
            @RequestParam(required = false) Integer minBedrooms,
            @RequestParam(required = false) Integer maxBedrooms,
            @RequestParam(required = false) Integer bathrooms,
            @RequestParam(required = false) String furnishedStatus,
            @RequestParam(required = false) String city,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude,
            @RequestParam(required = false) Double radiusKm,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        var criteria = new SearchCriteria(countryId, communityId, propertyTypeId,
                listingPurpose, minPrice, maxPrice, minBedrooms, maxBedrooms, bathrooms,
                furnishedStatus, city, search, latitude, longitude, radiusKm);
        return discovery.discover(principal.userId(), criteria, cursor, size);
    }

    @GetMapping("/me/properties")
    public PropertyPage mine(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) UUID businessAccountId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return discovery.mine(principal.userId(), status, businessAccountId, cursor, size);
    }

    @GetMapping("/me/properties/saved")
    public PropertyPage saved(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return discovery.saved(principal.userId(), cursor, size);
    }

    @PutMapping("/properties/{propertyId}/save")
    public ResponseEntity<Void> save(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId) {
        engagement.save(principal.userId(), propertyId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/properties/{propertyId}/save")
    public ResponseEntity<Void> unsave(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId) {
        engagement.unsave(principal.userId(), propertyId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/properties/{propertyId}/media/{mediaId}")
    public PropertyDetail attachMedia(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId, @PathVariable UUID mediaId) {
        return lifecycle.attachMedia(principal.userId(), propertyId, mediaId);
    }

    @PutMapping("/properties/{propertyId}/media")
    public PropertyDetail reorderMedia(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId, @Valid @RequestBody MediaOrderRequest request) {
        return lifecycle.reorderMedia(principal.userId(), propertyId, request.mediaIds(),
                request.coverMediaId());
    }

    @DeleteMapping("/properties/{propertyId}/media/{mediaId}")
    public PropertyDetail removeMedia(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId, @PathVariable UUID mediaId) {
        return lifecycle.removeMedia(principal.userId(), propertyId, mediaId);
    }

    @GetMapping("/properties/{propertyId}/media/{mediaId}/download-url")
    public Map<String, String> mediaUrl(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId, @PathVariable UUID mediaId) {
        return Map.of("downloadUrl", query.mediaDownloadUrl(principal.userId(), propertyId,
                mediaId));
    }

    @PostMapping("/properties/{propertyId}/enquiry")
    public Map<String, UUID> enquiry(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId) {
        return Map.of("conversationId", engagement.enquiry(principal.userId(), propertyId));
    }

    @PostMapping("/properties/{propertyId}/report")
    public ResponseEntity<Map<String, UUID>> report(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID propertyId, @Valid @RequestBody ReportRequest request) {
        UUID id = engagement.report(principal.userId(), propertyId, request.reason(),
                request.details());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id));
    }
}
