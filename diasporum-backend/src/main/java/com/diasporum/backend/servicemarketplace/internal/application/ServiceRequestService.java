package com.diasporum.backend.servicemarketplace.internal.application;

import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.badRequest;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.conflict;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.forbidden;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.notFound;

import com.diasporum.backend.billing.BillingApi;
import com.diasporum.backend.billing.BillingApi.ConsumptionCommand;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Cursor;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Page;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Provider;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.RequestInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.RequestSearch;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ServiceRequest;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceCursor;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceProviderRepository;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceRequestRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Currency;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Customer request lifecycle, publishing charges and provider discovery. */
@Service
public class ServiceRequestService {
    private static final Set<String> SORTS = Set.of(
            "NEWEST", "DISTANCE", "PRICE_ASC", "PRICE_DESC");
    private static final BigDecimal MISSING_LAST =
            new BigDecimal("1000000000000000000000000000000");

    private final ServiceRequestRepository repository;
    private final ServiceProviderRepository providers;
    private final ServiceMarketplaceSupport support;
    private final BillingApi billing;
    private final MediaApi media;

    public ServiceRequestService(ServiceRequestRepository repository,
            ServiceProviderRepository providers, ServiceMarketplaceSupport support,
            BillingApi billing, MediaApi media) {
        this.repository = repository;
        this.providers = providers;
        this.support = support;
        this.billing = billing;
        this.media = media;
    }

    @Transactional
    public ServiceRequest create(UUID actorUserId, RequestInput in) {
        support.requireActive(actorUserId);
        validate(actorUserId, in);
        return support.enrich(actorUserId, repository.insert(UUID.randomUUID(), actorUserId, in));
    }

    public ServiceRequest get(UUID actorUserId, UUID requestId) {
        support.requireActive(actorUserId);
        return support.enrich(actorUserId, support.requireRequestVisible(actorUserId, requestId));
    }

    public String mediaDownloadUrl(UUID actorUserId, UUID requestId, UUID mediaId) {
        support.requireRequestVisible(actorUserId, requestId);
        if (!repository.hasMedia(requestId, mediaId)) {
            throw notFound("SERVICE_REQUEST_MEDIA_NOT_FOUND");
        }
        return media.authorizedDownloadUrl(mediaId);
    }

    @Transactional
    public ServiceRequest update(UUID actorUserId, UUID requestId, RequestInput in) {
        support.requireActive(actorUserId);
        ServiceRequest request = repository.findForUpdate(requestId)
                .orElseThrow(() -> notFound("SERVICE_REQUEST_NOT_FOUND"));
        requireOwner(actorUserId, request);
        if (!Set.of("DRAFT", "OPEN", "PAUSED").contains(request.status())) {
            throw conflict("REQUEST_NOT_EDITABLE");
        }
        validate(actorUserId, in);
        if (!"DRAFT".equals(request.status())) {
            if (!Objects.equals(request.serviceCategoryId(), in.serviceCategoryId())
                    || !Objects.equals(request.countryId(), in.countryId())
                    || !Objects.equals(request.addressId(), in.addressId())) {
                throw conflict("PUBLISHED_REQUEST_REFERENCE_IMMUTABLE");
            }
            if (Double.compare(request.latitude(), in.latitude()) != 0
                    || Double.compare(request.longitude(), in.longitude()) != 0) {
                throw conflict("PUBLISHED_LOCATION_IMMUTABLE");
            }
        }
        return support.enrich(actorUserId, repository.update(requestId, in));
    }

    @Transactional
    public ServiceRequest publish(UUID actorUserId, UUID requestId) {
        support.requireActive(actorUserId);
        ServiceRequest request = repository.findForUpdate(requestId)
                .orElseThrow(() -> notFound("SERVICE_REQUEST_NOT_FOUND"));
        requireOwner(actorUserId, request);
        if ("OPEN".equals(request.status())) {
            return support.enrich(actorUserId, request);
        }
        if (!"DRAFT".equals(request.status())) {
            throw conflict("REQUEST_NOT_PUBLISHABLE");
        }
        if (request.expiresAt() != null && !request.expiresAt().isAfter(Instant.now())) {
            throw badRequest("REQUEST_EXPIRY_MUST_BE_FUTURE");
        }
        billing.consume(new ConsumptionCommand(actorUserId, null, "SERVICE_JOB_POST", 1,
                "SERVICE_REQUEST", requestId, "service-job-post:" + requestId));
        repository.setStatus(requestId, "OPEN", true);
        return support.enrich(actorUserId, support.requireRequest(requestId));
    }

    @Transactional
    public ServiceRequest pause(UUID actorUserId, UUID requestId) {
        return transition(actorUserId, requestId, Set.of("OPEN"), "PAUSED");
    }

    @Transactional
    public ServiceRequest resume(UUID actorUserId, UUID requestId) {
        return transition(actorUserId, requestId, Set.of("PAUSED"), "OPEN");
    }

    @Transactional
    public ServiceRequest close(UUID actorUserId, UUID requestId) {
        return transition(actorUserId, requestId, Set.of("OPEN", "PAUSED"), "CLOSED");
    }

    @Transactional
    public ServiceRequest cancel(UUID actorUserId, UUID requestId) {
        return transition(actorUserId, requestId, Set.of("DRAFT", "OPEN", "PAUSED"), "CANCELLED");
    }

    @Transactional
    public void delete(UUID actorUserId, UUID requestId) {
        ServiceRequest request = requireOwned(actorUserId, requestId);
        if (!"DRAFT".equals(request.status())) {
            throw conflict("ONLY_DRAFT_REQUEST_CAN_BE_DELETED");
        }
        repository.softDelete(requestId);
    }

    private ServiceRequest transition(UUID actorUserId, UUID requestId,
            Set<String> allowed, String target) {
        ServiceRequest request = requireOwned(actorUserId, requestId);
        if (!allowed.contains(request.status())) {
            throw conflict("REQUEST_STATUS_CONFLICT");
        }
        if ("OPEN".equals(target) && request.expiresAt() != null
                && !request.expiresAt().isAfter(Instant.now())) {
            throw conflict("REQUEST_EXPIRED");
        }
        repository.setStatus(requestId, target, "OPEN".equals(target));
        return support.enrich(actorUserId, support.requireRequest(requestId));
    }

    public Page<ServiceRequest> owned(UUID actorUserId, String status,
            String encodedCursor, Integer size) {
        support.requireActive(actorUserId);
        if (status != null && !Set.of("DRAFT", "OPEN", "PAUSED", "CLOSED", "EXPIRED",
                "CANCELLED", "REMOVED").contains(status)) {
            throw badRequest("INVALID_REQUEST_STATUS");
        }
        int limit = ServiceCursor.pageSize(size);
        String fingerprint = ServiceCursor.fingerprint(actorUserId + ":" + status);
        Cursor cursor = ServiceCursor.decode(encodedCursor, "NEWEST", fingerprint);
        List<ServiceRequest> rows = repository.owned(actorUserId, status, cursor, limit);
        String next = next(rows, limit, "NEWEST", fingerprint);
        return new Page<>(support.enrichRequests(actorUserId, rows.stream().limit(limit).toList()), next);
    }

    public Page<ServiceRequest> discover(UUID actorUserId, RequestSearch search,
            String encodedCursor, Integer size) {
        support.requireActive(actorUserId);
        if (search.serviceProviderId() == null) {
            throw badRequest("SERVICE_PROVIDER_REQUIRED");
        }
        String sort = search.sort() == null || search.sort().isBlank() ? "NEWEST" : search.sort();
        if (!SORTS.contains(sort)) {
            throw badRequest("INVALID_SORT");
        }
        if (sort.startsWith("PRICE_") && (search.currencyCode() == null
                || search.currencyCode().isBlank())) {
            throw badRequest("CURRENCY_REQUIRED_FOR_PRICE_SORT");
        }
        if ("DISTANCE".equals(sort) && search.serviceProviderId() == null) {
            throw badRequest("PROVIDER_REQUIRED_FOR_DISTANCE");
        }
        if (search.maxDistanceKm() != null && search.serviceProviderId() == null) {
            throw badRequest("PROVIDER_REQUIRED_FOR_DISTANCE");
        }
        if (search.maxDistanceKm() != null && (search.maxDistanceKm().doubleValue() < 1d
                || search.maxDistanceKm().doubleValue() > 300d)) {
            throw badRequest("INVALID_RADIUS");
        }
        if (search.budgetMin() != null && search.budgetMax() != null
                && search.budgetMin().compareTo(search.budgetMax()) > 0) {
            throw badRequest("INVALID_BUDGET_RANGE");
        }
        if (search.preferredDateFrom() != null && search.preferredDateTo() != null
                && search.preferredDateFrom().isAfter(search.preferredDateTo())) {
            throw badRequest("INVALID_DATE_RANGE");
        }
        if (search.categoryId() != null && !providers.activeCategory(search.categoryId())) {
            throw badRequest("CATEGORY_NOT_AVAILABLE");
        }
        if (search.countryId() != null && !providers.activeCountry(search.countryId())) {
            throw badRequest("COUNTRY_NOT_AVAILABLE");
        }
        if (search.currencyCode() != null) {
            currency(search.currencyCode());
        }
        if (search.serviceProviderId() != null) {
            Provider provider = support.requireProvider(search.serviceProviderId());
            support.requireProviderManager(actorUserId, provider);
            if (!"ACTIVE".equals(provider.status())) {
                throw conflict("PROVIDER_NOT_ACTIVE");
            }
            if (search.categoryId() != null
                    && !providers.providerOwnsCategory(provider.id(), search.categoryId())) {
                throw badRequest("PROVIDER_CATEGORY_MISMATCH");
            }
        }
        int limit = ServiceCursor.pageSize(size);
        RequestSearch normalized = new RequestSearch(search.serviceProviderId(), search.categoryId(),
                search.countryId(), search.city(), search.budgetMin(), search.budgetMax(),
                search.currencyCode() == null ? null : search.currencyCode().toUpperCase(),
                search.preferredDateFrom(), search.preferredDateTo(), search.maxDistanceKm(), sort);
        String fingerprint = ServiceCursor.fingerprint(normalized.toString());
        Cursor cursor = ServiceCursor.decode(encodedCursor, sort, fingerprint);
        List<ServiceRequest> rows = repository.discover(actorUserId, search.serviceProviderId(),
                normalized, cursor, limit);
        String next = next(rows, limit, sort, fingerprint);
        return new Page<>(support.enrichRequests(actorUserId, rows.stream().limit(limit).toList()), next);
    }

    private String next(List<ServiceRequest> rows, int limit, String sort, String fingerprint) {
        if (rows.size() <= limit) {
            return null;
        }
        ServiceRequest last = rows.get(limit - 1);
        String primary;
        String secondary = null;
        if ("DISTANCE".equals(sort)) {
            primary = last.distanceMeters().toString();
        } else if (sort.startsWith("PRICE_")) {
            BigDecimal missing = "PRICE_ASC".equals(sort) ? MISSING_LAST : MISSING_LAST.negate();
            BigDecimal first = last.budgetMin() != null ? last.budgetMin() : last.budgetMax();
            BigDecimal second = last.budgetMax() != null ? last.budgetMax() : last.budgetMin();
            primary = (first == null ? missing : first).toString();
            secondary = (second == null ? missing : second).toString();
        } else {
            primary = last.publishedAt().toString();
        }
        return ServiceCursor.encode(new Cursor(sort, fingerprint, primary, secondary, last.id()));
    }

    private ServiceRequest requireOwned(UUID actorUserId, UUID requestId) {
        support.requireActive(actorUserId);
        ServiceRequest request = support.requireRequest(requestId);
        requireOwner(actorUserId, request);
        return request;
    }

    private void requireOwner(UUID actorUserId, ServiceRequest request) {
        if (!actorUserId.equals(request.customerUserId())) {
            throw forbidden("REQUEST_OWNER_REQUIRED");
        }
    }

    private void validate(UUID actorUserId, RequestInput in) {
        if (in == null || in.title() == null || in.title().isBlank()
                || in.description() == null || in.description().isBlank()
                || in.title().length() > 160 || in.description().length() > 6000) {
            throw badRequest("INVALID_SERVICE_REQUEST");
        }
        ServiceProviderService.coordinates(in.latitude(), in.longitude());
        if (!providers.activeCategory(in.serviceCategoryId())
                || !providers.activeCountry(in.countryId())) {
            throw badRequest("REFERENCE_DATA_NOT_AVAILABLE");
        }
        if (in.addressId() != null
                && !repository.ownedAddress(in.addressId(), actorUserId, in.countryId())) {
            throw badRequest("ADDRESS_NOT_AVAILABLE");
        }
        if (in.expiresAt() != null && !in.expiresAt().isAfter(Instant.now())) {
            throw badRequest("REQUEST_EXPIRY_MUST_BE_FUTURE");
        }
        boolean hasBudget = in.budgetMin() != null || in.budgetMax() != null;
        if (hasBudget && in.currencyCode() == null) {
            throw badRequest("CURRENCY_REQUIRED_WITH_BUDGET");
        }
        if (!hasBudget && in.currencyCode() != null) {
            throw badRequest("CURRENCY_NOT_ALLOWED_WITHOUT_BUDGET");
        }
        if (in.budgetMin() != null && in.budgetMin().signum() < 0
                || in.budgetMax() != null && in.budgetMax().signum() < 0
                || in.budgetMin() != null && in.budgetMax() != null
                && in.budgetMin().compareTo(in.budgetMax()) > 0) {
            throw badRequest("INVALID_BUDGET_RANGE");
        }
        if (in.currencyCode() != null) {
            currency(in.currencyCode());
        }
        List<UUID> mediaIds = in.mediaIds() == null ? List.of() : in.mediaIds();
        if (mediaIds.size() > 5 || mediaIds.stream().distinct().count() != mediaIds.size()) {
            throw badRequest("INVALID_REQUEST_MEDIA");
        }
        for (UUID mediaId : mediaIds) {
            if (!media.validateForAttach(mediaId, actorUserId, "SERVICE_REQUEST")) {
                throw badRequest("MEDIA_NOT_READY");
            }
        }
        if (in.mediaIds() == null) {
            throw badRequest("MEDIA_IDS_REQUIRED");
        }
    }

    private static void currency(String value) {
        try {
            Currency.getInstance(value.toUpperCase());
        } catch (Exception e) {
            throw badRequest("INVALID_CURRENCY");
        }
    }
}
