package com.diasporum.backend.servicemarketplace.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.notifications.NotificationsApi;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Category;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Provider;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Review;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ServiceRequest;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceProviderRepository;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceRequestRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Shared identity, business-account and projection rules. */
@Component
public class ServiceMarketplaceSupport {
    public static final Set<String> MANAGER_ROLES = Set.of(
            "OWNER", "ADMINISTRATOR", "EDITOR", "LISTING_MANAGER");

    private final IdentityApi identity;
    private final BusinessAccountsApi businesses;
    private final NotificationsApi notifications;
    private final ServiceProviderRepository providers;
    private final ServiceRequestRepository requests;

    public ServiceMarketplaceSupport(IdentityApi identity, BusinessAccountsApi businesses,
            NotificationsApi notifications, ServiceProviderRepository providers,
            ServiceRequestRepository requests) {
        this.identity = identity;
        this.businesses = businesses;
        this.notifications = notifications;
        this.providers = providers;
        this.requests = requests;
    }

    public ProfileSummary requireActive(UUID userId) {
        ProfileSummary profile = identity.profileSummary(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN, "ACTIVE_PROFILE_REQUIRED"));
        if (!"ACTIVE".equals(profile.accountStatus()) || !profile.profileCompleted()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ACTIVE_PROFILE_REQUIRED");
        }
        return profile;
    }

    public String displayName(UUID userId) {
        return identity.profileSummary(userId).map(ProfileSummary::displayName).orElse("Member");
    }

    public boolean canManage(UUID actorUserId, Provider provider) {
        if (actorUserId.equals(provider.ownerUserId())) {
            return true;
        }
        UUID businessId = provider.businessAccountId();
        return businessId != null && businesses.membershipsOf(actorUserId).stream().anyMatch(m ->
                m.accountId().equals(businessId) && "ACTIVE".equals(m.status())
                        && MANAGER_ROLES.contains(m.role()));
    }

    public void requireProviderManager(UUID actorUserId, Provider provider) {
        requireActive(actorUserId);
        if (!canManage(actorUserId, provider)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "PROVIDER_MANAGER_REQUIRED");
        }
    }

    public List<UUID> manageableBusinessIds(UUID actorUserId) {
        return businesses.membershipsOf(actorUserId).stream()
                .filter(m -> "ACTIVE".equals(m.status()) && MANAGER_ROLES.contains(m.role()))
                .map(BusinessAccountsApi.AccountMembershipView::accountId).distinct().toList();
    }

    public ServiceRequest requireRequest(UUID requestId) {
        return requests.find(requestId).orElseThrow(() -> notFound("SERVICE_REQUEST_NOT_FOUND"));
    }

    public Provider requireProvider(UUID providerId) {
        return providers.find(providerId).orElseThrow(() -> notFound("SERVICE_PROVIDER_NOT_FOUND"));
    }

    public ServiceRequest requireRequestVisible(UUID actorUserId, UUID requestId) {
        ServiceRequest request = requireRequest(requestId);
        boolean owner = actorUserId.equals(request.customerUserId());
        boolean publiclyVisible = "OPEN".equals(request.status())
                && (request.expiresAt() == null || request.expiresAt().isAfter(Instant.now()));
        if (!owner && !publiclyVisible) {
            throw notFound("SERVICE_REQUEST_NOT_FOUND");
        }
        return request;
    }

    public Provider enrich(UUID actorUserId, Provider provider) {
        return enrichProviders(actorUserId, List.of(provider)).getFirst();
    }

    public List<Provider> enrichProviders(UUID actorUserId, List<Provider> source) {
        Map<UUID, List<Category>> categories = providers.categoriesFor(source.stream().map(Provider::id).toList());
        return source.stream().map(p -> p.with(categories.getOrDefault(p.id(), List.of()),
                p.distanceMeters(), canManage(actorUserId, p))).toList();
    }

    public ServiceRequest enrich(UUID actorUserId, ServiceRequest request) {
        return enrichRequests(actorUserId, List.of(request)).getFirst();
    }

    public List<ServiceRequest> enrichRequests(UUID actorUserId, List<ServiceRequest> source) {
        Map<UUID, List<UUID>> media = requests.mediaFor(source.stream().map(ServiceRequest::id).toList());
        Map<UUID, String> names = new java.util.HashMap<>();
        return source.stream().map(r -> {
            String name = names.computeIfAbsent(r.customerUserId(), this::displayName);
            return r.with(name, media.getOrDefault(r.id(), List.of()), r.distanceMeters(),
                    actorUserId.equals(r.customerUserId()));
        }).toList();
    }

    public List<Review> enrichReviews(List<Review> source) {
        Map<UUID, String> names = new java.util.HashMap<>();
        return source.stream().map(r -> new Review(r.id(), r.serviceRequestId(), r.serviceProviderId(),
                r.reviewerUserId(), names.computeIfAbsent(r.reviewerUserId(), this::displayName),
                r.rating(), r.reviewText(), r.status(), r.providerResponse(), r.createdAt(), r.updatedAt()))
                .toList();
    }

    public void notify(UUID recipient, String type, UUID serviceRequestId, String dedupeKey) {
        notifications.notify(recipient, type, "Service Marketplace",
                "You have a Service Marketplace update.", "SERVICE_REQUEST",
                serviceRequestId, dedupeKey);
    }

    public static ResponseStatusException badRequest(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }

    public static ResponseStatusException forbidden(String reason) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, reason);
    }

    public static ResponseStatusException notFound(String reason) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, reason);
    }

    public static ResponseStatusException conflict(String reason) {
        return new ResponseStatusException(HttpStatus.CONFLICT, reason);
    }
}
