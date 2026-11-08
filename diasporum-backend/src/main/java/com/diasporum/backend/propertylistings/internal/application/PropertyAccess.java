package com.diasporum.backend.propertylistings.internal.application;

import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyRow;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Audience and ownership checks shared by all property operations. */
@Component
class PropertyAccess {

    private final PropertyRepository repository;
    private final PropertyAuthorization authorization;
    private final IdentityApi identity;
    private final CommunityApi community;

    PropertyAccess(PropertyRepository repository, PropertyAuthorization authorization,
            IdentityApi identity, CommunityApi community) {
        this.repository = repository;
        this.authorization = authorization;
        this.identity = identity;
        this.community = community;
    }

    boolean canManage(UUID actor, PropertyRow property) {
        return authorization.canManage(actor, property);
    }

    boolean canView(UUID viewer, PropertyRow property) {
        if ("REMOVED".equals(property.status())) {
            return false;
        }
        if (canManage(viewer, property)) {
            return true;
        }
        if (!"PUBLISHED".equals(property.status()) || (property.expiresAt() != null
                && property.expiresAt().isBefore(Instant.now()))) {
            return false;
        }
        if (identity.profileSummary(viewer).map(ProfileSummary::currentCountryId)
                .filter(property.countryId()::equals).isEmpty()) {
            return false;
        }
        if ("COUNTRY".equals(property.visibilityScope())) {
            return true;
        }
        if ("COMMUNITY".equals(property.visibilityScope())) {
            return property.communityId() != null
                    && community.canAccess(viewer, property.communityId());
        }
        if ("SELECTED_COMMUNITIES".equals(property.visibilityScope())) {
            return repository.jdbc().queryForList(
                    "SELECT community_id FROM property_listing_communities"
                            + " WHERE property_listing_id=?", UUID.class, property.id())
                    .stream().anyMatch(id -> community.canAccess(viewer, id));
        }
        return false;
    }

    PropertyRow requireViewable(UUID viewer, UUID id) {
        PropertyRow property = lazyExpire(repository.require(id));
        if (!canView(viewer, property)) {
            throw PropertyRepository.notFound();
        }
        return property;
    }

    PropertyRow requireManaged(UUID actor, UUID id) {
        PropertyRow property = lazyExpire(repository.require(id));
        if (!canManage(actor, property)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "NOT_PROPERTY_MANAGER");
        }
        return property;
    }

    PropertyRow requireManagedLocked(UUID actor, UUID id) {
        PropertyRow property = lazyExpire(repository.requireLocked(id));
        if (!canManage(actor, property)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "NOT_PROPERTY_MANAGER");
        }
        return property;
    }

    /**
     * Lazy expiry: a PUBLISHED listing past {@code expires_at} transitions to
     * EXPIRED on first touch; the scheduled worker covers untouched rows.
     */
    private PropertyRow lazyExpire(PropertyRow property) {
        if (!"PUBLISHED".equals(property.status()) || property.expiresAt() == null
                || property.expiresAt().isAfter(Instant.now())) {
            return property;
        }
        repository.jdbc().update("UPDATE property_listings SET status='EXPIRED',"
                + "updated_at=now() WHERE id=? AND status='PUBLISHED'", property.id());
        return repository.require(property.id());
    }
}
