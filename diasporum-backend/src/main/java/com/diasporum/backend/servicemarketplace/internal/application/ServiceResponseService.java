package com.diasporum.backend.servicemarketplace.internal.application;

import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.badRequest;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.conflict;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.forbidden;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.notFound;

import com.diasporum.backend.billing.BillingApi;
import com.diasporum.backend.billing.BillingApi.ConsumptionCommand;
import com.diasporum.backend.billing.BillingApi.QuotaConsumption;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Cursor;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.LeadAccess;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.LeadInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Page;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Provider;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderResponse;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ResponseInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ServiceRequest;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceCursor;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceEngagementRepository;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceProviderRepository;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Interest/contact responses and one-time paid lead grants. */
@Service
public class ServiceResponseService {
    private static final Set<String> RESPONSE_TYPES = Set.of("INTEREST", "CONTACT");

    private final ServiceEngagementRepository repository;
    private final ServiceProviderRepository providers;
    private final ServiceMarketplaceSupport support;
    private final BillingApi billing;
    private final JdbcTemplate jdbc;

    public ServiceResponseService(ServiceEngagementRepository repository,
            ServiceProviderRepository providers, ServiceMarketplaceSupport support,
            BillingApi billing, JdbcTemplate jdbc) {
        this.repository = repository;
        this.providers = providers;
        this.support = support;
        this.billing = billing;
        this.jdbc = jdbc;
    }

    @Transactional
    public ProviderResponse respond(UUID actorUserId, UUID requestId, ResponseInput in) {
        ServiceRequest request = support.requireRequestVisible(actorUserId, requestId);
        Provider provider = support.requireProvider(in.serviceProviderId());
        support.requireProviderManager(actorUserId, provider);
        validateResponse(request, provider, in);
        if (repository.findResponse(requestId, provider.id()).isPresent()) {
            throw conflict("PROVIDER_RESPONSE_ALREADY_EXISTS");
        }
        try {
            ProviderResponse response = repository.insertResponse(UUID.randomUUID(), requestId, actorUserId, in);
            support.notify(request.customerUserId(), "SERVICE_RESPONSE", requestId,
                    "service-response:" + response.id());
            return response;
        } catch (DuplicateKeyException e) {
            throw conflict("PROVIDER_RESPONSE_ALREADY_EXISTS");
        }
    }

    public Page<ProviderResponse> responsesForRequest(UUID actorUserId, UUID requestId,
            String encodedCursor, Integer size) {
        ServiceRequest request = support.requireRequestVisible(actorUserId, requestId);
        int limit = ServiceCursor.pageSize(size);
        String fingerprint = ServiceCursor.fingerprint("request-responses:" + requestId);
        Cursor cursor = ServiceCursor.decode(encodedCursor, "NEWEST", fingerprint);
        List<ProviderResponse> rows = repository.responsesForRequest(requestId, cursor, limit);
        boolean owner = actorUserId.equals(request.customerUserId());
        if (!owner) {
            rows = rows.stream().filter(r -> support.canManage(actorUserId,
                    support.requireProvider(r.serviceProviderId()))).toList();
            if (rows.isEmpty()) {
                throw notFound("SERVICE_REQUEST_NOT_FOUND");
            }
        }
        String next = nextResponse(rows, limit, fingerprint);
        return new Page<>(rows.stream().limit(limit).toList(), next);
    }

    public Page<ProviderResponse> ownResponses(UUID actorUserId, UUID providerId,
            String encodedCursor, Integer size) {
        support.requireActive(actorUserId);
        List<UUID> providerIds;
        if (providerId == null) {
            providerIds = providers.manageableProviderIds(actorUserId,
                    support.manageableBusinessIds(actorUserId));
        } else {
            support.requireProviderManager(actorUserId, support.requireProvider(providerId));
            providerIds = List.of(providerId);
        }
        int limit = ServiceCursor.pageSize(size);
        String fingerprint = ServiceCursor.fingerprint("own-responses:" + actorUserId + ":" + providerIds);
        Cursor cursor = ServiceCursor.decode(encodedCursor, "NEWEST", fingerprint);
        List<ProviderResponse> rows = repository.responsesForProviders(providerIds, cursor, limit);
        String next = nextResponse(rows, limit, fingerprint);
        return new Page<>(rows.stream().limit(limit).toList(), next);
    }

    public ProviderResponse getResponse(UUID actorUserId, UUID responseId) {
        ProviderResponse response = repository.findResponse(responseId)
                .orElseThrow(() -> notFound("PROVIDER_RESPONSE_NOT_FOUND"));
        ServiceRequest request = support.requireRequestVisible(actorUserId, response.serviceRequestId());
        if (!actorUserId.equals(request.customerUserId())) {
            support.requireProviderManager(actorUserId,
                    support.requireProvider(response.serviceProviderId()));
        }
        return response;
    }

    @Transactional
    public ProviderResponse updateResponse(UUID actorUserId, UUID responseId, ResponseInput in) {
        ProviderResponse existing = repository.findResponse(responseId)
                .orElseThrow(() -> notFound("PROVIDER_RESPONSE_NOT_FOUND"));
        Provider provider = support.requireProvider(existing.serviceProviderId());
        support.requireProviderManager(actorUserId, provider);
        if (!existing.serviceProviderId().equals(in.serviceProviderId())) {
            throw badRequest("RESPONSE_PROVIDER_IMMUTABLE");
        }
        ServiceRequest request = support.requireRequestVisible(actorUserId, existing.serviceRequestId());
        validateResponse(request, provider, in);
        ProviderResponse updated = repository.updateResponse(responseId, in);
        support.notify(request.customerUserId(), "SERVICE_REQUEST_UPDATE", request.id(),
                "service-response-update:" + responseId + ":" + updated.updatedAt());
        return updated;
    }

    @Transactional
    public ProviderResponse withdrawResponse(UUID actorUserId, UUID responseId) {
        ProviderResponse response = repository.findResponse(responseId)
                .orElseThrow(() -> notFound("PROVIDER_RESPONSE_NOT_FOUND"));
        support.requireProviderManager(actorUserId,
                support.requireProvider(response.serviceProviderId()));
        ProviderResponse updated = transitionResponse(response, "WITHDRAWN");
        ServiceRequest request = support.requireRequest(response.serviceRequestId());
        support.notify(request.customerUserId(), "SERVICE_RESPONSE", request.id(),
                "service-response-withdrawn:" + responseId);
        return updated;
    }

    @Transactional
    public ProviderResponse acceptResponse(UUID actorUserId, UUID responseId) {
        return customerTransition(actorUserId, responseId, "ACCEPTED");
    }

    @Transactional
    public ProviderResponse declineResponse(UUID actorUserId, UUID responseId) {
        return customerTransition(actorUserId, responseId, "DECLINED");
    }

    private ProviderResponse customerTransition(UUID actorUserId, UUID responseId, String status) {
        ProviderResponse response = repository.findResponse(responseId)
                .orElseThrow(() -> notFound("PROVIDER_RESPONSE_NOT_FOUND"));
        ServiceRequest request = support.requireRequestVisible(actorUserId, response.serviceRequestId());
        if (!actorUserId.equals(request.customerUserId())) {
            throw forbidden("REQUEST_OWNER_REQUIRED");
        }
        ProviderResponse updated = transitionResponse(response, status);
        support.notify(response.respondedByUserId(), "SERVICE_RESPONSE", request.id(),
                "service-response-" + status.toLowerCase() + ":" + responseId);
        return updated;
    }

    private ProviderResponse transitionResponse(ProviderResponse response, String nextStatus) {
        if (!"SENT".equals(response.status())
                || !repository.transitionResponse(response.id(), "SENT", nextStatus)) {
            throw conflict("INVALID_RESPONSE_TRANSITION");
        }
        return repository.findResponse(response.id()).orElseThrow();
    }

    @Transactional
    public LeadAccess accessLead(UUID actorUserId, UUID requestId, LeadInput in) {
        ServiceRequest request = support.requireRequestVisible(actorUserId, requestId);
        Provider provider = support.requireProvider(in.serviceProviderId());
        support.requireProviderManager(actorUserId, provider);
        if (!"ACTIVE".equals(provider.status())) {
            throw conflict("PROVIDER_NOT_ACTIVE");
        }
        if (actorUserId.equals(request.customerUserId())) {
            throw conflict("CUSTOMER_CANNOT_PURCHASE_OWN_LEAD");
        }
        if (!providers.providerOwnsCategory(provider.id(), request.serviceCategoryId())) {
            throw conflict("PROVIDER_CATEGORY_MISMATCH");
        }
        if (!in.enableChat() && !in.unlockContactDetails()) {
            throw badRequest("LEAD_CAPABILITY_REQUIRED");
        }
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", Object.class,
                requestId + ":" + provider.id());
        var existing = repository.findLeadForUpdate(requestId, provider.id());
        if (existing.isPresent()) {
            LeadAccess lead = existing.get();
            if (!"ACTIVE".equals(lead.status())) {
                throw conflict("LEAD_ACCESS_REVOKED");
            }
            return withAddress(actorUserId, repository.upgradeLead(lead.id(),
                    in.enableChat(), in.unlockContactDetails()));
        }
        UUID billingUser = provider.ownerUserId() != null ? provider.ownerUserId() : actorUserId;
        UUID businessId = provider.businessAccountId();
        if (provider.ownerUserId() == null) {
            billingUser = null;
        }
        QuotaConsumption consumption = billing.consume(new ConsumptionCommand(billingUser, businessId,
                "SERVICE_LEAD_ACCESS", 1, "SERVICE_REQUEST", requestId,
                "service-lead-access:" + requestId + ":" + provider.id()));
        LeadAccess lead = repository.insertLead(UUID.randomUUID(), requestId, provider.id(),
                actorUserId, consumption.usageRecordId(), in.enableChat(), in.unlockContactDetails());
        support.notify(request.customerUserId(), "SERVICE_REQUEST_UPDATE", requestId,
                "service-lead-access:" + lead.id());
        return withAddress(actorUserId, lead);
    }

    public LeadAccess getLead(UUID actorUserId, UUID leadId) {
        LeadAccess lead = repository.findLead(leadId).orElseThrow(() -> notFound("LEAD_ACCESS_NOT_FOUND"));
        ServiceRequest request = support.requireRequest(lead.serviceRequestId());
        if (!actorUserId.equals(request.customerUserId())) {
            support.requireProviderManager(actorUserId, support.requireProvider(lead.serviceProviderId()));
        }
        return withAddress(actorUserId, lead);
    }

    public LeadAccess getRequestLead(UUID actorUserId, UUID requestId, UUID providerId) {
        if (providerId == null) {
            throw badRequest("SERVICE_PROVIDER_REQUIRED");
        }
        ServiceRequest request = support.requireRequestVisible(actorUserId, requestId);
        LeadAccess lead = repository.findLead(requestId, providerId)
                .orElseThrow(() -> notFound("LEAD_ACCESS_NOT_FOUND"));
        if (!actorUserId.equals(request.customerUserId())) {
            support.requireProviderManager(actorUserId, support.requireProvider(providerId));
        }
        return withAddress(actorUserId, lead);
    }

    private LeadAccess withAddress(UUID actorUserId, LeadAccess lead) {
        if (!lead.contactDetailsUnlocked() || !"ACTIVE".equals(lead.status())) {
            return lead;
        }
        return lead.withAddress(repository.requestAddress(lead.serviceRequestId()).orElse(null));
    }

    private void validateResponse(ServiceRequest request, Provider provider, ResponseInput in) {
        if (!"OPEN".equals(request.status())) {
            throw conflict("REQUEST_NOT_OPEN");
        }
        if (!"ACTIVE".equals(provider.status())) {
            throw conflict("PROVIDER_NOT_ACTIVE");
        }
        if (request.customerUserId().equals(provider.ownerUserId())) {
            throw conflict("CUSTOMER_CANNOT_RESPOND_TO_OWN_REQUEST");
        }
        if (!providers.providerOwnsCategory(provider.id(), request.serviceCategoryId())) {
            throw conflict("PROVIDER_CATEGORY_MISMATCH");
        }
        if (in == null || !RESPONSE_TYPES.contains(in.responseType())
                || in.message() == null || in.message().isBlank() || in.message().length() > 4000) {
            throw badRequest("INVALID_PROVIDER_RESPONSE");
        }
        if (in.quotedAmount() != null || in.currencyCode() != null) {
            throw badRequest("QUOTES_NOT_ENABLED");
        }
    }

    private String nextResponse(List<ProviderResponse> rows, int limit, String fingerprint) {
        if (rows.size() <= limit) {
            return null;
        }
        ProviderResponse last = rows.get(limit - 1);
        return ServiceCursor.encode(new Cursor("NEWEST", fingerprint,
                last.createdAt().toString(), null, last.id()));
    }
}
