package com.diasporum.backend.propertylistings.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.AmenityView;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.ContactView;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.ListedByView;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.OwnerView;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PrivateAddressView;
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
                amenities(propertyId), contact(propertyId, manager), owner(property),
                listedBy(viewer, property), manager ? privateAddress(propertyId) : null,
                manager ? communityIds(propertyId) : List.of());
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

    private List<UUID> communityIds(UUID propertyId) {
        return jdbc.queryForList("SELECT community_id"
                        + " FROM property_listing_communities WHERE property_listing_id=?"
                        + " ORDER BY community_id", UUID.class, propertyId);
    }

    /**
     * Exact private address — selected only for a verified manager. Public
     * viewers never receive this projection.
     */
    private PrivateAddressView privateAddress(UUID propertyId) {
        return jdbc.query("SELECT a.address_line_1,a.address_line_2,a.city,"
                        + "a.region,a.postal_code,a.formatted_address,"
                        + "a.latitude::float8 AS latitude,a.longitude::float8 AS longitude"
                        + " FROM addresses a JOIN property_listings p"
                        + " ON p.address_id=a.id WHERE p.id=?",
                (rs, i) -> new PrivateAddressView(rs.getString("address_line_1"),
                        rs.getString("address_line_2"), rs.getString("city"),
                        rs.getString("region"), rs.getString("postal_code"),
                        rs.getString("formatted_address"),
                        rs.getObject("latitude", Double.class),
                        rs.getObject("longitude", Double.class)),
                propertyId).stream().findFirst().orElse(null);
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
        UUID avatarMediaId = null;
        if (property.businessAccountId() != null) {
            businessName = businessAccounts.accountSummary(property.businessAccountId())
                    .map(BusinessAccountsApi.BusinessAccountSummary::accountName).orElse(null);
        } else if (property.ownerUserId() != null) {
            var profile = identity.profileSummary(property.ownerUserId())
                    .filter(p -> "ACTIVE".equals(p.accountStatus())).orElse(null);
            if (profile != null) {
                displayName = profile.displayName();
                avatarMediaId = profile.avatarMediaId();
            }
        }
        return new OwnerView(displayName, businessName, avatarMediaId);
    }

    /** Public Business Profile the listing is published under, when associated. */
    private ListedByView listedBy(UUID viewer, PropertyRow property) {
        if (property.businessListingId() == null) {
            return null;
        }
        UUID country = identity.profileSummary(viewer)
                .map(IdentityApi.ProfileSummary::currentCountryId).orElse(null);
        return jdbc.query("SELECT b.id,b.name,c.name AS category_name,b.verification_status::text,"
                        + "(SELECT bm.media_id FROM business_media bm"
                        + " WHERE bm.business_id=b.id AND bm.is_logo LIMIT 1) AS logo_media_id"
                        + " FROM business_listings b"
                        + " LEFT JOIN business_categories c ON c.id=b.category_id"
                        + " WHERE b.id=? AND b.deleted_at IS NULL AND b.status='PUBLISHED'"
                        + " AND b.country_id=? AND (b.visibility_scope='COUNTRY' OR EXISTS("
                        + " SELECT 1 FROM community_memberships m JOIN communities cm ON cm.id=m.community_id"
                        + " WHERE m.user_id=? AND m.status='ACTIVE' AND cm.is_active"
                        + " AND ((b.visibility_scope='COMMUNITY' AND b.community_id=m.community_id)"
                        + " OR (b.visibility_scope='SELECTED_COMMUNITIES' AND EXISTS("
                        + " SELECT 1 FROM business_listing_communities bc"
                        + " WHERE bc.business_listing_id=b.id AND bc.community_id=m.community_id)))))",
                (rs, i) -> new ListedByView(rs.getObject("id", UUID.class),
                        rs.getString("name"), rs.getString("category_name"),
                        rs.getString("verification_status"), rs.getObject("logo_media_id", UUID.class)),
                property.businessListingId(), country, viewer).stream().findFirst().orElse(null);
    }
}
