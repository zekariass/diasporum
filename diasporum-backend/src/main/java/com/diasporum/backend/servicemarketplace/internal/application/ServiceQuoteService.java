package com.diasporum.backend.servicemarketplace.internal.application;

import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.badRequest;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.conflict;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.forbidden;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.notFound;

import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Engagement;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Provider;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Quote;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.QuoteInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.QuoteItemInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ServiceRequest;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceEngagementRepository;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceProviderRepository;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceQuoteRepository;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceRequestRepository;
import java.time.Instant;
import java.util.Currency;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Structured quotes, acceptance and completion-tracked engagements. */
@Service
public class ServiceQuoteService {
    private final ServiceQuoteRepository repository;
    private final ServiceRequestRepository requests;
    private final ServiceProviderRepository providers;
    private final ServiceEngagementRepository engagements;
    private final ServiceMarketplaceSupport support;
    private final ServiceMarketplaceProperties properties;

    public ServiceQuoteService(ServiceQuoteRepository repository, ServiceRequestRepository requests,
            ServiceProviderRepository providers, ServiceEngagementRepository engagements,
            ServiceMarketplaceSupport support, ServiceMarketplaceProperties properties) {
        this.repository = repository;
        this.requests = requests;
        this.providers = providers;
        this.engagements = engagements;
        this.support = support;
        this.properties = properties;
    }

    @Transactional
    public Quote submit(UUID actorUserId, UUID requestId, QuoteInput in) {
        support.requireRequestVisible(actorUserId, requestId);
        Provider provider = support.requireProvider(in.serviceProviderId());
        support.requireProviderManager(actorUserId, provider);
        support.requireApprovedActiveProvider(provider);
        ServiceRequest request = requests.findForUpdate(requestId)
                .orElseThrow(() -> notFound("SERVICE_REQUEST_NOT_FOUND"));
        validateQuote(request, provider, in);
        ensureCapacity(requestId, provider.id());
        int revision = 1;
        if (in.supersedesQuoteId() != null) {
            Quote previous = repository.findQuote(in.supersedesQuoteId())
                    .orElseThrow(() -> badRequest("SUPERSEDED_QUOTE_NOT_FOUND"));
            if (!requestId.equals(previous.serviceRequestId())
                    || !provider.id().equals(previous.serviceProviderId())) {
                throw badRequest("INVALID_QUOTE_REVISION_CHAIN");
            }
            if (!Set.of("SENT", "DECLINED", "EXPIRED").contains(previous.status())) {
                throw conflict("QUOTE_NOT_REVISABLE");
            }
            revision = previous.revisionNo() + 1;
        }
        try {
            Quote quote = repository.insertQuote(UUID.randomUUID(), requestId, actorUserId, in, revision);
            support.notify(request.customerUserId(), "SERVICE_RESPONSE", requestId,
                    "service-quote:" + quote.id());
            return quote;
        } catch (DuplicateKeyException e) {
            throw conflict("QUOTE_REVISION_CONFLICT");
        }
    }

    public List<Quote> quotes(UUID actorUserId, UUID requestId) {
        ServiceRequest request = support.requireRequestVisible(actorUserId, requestId);
        boolean owner = actorUserId.equals(request.customerUserId());
        return repository.quotesForRequest(requestId).stream()
                .filter(q -> owner || support.canManage(actorUserId,
                        support.requireProvider(q.serviceProviderId()))).toList();
    }

    @Transactional
    public Engagement accept(UUID actorUserId, UUID quoteId) {
        Quote quote = repository.findQuote(quoteId).orElseThrow(() -> notFound("QUOTE_NOT_FOUND"));
        ServiceRequest request = requests.findForUpdate(quote.serviceRequestId())
                .orElseThrow(() -> notFound("SERVICE_REQUEST_NOT_FOUND"));
        requireCustomer(actorUserId, request);
        if (!"OPEN".equals(request.status()) || !"SENT".equals(quote.status())
                || quote.validUntil() != null && !quote.validUntil().isAfter(Instant.now())) {
            throw conflict("QUOTE_NOT_ACCEPTABLE");
        }
        if (!repository.transitionQuote(quoteId, "SENT", "ACCEPTED")) {
            throw conflict("QUOTE_STATUS_CONFLICT");
        }
        Quote accepted = repository.findQuote(quoteId).orElseThrow();
        Engagement engagement = repository.insertEngagement(UUID.randomUUID(), accepted, actorUserId);
        requests.setStatus(request.id(), "CLOSED", false);
        support.notify(quote.submittedByUserId(), "SERVICE_RESPONSE", request.id(),
                "service-quote-accepted:" + quoteId);
        return engagement;
    }

    @Transactional
    public Quote decline(UUID actorUserId, UUID quoteId) {
        Quote quote = repository.findQuote(quoteId).orElseThrow(() -> notFound("QUOTE_NOT_FOUND"));
        ServiceRequest request = support.requireRequestVisible(actorUserId, quote.serviceRequestId());
        requireCustomer(actorUserId, request);
        return transitionQuote(actorUserId, quote, "DECLINED");
    }

    @Transactional
    public Quote withdraw(UUID actorUserId, UUID quoteId) {
        Quote quote = repository.findQuote(quoteId).orElseThrow(() -> notFound("QUOTE_NOT_FOUND"));
        support.requireProviderManager(actorUserId, support.requireProvider(quote.serviceProviderId()));
        return transitionQuote(actorUserId, quote, "WITHDRAWN");
    }

    public Engagement engagementForRequest(UUID actorUserId, UUID requestId) {
        support.requireRequestVisible(actorUserId, requestId);
        return repository.engagementForRequest(requestId)
                .orElseThrow(() -> notFound("SERVICE_ENGAGEMENT_NOT_FOUND"));
    }

    @Transactional
    public Engagement transitionEngagement(UUID actorUserId, UUID engagementId,
            String action, String note, String reason) {
        Engagement current = repository.findEngagementForUpdate(engagementId)
                .orElseThrow(() -> notFound("SERVICE_ENGAGEMENT_NOT_FOUND"));
        boolean customer = actorUserId.equals(current.customerUserId());
        if (!customer) {
            support.requireProviderManager(actorUserId,
                    support.requireProvider(current.serviceProviderId()));
        }
        String target;
        Set<String> expected;
        boolean providerAction;
        switch (action) {
            case "START" -> {
                target = "IN_PROGRESS";
                expected = Set.of("ACCEPTED");
                providerAction = true;
            }
            case "SUBMIT_COMPLETION" -> {
                target = "COMPLETION_SUBMITTED";
                expected = Set.of("IN_PROGRESS", "ISSUE_RAISED");
                providerAction = true;
            }
            case "COMPLETE" -> {
                target = "COMPLETED";
                expected = Set.of("COMPLETION_SUBMITTED", "ISSUE_RAISED");
                providerAction = false;
            }
            case "RAISE_ISSUE" -> {
                target = "ISSUE_RAISED";
                expected = Set.of("IN_PROGRESS", "COMPLETION_SUBMITTED");
                providerAction = false;
            }
            case "CANCEL" -> {
                target = "CANCELLED";
                expected = Set.of("ACCEPTED", "IN_PROGRESS", "ISSUE_RAISED");
                providerAction = false;
            }
            default -> throw badRequest("INVALID_ENGAGEMENT_ACTION");
        }
        if (providerAction && customer || Set.of("COMPLETE").contains(action) && !customer) {
            throw forbidden("ENGAGEMENT_ACTOR_NOT_ALLOWED");
        }
        if (!expected.contains(current.status())) {
            throw conflict("INVALID_ENGAGEMENT_TRANSITION");
        }
        if ("RAISE_ISSUE".equals(action) && (reason == null || reason.isBlank())) {
            throw badRequest("ENGAGEMENT_ISSUE_REASON_REQUIRED");
        }
        if (note != null && note.length() > 4000 || reason != null && reason.length() > 4000) {
            throw badRequest("INVALID_ENGAGEMENT_NOTE");
        }
        if (!repository.transitionEngagement(engagementId, current.status(), target, note, reason)) {
            throw conflict("ENGAGEMENT_STATUS_CONFLICT");
        }
        repository.recordEngagementActor(engagementId, actorUserId, reason);
        return repository.findEngagement(engagementId).orElseThrow();
    }

    private Quote transitionQuote(UUID actorUserId, Quote quote, String target) {
        if (!repository.transitionQuote(quote.id(), "SENT", target)) {
            throw conflict("INVALID_QUOTE_TRANSITION");
        }
        support.notify("DECLINED".equals(target) ? quote.submittedByUserId()
                : support.requireRequest(quote.serviceRequestId()).customerUserId(),
                "SERVICE_RESPONSE", quote.serviceRequestId(),
                "service-quote-" + target.toLowerCase() + ":" + quote.id());
        return repository.findQuote(quote.id()).orElseThrow();
    }

    private void validateQuote(ServiceRequest request, Provider provider, QuoteInput in) {
        if (!"OPEN".equals(request.status())) {
            throw conflict("REQUEST_NOT_OPEN");
        }
        if (!providers.providerOwnsCategory(provider.id(), request.serviceCategoryId())) {
            throw conflict("PROVIDER_CATEGORY_MISMATCH");
        }
        if (support.canManage(request.customerUserId(), provider)) {
            throw conflict("CUSTOMER_CANNOT_QUOTE_OWN_REQUEST");
        }
        if (in == null || in.title() == null || in.title().isBlank() || in.title().length() > 180
                || in.scopeOfWork() == null || in.scopeOfWork().isBlank()
                || in.scopeOfWork().length() > 8000 || in.amount() == null || in.amount().signum() < 0
                || in.currencyCode() == null || in.items() == null || in.items().size() > 50) {
            throw badRequest("INVALID_SERVICE_QUOTE");
        }
        try {
            Currency.getInstance(in.currencyCode().toUpperCase());
        } catch (Exception e) {
            throw badRequest("INVALID_CURRENCY");
        }
        if ((in.estimatedDurationValue() == null) != (in.estimatedDurationUnit() == null)
                || in.estimatedDurationValue() != null && in.estimatedDurationValue() < 1
                || in.estimatedDurationUnit() != null
                && !Set.of("HOUR", "DAY", "WEEK", "MONTH").contains(in.estimatedDurationUnit())
                || in.validUntil() != null && !in.validUntil().isAfter(Instant.now())) {
            throw badRequest("INVALID_SERVICE_QUOTE");
        }
        java.math.BigDecimal itemTotal = java.math.BigDecimal.ZERO;
        for (QuoteItemInput item : in.items()) {
            if (item == null || item.description() == null || item.description().isBlank()
                    || item.description().length() > 500 || item.quantity() == null
                    || item.quantity().signum() <= 0 || item.unitAmount() == null
                    || item.unitAmount().signum() < 0) {
                throw badRequest("INVALID_QUOTE_ITEM");
            }
            itemTotal = itemTotal.add(item.quantity().multiply(item.unitAmount()));
        }
        if (!in.items().isEmpty() && in.amount().compareTo(itemTotal) != 0) {
            throw badRequest("QUOTE_ITEMS_TOTAL_MISMATCH");
        }
    }

    private void ensureCapacity(UUID requestId, UUID providerId) {
        if (!engagements.hasProviderEngagement(requestId, providerId)
                && engagements.engagedProviderCount(requestId) >= properties.maxProvidersPerRequest()) {
            throw conflict("SERVICE_PROVIDER_CAPACITY_REACHED");
        }
    }

    private void requireCustomer(UUID actorUserId, ServiceRequest request) {
        if (!actorUserId.equals(request.customerUserId())) {
            throw forbidden("REQUEST_OWNER_REQUIRED");
        }
    }
}
