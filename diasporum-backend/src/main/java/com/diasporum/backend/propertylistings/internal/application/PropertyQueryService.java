package com.diasporum.backend.propertylistings.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.AmenityView;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.ContactView;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.OwnerView;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyDetail;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyMediaView;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyRow;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyTypeView;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Detail assembly and authorized media URLs; exact address data is never selected. */
@Service
public class PropertyQueryService {

    private final JdbcTemplate jdbc;
    private final PropertyRepository repository;
    private final PropertyAccess access;
    private final IdentityApi identity;
    private final BusinessAccountsApi businessAccounts;
    private final MediaApi media;

    PropertyQueryService(JdbcTemplate jdbc, PropertyRepository repository,
            PropertyAccess access, IdentityApi identity,
            BusinessAccountsApi businessAccounts, MediaApi media) {
        this.jdbc = jdbc;
        this.repository = repository;
        this.access = access;
        this.identity = identity;
        this.businessAccounts = businessAccounts;
        this.media = media;
    }

    public List<PropertyTypeView> types(UUID countryId) {
        return repository.types(countryId);
    }

    public List<AmenityView> amenities() {
        return repository.amenities();
    }

    public PropertyDetail detail(UUID viewer, UUID propertyId) {
        PropertyRow property = access.requireViewable(viewer, propertyId);
        var listed = repository.findListed(viewer, propertyId)
                .orElseThrow(PropertyRepository::notFound);
        boolean manager = access.canManage(viewer, property);
        return new PropertyDetail(repository.item(viewer, listed), media(propertyId),
                amenities(propertyId), contact(propertyId, manager), owner(property));
    }

    List<PropertyMediaView> media(UUID propertyId) {
        return jdbc.query("SELECT media_id,sort_order,is_cover"
                        + " FROM property_listing_media WHERE property_listing_id=?"
                        + " ORDER BY sort_order", (rs, i) -> new PropertyMediaView(
                rs.getObject("media_id", UUID.class), rs.getInt("sort_order"),
                rs.getBoolean("is_cover")), propertyId);
    }

    public String mediaDownloadUrl(UUID viewer, UUID propertyId, UUID mediaId) {
        access.requireViewable(viewer, propertyId);
        Integer attached = jdbc.queryForObject("SELECT count(*)"
                + " FROM property_listing_media WHERE property_listing_id=? AND media_id=?",
                Integer.class, propertyId, mediaId);
        if (attached == null || attached == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "MEDIA_NOT_ATTACHED");
        }
        return media.authorizedDownloadUrl(mediaId);
    }

    private List<AmenityView> amenities(UUID propertyId) {
        return jdbc.query("SELECT a.id,a.amenity_key,a.display_name"
                        + " FROM property_listing_amenities pa JOIN property_amenities a"
                        + " ON a.id=pa.amenity_id WHERE pa.property_listing_id=?"
                        + " ORDER BY a.sort_order,a.display_name",
                (rs, i) -> new AmenityView(rs.getObject("id", UUID.class),
                        rs.getString("amenity_key"), rs.getString("display_name")),
                propertyId);
    }

    private ContactView contact(UUID propertyId, boolean manager) {
        return jdbc.query("SELECT phone,whatsapp,email,preferred_method,show_phone,"
                        + "show_whatsapp,show_email FROM property_listing_contacts"
                        + " WHERE property_listing_id=?", (rs, i) -> new ContactView(
                manager || rs.getBoolean("show_phone") ? rs.getString("phone") : null,
                manager || rs.getBoolean("show_whatsapp") ? rs.getString("whatsapp") : null,
                manager || rs.getBoolean("show_email") ? rs.getString("email") : null,
                rs.getString("preferred_method")), propertyId).stream().findFirst()
                .orElse(null);
    }

    private OwnerView owner(PropertyRow property) {
        String displayName = null;
        String businessName = null;
        if (property.businessAccountId() != null) {
            businessName = businessAccounts.accountSummary(property.businessAccountId())
                    .map(BusinessAccountsApi.BusinessAccountSummary::accountName).orElse(null);
        } else if (property.ownerUserId() != null) {
            displayName = identity.profileSummary(property.ownerUserId())
                    .map(IdentityApi.ProfileSummary::displayName).orElse(null);
        }
        return new OwnerView(displayName, businessName);
    }
}
