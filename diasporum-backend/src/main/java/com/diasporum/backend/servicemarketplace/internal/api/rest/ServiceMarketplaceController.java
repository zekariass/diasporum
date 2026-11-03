package com.diasporum.backend.servicemarketplace.internal.api.rest;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceProviderService;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceRequestService;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceResponseService;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceReviewService;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Category;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.LeadAccess;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.LeadInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Page;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Provider;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderResponse;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderSearch;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Report;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ReportInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.RequestInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.RequestSearch;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ResponseInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Review;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ReviewInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ServiceRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** REST contract for customer/provider Service Marketplace workflows. */
@RestController
@RequestMapping("/api/v1/service")
public class ServiceMarketplaceController {
    private final ServiceProviderService providers;
    private final ServiceRequestService requests;
    private final ServiceResponseService responses;
    private final ServiceReviewService reviews;

    public ServiceMarketplaceController(ServiceProviderService providers,
            ServiceRequestService requests, ServiceResponseService responses,
            ServiceReviewService reviews) {
        this.providers = providers;
        this.requests = requests;
        this.responses = responses;
        this.reviews = reviews;
    }

    @GetMapping("/categories")
    public List<Category> categories(@RequestParam(required = false) String languageCode,
            @RequestParam(required = false) UUID parentId) {
        return providers.categories(languageCode, parentId);
    }

    @GetMapping("/providers")
    public Page<ProviderView> discoverProviders(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) Double originLatitude,
            @RequestParam(required = false) Double originLongitude,
            @RequestParam(required = false) BigDecimal radiusKm,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return providerPage(providers.discover(principal.userId(),
                new ProviderSearch(categoryId, originLatitude, originLongitude, radiusKm, q, sort), cursor, size));
    }

    @GetMapping("/providers/mine")
    public Page<ProviderView> myProviders(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String status, @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return providerPage(providers.owned(principal.userId(), status, cursor, size));
    }

    @PostMapping("/providers")
    @ResponseStatus(HttpStatus.CREATED)
    public ProviderView createProvider(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody ProviderInputBody body) {
        return providerView(providers.create(principal.userId(), body.domain()));
    }

    @GetMapping("/providers/{providerId}")
    public ProviderView provider(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID providerId) {
        return providerView(providers.get(principal.userId(), providerId));
    }

    @PutMapping("/providers/{providerId}")
    public ProviderView updateProvider(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID providerId, @Valid @RequestBody ProviderInputBody body) {
        return providerView(providers.update(principal.userId(), providerId, body.domain()));
    }

    @DeleteMapping("/providers/{providerId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteProvider(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID providerId) {
        providers.delete(principal.userId(), providerId);
    }

    @PostMapping("/providers/{providerId}/pause")
    public ProviderView pauseProvider(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID providerId) {
        return providerView(providers.pause(principal.userId(), providerId));
    }

    @PostMapping("/providers/{providerId}/resume")
    public ProviderView resumeProvider(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID providerId) {
        return providerView(providers.resume(principal.userId(), providerId));
    }

    @PostMapping("/providers/{providerId}/close")
    public ProviderView closeProvider(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID providerId) {
        return providerView(providers.close(principal.userId(), providerId));
    }

    @GetMapping("/requests/{requestId}/matching-providers")
    public Page<ProviderView> matchingProviders(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId, @RequestParam(required = false) Double maxDistanceKm,
            @RequestParam(required = false) String sort, @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return providerPage(providers.matching(principal.userId(), requestId,
                maxDistanceKm, sort, cursor, size));
    }

    @GetMapping("/requests")
    public Page<RequestView> discoverRequests(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam UUID serviceProviderId,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) UUID countryId,
            @RequestParam(required = false) String city,
            @RequestParam(required = false) BigDecimal budgetMin,
            @RequestParam(required = false) BigDecimal budgetMax,
            @RequestParam(required = false) String currencyCode,
            @RequestParam(required = false) LocalDate preferredDateFrom,
            @RequestParam(required = false) LocalDate preferredDateTo,
            @RequestParam(required = false) BigDecimal maxDistanceKm,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return requestPage(requests.discover(principal.userId(), new RequestSearch(serviceProviderId,
                categoryId, countryId, city, budgetMin, budgetMax, currencyCode, preferredDateFrom,
                preferredDateTo, maxDistanceKm, sort), cursor, size));
    }

    @GetMapping("/requests/mine")
    public Page<RequestView> myRequests(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String status, @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return requestPage(requests.owned(principal.userId(), status, cursor, size));
    }

    @PostMapping("/requests")
    @ResponseStatus(HttpStatus.CREATED)
    public RequestView createRequest(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody RequestInputBody body) {
        return requestView(requests.create(principal.userId(), body.domain()));
    }

    @GetMapping("/requests/{requestId}")
    public RequestView request(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId) {
        return requestView(requests.get(principal.userId(), requestId));
    }

    @GetMapping("/requests/{requestId}/media/{mediaId}/download-url")
    public DownloadUrlView requestMedia(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId, @PathVariable UUID mediaId) {
        return new DownloadUrlView(requests.mediaDownloadUrl(principal.userId(), requestId, mediaId));
    }

    @PutMapping("/requests/{requestId}")
    public RequestView updateRequest(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId, @Valid @RequestBody RequestInputBody body) {
        return requestView(requests.update(principal.userId(), requestId, body.domain()));
    }

    @DeleteMapping("/requests/{requestId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteRequest(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId) {
        requests.delete(principal.userId(), requestId);
    }

    @PostMapping("/requests/{requestId}/publish")
    public RequestView publish(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId) {
        return requestView(requests.publish(principal.userId(), requestId));
    }

    @PostMapping("/requests/{requestId}/pause")
    public RequestView pause(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId) {
        return requestView(requests.pause(principal.userId(), requestId));
    }

    @PostMapping("/requests/{requestId}/resume")
    public RequestView resume(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId) {
        return requestView(requests.resume(principal.userId(), requestId));
    }

    @PostMapping("/requests/{requestId}/close")
    public RequestView close(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId) {
        return requestView(requests.close(principal.userId(), requestId));
    }

    @PostMapping("/requests/{requestId}/cancel")
    public RequestView cancel(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId) {
        return requestView(requests.cancel(principal.userId(), requestId));
    }

    @PostMapping("/requests/{requestId}/responses")
    @ResponseStatus(HttpStatus.CREATED)
    public ProviderResponse respond(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId, @Valid @RequestBody ResponseInputBody body) {
        return responses.respond(principal.userId(), requestId, body.domain());
    }

    @GetMapping("/requests/{requestId}/responses")
    public Page<ProviderResponse> requestResponses(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId, @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return responses.responsesForRequest(principal.userId(), requestId, cursor, size);
    }

    @PostMapping("/requests/{requestId}/lead-access")
    public LeadAccess accessLead(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId, @Valid @RequestBody LeadInput body) {
        return responses.accessLead(principal.userId(), requestId, body);
    }

    @GetMapping("/requests/{requestId}/lead-access")
    public LeadAccess requestLead(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId, @RequestParam UUID serviceProviderId) {
        return responses.getRequestLead(principal.userId(), requestId, serviceProviderId);
    }

    @GetMapping("/requests/{requestId}/reviews")
    public Page<Review> requestReviews(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId, @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return reviews.reviews(principal.userId(), requestId, null, false, cursor, size);
    }

    @PostMapping("/requests/{requestId}/reviews")
    @ResponseStatus(HttpStatus.CREATED)
    public Review createReview(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID requestId, @Valid @RequestBody ReviewInput body) {
        return reviews.createReview(principal.userId(), requestId, body);
    }

    @GetMapping("/providers/{providerId}/reviews")
    public Page<Review> providerReviews(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID providerId, @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return reviews.reviews(principal.userId(), null, providerId, false, cursor, size);
    }

    @GetMapping("/responses/me")
    public Page<ProviderResponse> ownResponses(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID serviceProviderId,
            @RequestParam(required = false) String cursor, @RequestParam(required = false) Integer size) {
        return responses.ownResponses(principal.userId(), serviceProviderId, cursor, size);
    }

    @GetMapping("/responses/{responseId}")
    public ProviderResponse response(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID responseId) {
        return responses.getResponse(principal.userId(), responseId);
    }

    @PutMapping("/responses/{responseId}")
    public ProviderResponse updateResponse(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID responseId, @Valid @RequestBody ResponseInputBody body) {
        return responses.updateResponse(principal.userId(), responseId, body.domain());
    }

    @PostMapping("/responses/{responseId}/withdraw")
    public ProviderResponse withdrawResponse(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID responseId) {
        return responses.withdrawResponse(principal.userId(), responseId);
    }

    @PostMapping("/responses/{responseId}/accept")
    public ProviderResponse acceptResponse(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID responseId) {
        return responses.acceptResponse(principal.userId(), responseId);
    }

    @PostMapping("/responses/{responseId}/decline")
    public ProviderResponse declineResponse(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID responseId) {
        return responses.declineResponse(principal.userId(), responseId);
    }

    @GetMapping("/lead-access/{leadAccessId}")
    public LeadAccess leadAccess(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID leadAccessId) {
        return responses.getLead(principal.userId(), leadAccessId);
    }

    @GetMapping("/reviews/me")
    public Page<Review> ownReviews(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor, @RequestParam(required = false) Integer size) {
        return reviews.reviews(principal.userId(), null, null, true, cursor, size);
    }

    @GetMapping("/reviews/{reviewId}")
    public Review review(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID reviewId) {
        return reviews.getReview(principal.userId(), reviewId);
    }

    @PutMapping("/reviews/{reviewId}")
    public Review updateReview(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID reviewId, @Valid @RequestBody ReviewInput body) {
        return reviews.updateReview(principal.userId(), reviewId, body);
    }

    @PatchMapping("/reviews/{reviewId}/provider-response")
    public Review respondToReview(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID reviewId, @Valid @RequestBody ReviewResponseBody body) {
        return reviews.respondToReview(principal.userId(), reviewId, body.response());
    }

    @PostMapping("/reports")
    @ResponseStatus(HttpStatus.CREATED)
    public Report report(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody ReportInput body) {
        return reviews.report(principal.userId(), body);
    }

    private static Page<ProviderView> providerPage(Page<Provider> page) {
        return new Page<>(page.items().stream().map(ServiceMarketplaceController::providerView).toList(),
                page.nextCursor());
    }

    private static Page<RequestView> requestPage(Page<ServiceRequest> page) {
        return new Page<>(page.items().stream().map(ServiceMarketplaceController::requestView).toList(),
                page.nextCursor());
    }

    private static ProviderView providerView(Provider p) {
        boolean manage = p.canManage();
        return new ProviderView(p.id(), manage ? p.ownerUserId() : null, p.businessAccountId(),
                p.displayName(), p.description(), manage ? p.baseLatitude() : null,
                manage ? p.baseLongitude() : null, manage ? p.radiusKm() : null, p.status(),
                p.verificationStatus(), p.categories(), p.distanceMeters(), manage,
                p.createdAt(), p.updatedAt());
    }

    private static RequestView requestView(ServiceRequest r) {
        return new RequestView(r.id(), r.customerUserId(), r.customerDisplayName(),
                r.serviceCategoryId(), r.categoryDisplayName(), r.countryId(),
                r.canManage() ? r.addressId() : null, r.latitude(), r.longitude(), r.title(),
                r.description(), r.budgetMin(), r.budgetMax(), r.currencyCode(), r.preferredDate(),
                r.status(), r.expiresAt(), r.publishedAt(), r.mediaIds(), r.distanceMeters(),
                r.canManage(), r.createdAt(), r.updatedAt());
    }

    public record DownloadUrlView(String downloadUrl) {
    }

    public record ProviderInputBody(UUID businessAccountId,
            @NotBlank @Size(max = 120) String displayName,
            @Size(max = 4000) String description,
            @NotNull @DecimalMin("-90") @DecimalMax("90") Double baseLatitude,
            @NotNull @DecimalMin("-180") @DecimalMax("180") Double baseLongitude,
            @NotNull @DecimalMin("1") @DecimalMax("300") BigDecimal radiusKm,
            @NotEmpty @Size(max = 20) List<UUID> categoryIds) {
        ProviderInput domain() {
            return new ProviderInput(businessAccountId, displayName, description,
                    baseLatitude, baseLongitude, radiusKm, categoryIds);
        }
    }

    public record RequestInputBody(@NotNull UUID serviceCategoryId, @NotNull UUID countryId,
            UUID addressId, @NotNull @DecimalMin("-90") @DecimalMax("90") Double latitude,
            @NotNull @DecimalMin("-180") @DecimalMax("180") Double longitude,
            @NotBlank @Size(max = 160) String title, @NotBlank @Size(max = 6000) String description,
            @DecimalMin("0") BigDecimal budgetMin, @DecimalMin("0") BigDecimal budgetMax,
            @Size(min = 3, max = 3) String currencyCode, LocalDate preferredDate, Instant expiresAt,
            @NotNull @Size(max = 5) List<UUID> mediaIds) {
        RequestInput domain() {
            return new RequestInput(serviceCategoryId, countryId, addressId, latitude, longitude,
                    title, description, budgetMin, budgetMax, currencyCode, preferredDate, expiresAt, mediaIds);
        }
    }

    public record ResponseInputBody(@NotNull UUID serviceProviderId,
            @NotBlank String responseType, @NotBlank @Size(max = 4000) String message,
            BigDecimal quotedAmount, String currencyCode) {
        ResponseInput domain() {
            return new ResponseInput(serviceProviderId, responseType, message, quotedAmount, currencyCode);
        }
    }

    public record ReviewResponseBody(@NotBlank @Size(max = 2000) String response) {
    }

    public record ProviderView(UUID id, UUID ownerUserId, UUID businessAccountId,
            String displayName, String description, Double baseLatitude, Double baseLongitude,
            BigDecimal radiusKm, String status, String verificationStatus, List<Category> categories,
            Double distanceMeters, boolean canManage, Instant createdAt, Instant updatedAt) {
    }

    public record RequestView(UUID id, UUID customerUserId, String customerDisplayName,
            UUID serviceCategoryId, String categoryDisplayName, UUID countryId, UUID addressId,
            Double latitude, Double longitude, String title, String description,
            BigDecimal budgetMin, BigDecimal budgetMax, String currencyCode, LocalDate preferredDate,
            String status, Instant expiresAt, Instant publishedAt, List<UUID> mediaIds,
            Double distanceMeters, boolean canManage, Instant createdAt, Instant updatedAt) {
    }
}
