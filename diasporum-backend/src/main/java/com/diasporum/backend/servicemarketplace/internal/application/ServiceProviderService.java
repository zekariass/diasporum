package com.diasporum.backend.servicemarketplace.internal.application;

import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.badRequest;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.conflict;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.forbidden;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.notFound;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Category;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Cursor;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Page;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Provider;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderSearch;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ServiceRequest;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceCursor;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceProviderRepository;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Provider registration, management and PostGIS discovery. */
@Service
public class ServiceProviderService {
    private static final Set<String> SORTS = Set.of("NEWEST", "DISTANCE");
    private static final Set<String> EDITABLE_STATUSES = Set.of("ACTIVE", "PAUSED");

    private final ServiceProviderRepository repository;
    private final ServiceMarketplaceSupport support;
    private final BusinessAccountsApi businesses;

    public ServiceProviderService(ServiceProviderRepository repository,
            ServiceMarketplaceSupport support, BusinessAccountsApi businesses) {
        this.repository = repository;
        this.support = support;
        this.businesses = businesses;
    }

    public List<Category> categories(String languageCode, UUID parentId) {
        String language = languageCode == null || languageCode.isBlank() ? "en" : languageCode;
        if (!repository.languageExists(language)) {
            throw badRequest("LANGUAGE_NOT_AVAILABLE");
        }
        return repository.categories(language, parentId);
    }

    @Transactional
    public Provider create(UUID actorUserId, ProviderInput in) {
        support.requireActive(actorUserId);
        validate(in);
        if (in.businessAccountId() != null) {
            boolean manager = businesses.isActiveMember(actorUserId, in.businessAccountId())
                    && businesses.membershipsOf(actorUserId).stream().anyMatch(m ->
                            m.accountId().equals(in.businessAccountId())
                                    && "ACTIVE".equals(m.status())
                                    && ServiceMarketplaceSupport.MANAGER_ROLES.contains(m.role()));
            if (!manager) {
                throw forbidden("BUSINESS_PROVIDER_MANAGER_REQUIRED");
            }
        }
        try {
            UUID ownerUserId = in.businessAccountId() == null ? actorUserId : null;
            return support.enrich(actorUserId, repository.insert(UUID.randomUUID(), ownerUserId, in));
        } catch (DuplicateKeyException e) {
            throw conflict("PROVIDER_ALREADY_EXISTS");
        }
    }

    public Provider get(UUID actorUserId, UUID providerId) {
        support.requireActive(actorUserId);
        Provider provider = support.requireProvider(providerId);
        if (!"ACTIVE".equals(provider.status()) && !support.canManage(actorUserId, provider)) {
            throw notFound("SERVICE_PROVIDER_NOT_FOUND");
        }
        return support.enrich(actorUserId, provider);
    }

    @Transactional
    public Provider update(UUID actorUserId, UUID providerId, ProviderInput in) {
        Provider provider = support.requireProvider(providerId);
        support.requireProviderManager(actorUserId, provider);
        if (!EDITABLE_STATUSES.contains(provider.status())) {
            throw conflict("PROVIDER_NOT_EDITABLE");
        }
        validate(in);
        if (in.businessAccountId() != null
                && !in.businessAccountId().equals(provider.businessAccountId())) {
            throw badRequest("PROVIDER_OWNER_IMMUTABLE");
        }
        return support.enrich(actorUserId, repository.update(providerId, in));
    }

    @Transactional
    public void delete(UUID actorUserId, UUID providerId) {
        Provider provider = support.requireProvider(providerId);
        support.requireProviderManager(actorUserId, provider);
        if (!EDITABLE_STATUSES.contains(provider.status())) {
            throw conflict("PROVIDER_NOT_EDITABLE");
        }
        repository.setStatus(providerId, "CLOSED");
    }

    @Transactional
    public Provider close(UUID actorUserId, UUID providerId) {
        Provider provider = support.requireProvider(providerId);
        support.requireProviderManager(actorUserId, provider);
        if (!EDITABLE_STATUSES.contains(provider.status())) {
            throw conflict("PROVIDER_NOT_EDITABLE");
        }
        repository.setStatus(providerId, "CLOSED");
        return get(actorUserId, providerId);
    }

    @Transactional
    public Provider pause(UUID actorUserId, UUID providerId) {
        return setStatus(actorUserId, providerId, "ACTIVE", "PAUSED");
    }

    @Transactional
    public Provider resume(UUID actorUserId, UUID providerId) {
        return setStatus(actorUserId, providerId, "PAUSED", "ACTIVE");
    }

    private Provider setStatus(UUID actorUserId, UUID providerId, String from, String to) {
        Provider provider = support.requireProvider(providerId);
        support.requireProviderManager(actorUserId, provider);
        if (!from.equals(provider.status())) {
            throw conflict("PROVIDER_STATUS_CONFLICT");
        }
        repository.setStatus(providerId, to);
        return get(actorUserId, providerId);
    }

    public Page<Provider> owned(UUID actorUserId, String status, String encodedCursor, Integer size) {
        support.requireActive(actorUserId);
        if (status != null && !Set.of("ACTIVE", "PAUSED", "SUSPENDED", "CLOSED").contains(status)) {
            throw badRequest("INVALID_PROVIDER_STATUS");
        }
        List<UUID> businessIds = support.manageableBusinessIds(actorUserId);
        int limit = ServiceCursor.pageSize(size);
        String fingerprint = ServiceCursor.fingerprint(actorUserId + ":" + status + ":" + businessIds);
        Cursor cursor = ServiceCursor.decode(encodedCursor, "NEWEST", fingerprint);
        List<Provider> rows = repository.owned(actorUserId, businessIds, status, cursor, limit);
        String next = next(rows, limit, "NEWEST", fingerprint);
        return new Page<>(support.enrichProviders(actorUserId, rows.stream().limit(limit).toList()), next);
    }

    public Page<Provider> discover(UUID actorUserId, ProviderSearch search,
            String encodedCursor, Integer size) {
        support.requireActive(actorUserId);
        String sort = normalizeSort(search.sort());
        if (search.categoryId() != null && !repository.activeCategory(search.categoryId())) {
            throw badRequest("CATEGORY_NOT_AVAILABLE");
        }
        if ("DISTANCE".equals(sort) && (search.originLatitude() == null
                || search.originLongitude() == null)) {
            throw badRequest("ORIGIN_REQUIRED_FOR_DISTANCE");
        }
        if ((search.originLatitude() == null) != (search.originLongitude() == null)
                || (search.radiusKm() != null && search.originLatitude() == null)) {
            throw badRequest("COMPLETE_ORIGIN_REQUIRED");
        }
        if (search.originLatitude() != null) {
            coordinates(search.originLatitude(), search.originLongitude());
        }
        if (search.radiusKm() != null && (search.radiusKm().compareTo(BigDecimal.ONE) < 0
                || search.radiusKm().doubleValue() > 300d)) {
            throw badRequest("INVALID_RADIUS");
        }
        int limit = ServiceCursor.pageSize(size);
        String fingerprint = ServiceCursor.fingerprint(search.toString());
        Cursor cursor = ServiceCursor.decode(encodedCursor, sort, fingerprint);
        ProviderSearch normalized = new ProviderSearch(search.categoryId(), search.originLatitude(),
                search.originLongitude(), search.radiusKm(), search.query(), sort);
        List<Provider> rows = repository.discover(normalized, cursor, limit);
        String next = next(rows, limit, sort, fingerprint);
        return new Page<>(support.enrichProviders(actorUserId, rows.stream().limit(limit).toList()), next);
    }

    public Page<Provider> matching(UUID actorUserId, UUID requestId, Double maxDistanceKm,
            String requestedSort, String encodedCursor, Integer size) {
        ServiceRequest request = support.requireRequestVisible(actorUserId, requestId);
        String sort = normalizeSort(requestedSort);
        double distance = maxDistanceKm == null ? 300d : maxDistanceKm;
        if (distance < 1d || distance > 300d) {
            throw badRequest("INVALID_RADIUS");
        }
        int limit = ServiceCursor.pageSize(size);
        String fingerprint = ServiceCursor.fingerprint(requestId + ":" + distance + ":" + sort);
        Cursor cursor = ServiceCursor.decode(encodedCursor, sort, fingerprint);
        List<Provider> rows = repository.matching(request.id(), distance, sort, cursor, limit);
        String next = next(rows, limit, sort, fingerprint);
        return new Page<>(support.enrichProviders(actorUserId, rows.stream().limit(limit).toList()), next);
    }

    private String next(List<Provider> rows, int limit, String sort, String fingerprint) {
        if (rows.size() <= limit) {
            return null;
        }
        Provider last = rows.get(limit - 1);
        String primary = "DISTANCE".equals(sort)
                ? last.distanceMeters().toString() : last.createdAt().toString();
        return ServiceCursor.encode(new Cursor(sort, fingerprint, primary, null, last.id()));
    }

    private String normalizeSort(String sort) {
        String normalized = sort == null || sort.isBlank() ? "NEWEST" : sort;
        if (!SORTS.contains(normalized)) {
            throw badRequest("INVALID_SORT");
        }
        return normalized;
    }

    private void validate(ProviderInput in) {
        if (in == null || in.displayName() == null || in.displayName().isBlank()
                || in.categoryIds() == null || in.categoryIds().isEmpty()) {
            throw badRequest("INVALID_PROVIDER");
        }
        if (in.displayName().trim().length() > 120
                || (in.description() != null && in.description().length() > 4000)
                || in.categoryIds().size() > 20
                || in.categoryIds().stream().distinct().count() != in.categoryIds().size()) {
            throw badRequest("INVALID_PROVIDER");
        }
        coordinates(in.baseLatitude(), in.baseLongitude());
        if (in.radiusKm() == null || in.radiusKm().compareTo(BigDecimal.ONE) < 0
                || in.radiusKm().doubleValue() > 300d) {
            throw badRequest("INVALID_RADIUS");
        }
        for (UUID categoryId : in.categoryIds()) {
            if (!repository.activeCategory(categoryId)) {
                throw badRequest("CATEGORY_NOT_AVAILABLE");
            }
        }
    }

    static void coordinates(Double latitude, Double longitude) {
        if (latitude == null || longitude == null || !Double.isFinite(latitude)
                || !Double.isFinite(longitude) || latitude < -90d || latitude > 90d
                || longitude < -180d || longitude > 180d) {
            throw badRequest("INVALID_COORDINATES");
        }
    }
}
