package com.diasporum.backend.servicemarketplace.internal.application;

import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.badRequest;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.conflict;
import static com.diasporum.backend.servicemarketplace.internal.application.ServiceMarketplaceSupport.forbidden;

import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Cursor;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Page;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Provider;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceCursor;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceProviderRepository;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Provider onboarding submission and platform-admin approval workflow. */
@Service
public class ServiceProviderOnboardingService {
    private final ServiceProviderRepository repository;
    private final ServiceMarketplaceSupport support;
    private final JdbcTemplate jdbc;

    public ServiceProviderOnboardingService(ServiceProviderRepository repository,
            ServiceMarketplaceSupport support, JdbcTemplate jdbc) {
        this.repository = repository;
        this.support = support;
        this.jdbc = jdbc;
    }

    @Transactional
    public Provider submit(UUID actorUserId, UUID providerId) {
        Provider provider = repository.findForUpdate(providerId)
                .orElseThrow(() -> ServiceMarketplaceSupport.notFound("SERVICE_PROVIDER_NOT_FOUND"));
        support.requireProviderManager(actorUserId, provider);
        if (!Set.of("DRAFT", "IN_PROGRESS", "REJECTED").contains(provider.onboardingStatus())) {
            throw conflict("PROVIDER_ONBOARDING_NOT_SUBMITTABLE");
        }
        if (!repository.submitOnboarding(providerId)) {
            throw conflict("PROVIDER_ONBOARDING_STATUS_CONFLICT");
        }
        return support.enrich(actorUserId, support.requireProvider(providerId));
    }

    public Page<Provider> queue(UUID actorUserId, String status, String encodedCursor, Integer size) {
        requirePlatformAdmin(actorUserId);
        String normalized = status == null || status.isBlank() ? "SUBMITTED" : status;
        if (!Set.of("SUBMITTED", "APPROVED", "REJECTED").contains(normalized)) {
            throw badRequest("INVALID_ONBOARDING_STATUS");
        }
        int limit = ServiceCursor.pageSize(size);
        String fingerprint = ServiceCursor.fingerprint("provider-onboarding:" + normalized);
        Cursor cursor = ServiceCursor.decode(encodedCursor, "NEWEST", fingerprint);
        List<Provider> rows = repository.onboardingQueue(normalized, cursor, limit);
        String next = null;
        if (rows.size() > limit) {
            Provider last = rows.get(limit - 1);
            next = ServiceCursor.encode(new Cursor("NEWEST", fingerprint,
                    last.onboardingSubmittedAt().toString(), null, last.id()));
        }
        return new Page<>(rows.stream().limit(limit)
                .map(provider -> support.enrich(actorUserId, provider)).toList(), next);
    }

    @Transactional
    public Provider review(UUID actorUserId, UUID providerId, String decision, String reason) {
        requirePlatformAdmin(actorUserId);
        if (!Set.of("APPROVED", "REJECTED").contains(decision)
                || "REJECTED".equals(decision) && (reason == null || reason.isBlank())) {
            throw badRequest("INVALID_ONBOARDING_REVIEW");
        }
        if (reason != null && reason.length() > 2000) {
            throw badRequest("INVALID_ONBOARDING_REVIEW");
        }
        if (!repository.reviewOnboarding(providerId, decision, actorUserId,
                "APPROVED".equals(decision) ? null : reason.trim())) {
            throw conflict("PROVIDER_ONBOARDING_NOT_SUBMITTED");
        }
        return support.enrich(actorUserId, support.requireProvider(providerId));
    }

    private void requirePlatformAdmin(UUID actorUserId) {
        Boolean admin = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM global_user_roles "
                + "WHERE user_id=? AND role_key='PLATFORM_ADMIN' AND scope_type='GLOBAL' "
                + "AND revoked_at IS NULL)", Boolean.class, actorUserId);
        if (!Boolean.TRUE.equals(admin)) {
            throw forbidden("PLATFORM_ADMIN_REQUIRED");
        }
    }
}
