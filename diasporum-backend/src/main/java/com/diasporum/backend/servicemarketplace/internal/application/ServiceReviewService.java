package com.diasporum.backend.servicemarketplace.internal.application;

import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.badRequest;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.conflict;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.forbidden;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.notFound;

import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Cursor;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Page;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Provider;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Report;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ReportInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Review;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ReviewInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ServiceRequest;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceCursor;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceEngagementRepository;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Interaction-backed reviews and service-specific abuse reports. */
@Service
public class ServiceReviewService {
    private static final Set<String> TARGETS = Set.of(
            "SERVICE_REQUEST", "SERVICE_PROVIDER", "SERVICE_REVIEW");
    private static final Set<String> REASONS = Set.of(
            "SPAM", "SCAM", "HARASSMENT", "MISLEADING", "UNSAFE", "OTHER");

    private final ServiceEngagementRepository repository;
    private final ServiceMarketplaceSupport support;

    public ServiceReviewService(ServiceEngagementRepository repository,
            ServiceMarketplaceSupport support) {
        this.repository = repository;
        this.support = support;
    }

    @Transactional
    public Review createReview(UUID actorUserId, UUID requestId, ReviewInput in) {
        ServiceRequest request = support.requireRequestVisible(actorUserId, requestId);
        if (!actorUserId.equals(request.customerUserId())) {
            throw forbidden("REQUEST_OWNER_REQUIRED");
        }
        Provider provider = support.requireProvider(in.serviceProviderId());
        boolean interaction = repository.findResponse(requestId, provider.id()).isPresent()
                || repository.findLead(requestId, provider.id()).isPresent();
        if (!interaction) {
            throw conflict("SERVICE_INTERACTION_REQUIRED");
        }
        validateReview(in);
        try {
            return support.enrichReviews(List.of(repository.insertReview(
                    UUID.randomUUID(), requestId, actorUserId, in))).getFirst();
        } catch (DuplicateKeyException e) {
            throw conflict("REVIEW_ALREADY_EXISTS");
        }
    }

    public Review getReview(UUID actorUserId, UUID reviewId) {
        support.requireActive(actorUserId);
        Review review = repository.findReview(reviewId).orElseThrow(() -> notFound("REVIEW_NOT_FOUND"));
        if (!"PUBLISHED".equals(review.status()) && !actorUserId.equals(review.reviewerUserId())) {
            support.requireProviderManager(actorUserId, support.requireProvider(review.serviceProviderId()));
        }
        return support.enrichReviews(List.of(review)).getFirst();
    }

    @Transactional
    public Review updateReview(UUID actorUserId, UUID reviewId, ReviewInput in) {
        Review review = repository.findReview(reviewId).orElseThrow(() -> notFound("REVIEW_NOT_FOUND"));
        if (!actorUserId.equals(review.reviewerUserId())) {
            throw forbidden("REVIEW_OWNER_REQUIRED");
        }
        if (!review.serviceProviderId().equals(in.serviceProviderId())) {
            throw badRequest("REVIEW_PROVIDER_IMMUTABLE");
        }
        if ("REJECTED".equals(review.status())) {
            throw conflict("REVIEW_NOT_EDITABLE");
        }
        validateReview(in);
        return support.enrichReviews(List.of(repository.updateReview(reviewId, in))).getFirst();
    }

    @Transactional
    public Review respondToReview(UUID actorUserId, UUID reviewId, String response) {
        Review review = repository.findReview(reviewId).orElseThrow(() -> notFound("REVIEW_NOT_FOUND"));
        support.requireProviderManager(actorUserId, support.requireProvider(review.serviceProviderId()));
        if (response == null || response.isBlank() || response.length() > 2000) {
            throw badRequest("INVALID_PROVIDER_RESPONSE");
        }
        repository.providerReviewResponse(reviewId, actorUserId, response);
        return getReview(actorUserId, reviewId);
    }

    public Page<Review> reviews(UUID actorUserId, UUID requestId, UUID providerId,
            boolean authoredByMe, String encodedCursor, Integer size) {
        support.requireActive(actorUserId);
        if (requestId != null) {
            support.requireRequestVisible(actorUserId, requestId);
        }
        if (providerId != null) {
            Provider provider = support.requireProvider(providerId);
            if (!"ACTIVE".equals(provider.status()) && !support.canManage(actorUserId, provider)) {
                throw notFound("SERVICE_PROVIDER_NOT_FOUND");
            }
        }
        UUID reviewerId = authoredByMe ? actorUserId : null;
        int limit = ServiceCursor.pageSize(size);
        String fingerprint = ServiceCursor.fingerprint("reviews:" + requestId + ":" + providerId + ":" + reviewerId);
        Cursor cursor = ServiceCursor.decode(encodedCursor, "NEWEST", fingerprint);
        List<Review> rows = repository.reviews(requestId, providerId, reviewerId,
                !authoredByMe, cursor, limit);
        String next = nextReview(rows, limit, fingerprint);
        return new Page<>(support.enrichReviews(rows.stream().limit(limit).toList()), next);
    }

    @Transactional
    public Report report(UUID actorUserId, ReportInput in) {
        support.requireActive(actorUserId);
        validateReport(in);
        if (repository.recentReportCount(actorUserId) >= 20) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "REPORT_RATE_LIMIT");
        }
        if (repository.duplicateOpenReport(actorUserId, in)) {
            throw conflict("DUPLICATE_OPEN_REPORT");
        }
        validateReportTarget(actorUserId, in);
        return repository.insertReport(UUID.randomUUID(), actorUserId, in);
    }

    private void validateReportTarget(UUID actorUserId, ReportInput in) {
        switch (in.targetType()) {
            case "SERVICE_REQUEST" -> {
                ServiceRequest request = support.requireRequestVisible(actorUserId, in.targetId());
                if (actorUserId.equals(request.customerUserId())) {
                    throw conflict("CANNOT_REPORT_OWN_CONTENT");
                }
            }
            case "SERVICE_PROVIDER" -> {
                Provider provider = support.requireProvider(in.targetId());
                if (!"ACTIVE".equals(provider.status())) {
                    throw notFound("SERVICE_PROVIDER_NOT_FOUND");
                }
                if (support.canManage(actorUserId, provider)) {
                    throw conflict("CANNOT_REPORT_OWN_CONTENT");
                }
            }
            case "SERVICE_REVIEW" -> {
                Review review = getReview(actorUserId, in.targetId());
                if (actorUserId.equals(review.reviewerUserId())) {
                    throw conflict("CANNOT_REPORT_OWN_CONTENT");
                }
            }
            default -> throw badRequest("INVALID_REPORT_TARGET");
        }
    }

    private void validateReport(ReportInput in) {
        if (in == null || !TARGETS.contains(in.targetType()) || in.targetId() == null
                || in.reasonCode() == null || !REASONS.contains(in.reasonCode())
                || in.description() == null || in.description().trim().length() < 5
                || in.description().length() > 2000) {
            throw badRequest("INVALID_SERVICE_REPORT");
        }
    }

    private void validateReview(ReviewInput in) {
        if (in == null || in.serviceProviderId() == null || in.rating() < 1 || in.rating() > 5
                || in.reviewText() != null && in.reviewText().length() > 4000) {
            throw badRequest("INVALID_SERVICE_REVIEW");
        }
    }

    private String nextReview(List<Review> rows, int limit, String fingerprint) {
        if (rows.size() <= limit) {
            return null;
        }
        Review last = rows.get(limit - 1);
        return ServiceCursor.encode(new Cursor("NEWEST", fingerprint,
                last.createdAt().toString(), null, last.id()));
    }
}
