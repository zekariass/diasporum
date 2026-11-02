package com.diasporum.backend.propertylistings.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.messaging.MessagingApi;
import com.diasporum.backend.moderation.ModerationApi;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyRow;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Saves, property-context enquiries and shared moderation report intake. */
@Service
public class PropertyEngagementService {

    private final JdbcTemplate jdbc;
    private final PropertyAccess access;
    private final BusinessAccountsApi businessAccounts;
    private final MessagingApi messaging;
    private final ModerationApi moderation;

    public PropertyEngagementService(JdbcTemplate jdbc, PropertyAccess access,
            BusinessAccountsApi businessAccounts, MessagingApi messaging,
            ModerationApi moderation) {
        this.jdbc = jdbc;
        this.access = access;
        this.businessAccounts = businessAccounts;
        this.messaging = messaging;
        this.moderation = moderation;
    }

    @Transactional
    public void save(UUID viewer, UUID propertyId) {
        requirePublished(viewer, propertyId);
        jdbc.update("INSERT INTO property_listing_saves(property_listing_id,user_id)"
                + " VALUES(?,?) ON CONFLICT DO NOTHING", propertyId, viewer);
    }

    @Transactional
    public void unsave(UUID viewer, UUID propertyId) {
        jdbc.update("DELETE FROM property_listing_saves WHERE property_listing_id=?"
                + " AND user_id=?", propertyId, viewer);
    }

    public UUID enquiry(UUID actor, UUID propertyId) {
        PropertyRow property = requirePublished(actor, propertyId);
        if (actor.equals(property.ownerUserId()) || (property.businessAccountId() != null
                && businessAccounts.isActiveMember(actor, property.businessAccountId()))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "CANNOT_ENQUIRE_OWN_PROPERTY");
        }
        return messaging.ensureContextConversation(actor, null, "PROPERTY_LISTING",
                propertyId, property.ownerUserId(), property.businessAccountId());
    }

    public UUID report(UUID reporter, UUID propertyId, String reason, String details) {
        PropertyRow property = requirePublished(reporter, propertyId);
        return moderation.report(reporter, "PROPERTY_LISTING", propertyId,
                property.countryId(), property.communityId(), reason, details);
    }

    private PropertyRow requirePublished(UUID viewer, UUID propertyId) {
        PropertyRow property = access.requireViewable(viewer, propertyId);
        if (!"PUBLISHED".equals(property.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "PROPERTY_NOT_PUBLISHED");
        }
        return property;
    }
}
