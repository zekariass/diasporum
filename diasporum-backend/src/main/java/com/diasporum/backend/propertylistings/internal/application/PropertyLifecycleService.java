package com.diasporum.backend.propertylistings.internal.application;

import com.diasporum.backend.billing.BillingApi;
import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.AddressInput;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.ContactInput;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyCommand;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyDetail;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyRow;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import java.math.BigDecimal;
import java.sql.Date;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Draft editing, publication lifecycle and ordered property media. */
@Service
public class PropertyLifecycleService {

    private static final Set<String> VISIBILITIES = Set.of("COMMUNITY", "COUNTRY",
            "SELECTED_COMMUNITIES");
    private static final Set<String> FURNISHED = Set.of("FURNISHED", "PART_FURNISHED",
            "UNFURNISHED", "UNSPECIFIED");
    private static final Set<String> CONDITIONS = Set.of("NEW", "EXCELLENT", "GOOD",
            "FAIR", "NEEDS_RENOVATION", "UNSPECIFIED");
    private static final Set<String> EDITABLE = Set.of("DRAFT", "PUBLISHED",
            "PAUSED", "EXPIRED");
    private static final int MAX_MEDIA = 12;

    private final JdbcTemplate jdbc;
    private final PropertyRepository repository;
    private final PropertyAccess access;
    private final PropertyAuthorization authorization;
    private final PropertyAttributes attributes;
    private final PropertyQueryService queryService;
    private final TaxonomyApi taxonomy;
    private final CommunityApi community;
    private final MediaApi media;
    private final BillingApi billing;

    public PropertyLifecycleService(JdbcTemplate jdbc, PropertyRepository repository,
            PropertyAccess access, PropertyAuthorization authorization,
            PropertyAttributes attributes, PropertyQueryService queryService,
            TaxonomyApi taxonomy, CommunityApi community, MediaApi media,
            BillingApi billing) {
        this.jdbc = jdbc;
        this.repository = repository;
        this.access = access;
        this.authorization = authorization;
        this.attributes = attributes;
        this.queryService = queryService;
        this.taxonomy = taxonomy;
        this.community = community;
        this.media = media;
        this.billing = billing;
    }

    @Transactional
    public PropertyDetail create(UUID actor, PropertyCommand command) {
        var type = validate(actor, command);
        UUID id = UUID.randomUUID();
        UUID addressId = command.address() == null ? null
                : createAddress(actor, command.countryId(), command.address());
        String attributesJson = attributes.validate(command.additionalAttributes(),
                type.typeKey());
        boolean business = command.businessAccountId() != null;
        jdbc.update("INSERT INTO property_listings(id,country_id,community_id,"
                        + "owner_user_id,business_account_id,business_listing_id,"
                        + "created_by_user_id,"
                        + "property_type_id,visibility_scope,listing_purpose,title,"
                        + "description,additional_attributes,price_amount,currency_code,"
                        + "price_period,address_id,bedrooms,bathrooms,reception_rooms,"
                        + "floor_area,floor_area_unit,furnished_status,rental_deposit,"
                        + "bills_included,minimum_tenancy_months,availability_date,tenure,"
                        + "condition_key,status) VALUES(?,?,?,?,?,?,?,?,?::visibility_scope,"
                        + "?,?,?,?::jsonb,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT')",
                id, command.countryId(), command.communityId(),
                business ? null : actor, command.businessAccountId(),
                command.businessListingId(), actor,
                command.propertyTypeId(), visibility(command), command.listingPurpose(),
                command.title().trim(), command.description().trim(), attributesJson,
                command.priceAmount(), command.currencyCode(), pricePeriod(command),
                addressId, command.bedrooms(), command.bathrooms(), command.receptionRooms(),
                command.floorArea(), command.floorAreaUnit(), command.furnishedStatus(),
                command.rentalDeposit(), command.billsIncluded(),
                command.minimumTenancyMonths(), sqlDate(command), command.tenure(),
                command.conditionKey());
        replaceAssociations(id, command);
        return queryService.detail(actor, id);
    }

    @Transactional
    public PropertyDetail update(UUID actor, UUID propertyId, PropertyCommand command) {
        PropertyRow current = access.requireManagedLocked(actor, propertyId);
        ensureEditable(current);
        // Ownership is immutable through this endpoint; a full mobile edit need not
        // resend the owning account and can never transfer somebody else's listing.
        var effective = withOwnership(command, current);
        var type = validate(actor, effective);
        UUID addressId = effective.address() == null ? null
                : createAddress(actor, effective.countryId(), effective.address());
        String attributesJson = attributes.validate(effective.additionalAttributes(),
                type.typeKey());
        jdbc.update("UPDATE property_listings SET country_id=?,community_id=?,"
                        + "business_listing_id=?,"
                        + "property_type_id=?,visibility_scope=?::visibility_scope,"
                        + "listing_purpose=?,title=?,description=?,additional_attributes=?::jsonb,"
                        + "price_amount=?,currency_code=?,price_period=?,address_id=?,"
                        + "bedrooms=?,bathrooms=?,reception_rooms=?,floor_area=?,"
                        + "floor_area_unit=?,furnished_status=?,rental_deposit=?,"
                        + "bills_included=?,minimum_tenancy_months=?,availability_date=?,"
                        + "tenure=?,condition_key=?,updated_at=now() WHERE id=?",
                effective.countryId(), effective.communityId(), effective.businessListingId(),
                effective.propertyTypeId(),
                visibility(effective), effective.listingPurpose(), effective.title().trim(),
                effective.description().trim(), attributesJson, effective.priceAmount(),
                effective.currencyCode(), pricePeriod(effective), addressId,
                effective.bedrooms(), effective.bathrooms(), effective.receptionRooms(),
                effective.floorArea(), effective.floorAreaUnit(), effective.furnishedStatus(),
                effective.rentalDeposit(), effective.billsIncluded(),
                effective.minimumTenancyMonths(), sqlDate(effective), effective.tenure(),
                effective.conditionKey(), propertyId);
        replaceAssociations(propertyId, effective);
        return queryService.detail(actor, propertyId);
    }

    @Transactional
    public PropertyDetail publish(UUID actor, UUID propertyId) {
        PropertyRow property = access.requireManagedLocked(actor, propertyId);
        if ("PUBLISHED".equals(property.status())) {
            return queryService.detail(actor, propertyId);
        }
        if (!"DRAFT".equals(property.status())) {
            throw conflict("PROPERTY_NOT_DRAFT");
        }
        requirePublishable(propertyId);
        var consumed = billing.consume(property.ownerUserId(), property.businessAccountId(),
                "PROPERTY_LISTING_PUBLISH", "PROPERTY", propertyId,
                "PROPERTY_LISTING_PUBLISH:" + propertyId);
        if (consumed == BillingApi.ConsumptionResult.ENTITLEMENT_REQUIRED) {
            throw new ResponseStatusException(HttpStatus.PAYMENT_REQUIRED,
                    "PROPERTY_PUBLISH_ENTITLEMENT_REQUIRED");
        }
        jdbc.update("UPDATE property_listings SET status='PUBLISHED',published_at=now(),"
                + "expires_at=now()+interval '90 days',closed_at=NULL,updated_at=now()"
                + " WHERE id=?", propertyId);
        return queryService.detail(actor, propertyId);
    }

    @Transactional
    public PropertyDetail pause(UUID actor, UUID propertyId) {
        PropertyRow property = access.requireManagedLocked(actor, propertyId);
        if ("PAUSED".equals(property.status())) {
            return queryService.detail(actor, propertyId);
        }
        if (!"PUBLISHED".equals(property.status())) {
            throw conflict("PROPERTY_NOT_PUBLISHED");
        }
        jdbc.update("UPDATE property_listings SET status='PAUSED',updated_at=now()"
                + " WHERE id=?", propertyId);
        return queryService.detail(actor, propertyId);
    }

    @Transactional
    public PropertyDetail reopen(UUID actor, UUID propertyId) {
        PropertyRow property = access.requireManagedLocked(actor, propertyId);
        if (!Set.of("PAUSED", "EXPIRED").contains(property.status())) {
            throw conflict("PROPERTY_NOT_PAUSED");
        }
        requirePublishable(propertyId);
        jdbc.update("UPDATE property_listings SET status='PUBLISHED',"
                + "expires_at=now()+interval '90 days',updated_at=now() WHERE id=?",
                propertyId);
        return queryService.detail(actor, propertyId);
    }

    @Transactional
    public PropertyDetail close(UUID actor, UUID propertyId) {
        PropertyRow property = access.requireManagedLocked(actor, propertyId);
        if ("CLOSED".equals(property.status())) {
            return queryService.detail(actor, propertyId);
        }
        if ("REMOVED".equals(property.status())) {
            throw PropertyRepository.notFound();
        }
        if (Set.of("SOLD", "RENTED").contains(property.status())) {
            throw conflict("INVALID_PROPERTY_TRANSITION");
        }
        jdbc.update("UPDATE property_listings SET status='CLOSED',closed_at=now(),"
                + "updated_at=now() WHERE id=?", propertyId);
        return queryService.detail(actor, propertyId);
    }

    @Transactional
    public PropertyDetail sold(UUID actor, UUID propertyId) {
        return terminalOutcome(actor, propertyId, "SALE", "SOLD");
    }

    @Transactional
    public PropertyDetail rented(UUID actor, UUID propertyId) {
        return terminalOutcome(actor, propertyId, "RENT", "RENTED");
    }

    private PropertyDetail terminalOutcome(UUID actor, UUID propertyId,
            String purpose, String status) {
        PropertyRow property = access.requireManagedLocked(actor, propertyId);
        if (status.equals(property.status())) {
            return queryService.detail(actor, propertyId);
        }
        if (!purpose.equals(property.listingPurpose())
                || !Set.of("PUBLISHED", "PAUSED").contains(property.status())) {
            throw conflict("INVALID_PROPERTY_TRANSITION");
        }
        jdbc.update("UPDATE property_listings SET status=?,updated_at=now()"
                + " WHERE id=?", status, propertyId);
        return queryService.detail(actor, propertyId);
    }

    @Transactional
    public PropertyDetail attachMedia(UUID actor, UUID propertyId, UUID mediaId) {
        PropertyRow property = access.requireManagedLocked(actor, propertyId);
        ensureEditable(property);
        Integer count = jdbc.queryForObject("SELECT count(*) FROM property_listing_media"
                + " WHERE property_listing_id=?", Integer.class, propertyId);
        Integer attached = jdbc.queryForObject("SELECT count(*) FROM property_listing_media"
                + " WHERE property_listing_id=? AND media_id=?", Integer.class,
                propertyId, mediaId);
        if (attached != null && attached > 0) {
            return queryService.detail(actor, propertyId);
        }
        if (count != null && count >= MAX_MEDIA) {
            throw conflict("PROPERTY_MEDIA_LIMIT");
        }
        validateMedia(actor, mediaId);
        jdbc.update("INSERT INTO property_listing_media(property_listing_id,media_id,"
                        + "sort_order,is_cover) VALUES(?,?,COALESCE((SELECT max(sort_order)+1"
                        + " FROM property_listing_media WHERE property_listing_id=?),0),"
                        + "NOT EXISTS(SELECT 1 FROM property_listing_media"
                        + " WHERE property_listing_id=?))", propertyId, mediaId,
                propertyId, propertyId);
        return queryService.detail(actor, propertyId);
    }

    @Transactional
    public PropertyDetail reorderMedia(UUID actor, UUID propertyId, List<UUID> mediaIds,
            UUID coverMediaId) {
        PropertyRow property = access.requireManagedLocked(actor, propertyId);
        ensureEditable(property);
        List<UUID> existing = jdbc.queryForList("SELECT media_id"
                + " FROM property_listing_media WHERE property_listing_id=?", UUID.class,
                propertyId);
        if (mediaIds == null || mediaIds.size() != existing.size()
                || new HashSet<>(mediaIds).size() != mediaIds.size()
                || !new HashSet<>(mediaIds).equals(new HashSet<>(existing))) {
            throw bad("PROPERTY_MEDIA_ORDER_INVALID");
        }
        UUID cover = coverMediaId == null && !mediaIds.isEmpty() ? mediaIds.get(0)
                : coverMediaId;
        if (cover != null && !mediaIds.contains(cover)) {
            throw bad("PROPERTY_COVER_NOT_ATTACHED");
        }
        jdbc.update("UPDATE property_listing_media SET sort_order=sort_order+1000"
                + " WHERE property_listing_id=?", propertyId);
        jdbc.update("UPDATE property_listing_media SET is_cover=false"
                + " WHERE property_listing_id=?", propertyId);
        for (int i = 0; i < mediaIds.size(); i++) {
            jdbc.update("UPDATE property_listing_media SET sort_order=?,is_cover=?"
                            + " WHERE property_listing_id=? AND media_id=?", i,
                    mediaIds.get(i).equals(cover), propertyId, mediaIds.get(i));
        }
        return queryService.detail(actor, propertyId);
    }

    @Transactional
    public PropertyDetail removeMedia(UUID actor, UUID propertyId, UUID mediaId) {
        PropertyRow property = access.requireManagedLocked(actor, propertyId);
        ensureEditable(property);
        jdbc.update("DELETE FROM property_listing_media WHERE property_listing_id=?"
                + " AND media_id=?", propertyId, mediaId);
        List<UUID> remaining = jdbc.queryForList("SELECT media_id"
                + " FROM property_listing_media WHERE property_listing_id=?"
                + " ORDER BY sort_order", UUID.class, propertyId);
        if (!remaining.isEmpty()) {
            reorderMedia(actor, propertyId, remaining, remaining.get(0));
        }
        return queryService.detail(actor, propertyId);
    }

    private void validateMedia(UUID actor, UUID mediaId) {
        var asset = media.asset(mediaId).orElseThrow(() -> bad("MEDIA_NOT_FOUND"));
        if (!actor.equals(asset.ownerId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "MEDIA_NOT_OWNED");
        }
        if (!"READY".equals(asset.status())) {
            throw bad("MEDIA_NOT_READY");
        }
        if (!"PROPERTY".equals(asset.purpose())) {
            throw bad("MEDIA_WRONG_PURPOSE");
        }
    }

    private void requirePublishable(UUID propertyId) {
        Integer mediaCount = jdbc.queryForObject("SELECT count(*)"
                + " FROM property_listing_media WHERE property_listing_id=?", Integer.class,
                propertyId);
        if (mediaCount == null || mediaCount == 0) {
            throw conflict("PROPERTY_MEDIA_REQUIRED");
        }
        // A public location is required: either a rounded discovery point for
        // radius search, or a city-only approximate address (design E.1).
        Integer discoverable = jdbc.queryForObject("SELECT count(*) FROM property_listings p"
                + " JOIN addresses a ON a.id=p.address_id WHERE p.id=?"
                + " AND (a.discovery_location IS NOT NULL"
                + " OR btrim(COALESCE(a.city,''))<>'')", Integer.class, propertyId);
        if (discoverable == null || discoverable == 0) {
            throw conflict("PROPERTY_DISCOVERY_LOCATION_REQUIRED");
        }
    }

    private PropertyModels.PropertyTypeView validate(UUID actor, PropertyCommand c) {
        if (c == null || c.countryId() == null || !taxonomy.isCountryActive(c.countryId())) {
            throw bad("INVALID_COUNTRY");
        }
        if (c.propertyTypeId() == null) {
            throw bad("PROPERTY_TYPE_REQUIRED");
        }
        var type = repository.requireType(c.countryId(), c.propertyTypeId());
        if (c.businessAccountId() != null) {
            authorization.requireBusinessManager(actor, c.businessAccountId());
        }
        if (c.businessListingId() != null) {
            if (c.businessAccountId() == null) {
                throw bad("BUSINESS_PROFILE_REQUIRES_ACCOUNT");
            }
            Integer owned = jdbc.queryForObject("SELECT count(*) FROM business_listings b"
                    + " WHERE b.id=? AND b.business_account_id=? AND b.deleted_at IS NULL",
                    Integer.class, c.businessListingId(), c.businessAccountId());
            if (owned == null || owned == 0) {
                throw bad("INVALID_BUSINESS_PROFILE");
            }
        }
        if (c.title() == null || c.title().trim().isEmpty()
                || c.title().trim().length() > 220) {
            throw bad("TITLE_INVALID");
        }
        if (c.description() == null || c.description().trim().isEmpty()
                || c.description().trim().length() > 20000) {
            throw bad("DESCRIPTION_INVALID");
        }
        if (!Set.of("SALE", "RENT").contains(nullToEmpty(c.listingPurpose()))) {
            throw bad("INVALID_LISTING_PURPOSE");
        }
        if (c.priceAmount() == null || c.priceAmount().signum() < 0
                || c.currencyCode() == null || !c.currencyCode().matches("^[A-Z]{3}$")) {
            throw bad("INVALID_PRICE");
        }
        if (!validPeriod(c)) {
            throw bad("INVALID_PRICE_PERIOD");
        }
        validateNumbers(c);
        validateAudience(actor, c);
        if (c.address() != null) {
            validateAddress(c.address());
        }
        if (c.contact() != null) {
            validateContact(c.contact());
        }
        return type;
    }

    private void validateAudience(UUID actor, PropertyCommand c) {
        String visibility = visibility(c);
        if (!VISIBILITIES.contains(visibility)) {
            throw bad("INVALID_VISIBILITY");
        }
        if ("COUNTRY".equals(visibility)) {
            if (c.communityId() != null) {
                throw bad("COUNTRY_COMMUNITY_MUST_BE_EMPTY");
            }
            return;
        }
        if ("COMMUNITY".equals(visibility)) {
            validateCommunity(actor, c.countryId(), c.communityId());
            return;
        }
        if (c.communityId() != null || c.communityIds() == null
                || c.communityIds().isEmpty() || c.communityIds().size() > 20
                || new HashSet<>(c.communityIds()).size() != c.communityIds().size()) {
            throw bad("INVALID_COMMUNITY_AUDIENCE");
        }
        c.communityIds().forEach(id -> validateCommunity(actor, c.countryId(), id));
    }

    private void validateCommunity(UUID actor, UUID countryId, UUID communityId) {
        if (communityId == null || !community.isActiveMember(actor, communityId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_A_MEMBER");
        }
        var view = taxonomy.findCommunityById(communityId)
                .filter(TaxonomyApi.CommunityView::active)
                .filter(v -> countryId.equals(v.destinationCountryId()))
                .orElseThrow(() -> bad("COMMUNITY_COUNTRY_MISMATCH"));
        if (view == null) {
            throw bad("COMMUNITY_NOT_FOUND");
        }
    }

    private static void validateNumbers(PropertyCommand c) {
        if (negative(c.bedrooms()) || negative(c.bathrooms()) || negative(c.receptionRooms())
                || (c.floorArea() != null && c.floorArea().signum() < 0)
                || (c.rentalDeposit() != null && c.rentalDeposit().signum() < 0)
                || (c.minimumTenancyMonths() != null && c.minimumTenancyMonths() <= 0)) {
            throw bad("INVALID_PROPERTY_NUMBER");
        }
        if (c.floorAreaUnit() != null && !Set.of("SQM", "SQFT").contains(c.floorAreaUnit())) {
            throw bad("INVALID_FLOOR_AREA_UNIT");
        }
        if (c.floorArea() != null && c.floorAreaUnit() == null) {
            throw bad("FLOOR_AREA_UNIT_REQUIRED");
        }
        if (c.furnishedStatus() != null && !FURNISHED.contains(c.furnishedStatus())) {
            throw bad("INVALID_FURNISHED_STATUS");
        }
        if (c.conditionKey() != null && !CONDITIONS.contains(c.conditionKey())) {
            throw bad("INVALID_CONDITION");
        }
        if (c.tenure() != null && c.tenure().length() > 100) {
            throw bad("INVALID_TENURE");
        }
        if ("SALE".equals(c.listingPurpose()) && (c.rentalDeposit() != null
                || c.minimumTenancyMonths() != null || c.billsIncluded() != null)) {
            throw bad("RENTAL_FIELDS_NOT_ALLOWED");
        }
    }

    private static void validateAddress(AddressInput a) {
        if (isBlank(a.addressLine1()) && isBlank(a.city()) && isBlank(a.formattedAddress())) {
            throw bad("ADDRESS_REQUIRED");
        }
        if ((a.latitude() == null) != (a.longitude() == null)
                || (a.latitude() != null && (a.latitude() < -90 || a.latitude() > 90
                || a.longitude() < -180 || a.longitude() > 180))) {
            throw bad("INVALID_COORDINATES");
        }
        if (length(a.addressLine1(), 240) || length(a.addressLine2(), 240)
                || length(a.city(), 120) || length(a.region(), 120)
                || length(a.postalCode(), 40) || length(a.formattedAddress(), 1000)) {
            throw bad("ADDRESS_FIELD_TOO_LONG");
        }
    }

    private static void validateContact(ContactInput c) {
        if (isBlank(c.phone()) && isBlank(c.whatsapp()) && isBlank(c.email())) {
            throw bad("CONTACT_METHOD_REQUIRED");
        }
        if (c.preferredMethod() != null && !Set.of("PHONE", "WHATSAPP", "EMAIL")
                .contains(c.preferredMethod())) {
            throw bad("INVALID_CONTACT_METHOD");
        }
        if (c.email() != null && !c.email().matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
            throw bad("INVALID_CONTACT_EMAIL");
        }
    }

    private UUID createAddress(UUID actor, UUID countryId, AddressInput a) {
        UUID id = UUID.randomUUID();
        // Exact coordinates remain PRIVATE. Discovery uses a separately stored,
        // rounded point; only that point and city/region enter public DTOs.
        Double discoveryLat = a.latitude() == null ? null
                : Math.round(a.latitude() * 100.0) / 100.0;
        Double discoveryLng = a.longitude() == null ? null
                : Math.round(a.longitude() * 100.0) / 100.0;
        jdbc.update("INSERT INTO addresses(id,country_id,address_line_1,address_line_2,"
                        + "city,region,postal_code,formatted_address,latitude,longitude,"
                        + "discovery_location,visibility,owner_user_id)"
                        + " VALUES(?,?,?,?,?,?,?,?,?,?,?::geography,'PRIVATE',?)",
                id, countryId, a.addressLine1(), a.addressLine2(), a.city(), a.region(),
                a.postalCode(), a.formattedAddress(), a.latitude(), a.longitude(),
                discoveryLat == null ? null : "POINT(" + discoveryLng + " " + discoveryLat + ")",
                actor);
        return id;
    }

    private void replaceAssociations(UUID propertyId, PropertyCommand c) {
        jdbc.update("DELETE FROM property_listing_communities WHERE property_listing_id=?",
                propertyId);
        if ("SELECTED_COMMUNITIES".equals(visibility(c))) {
            for (UUID communityId : c.communityIds()) {
                jdbc.update("INSERT INTO property_listing_communities(property_listing_id,"
                        + "community_id) VALUES(?,?)", propertyId, communityId);
            }
        }
        jdbc.update("DELETE FROM property_listing_amenities WHERE property_listing_id=?",
                propertyId);
        if (c.amenityIds() != null) {
            if (c.amenityIds().size() > 50
                    || new HashSet<>(c.amenityIds()).size() != c.amenityIds().size()) {
                throw bad("INVALID_AMENITIES");
            }
            for (UUID amenityId : c.amenityIds()) {
                Integer valid = jdbc.queryForObject("SELECT count(*) FROM property_amenities"
                        + " WHERE id=? AND is_active", Integer.class, amenityId);
                if (valid == null || valid == 0) {
                    throw bad("INVALID_AMENITY");
                }
                jdbc.update("INSERT INTO property_listing_amenities(property_listing_id,"
                        + "amenity_id) VALUES(?,?)", propertyId, amenityId);
            }
        }
        jdbc.update("DELETE FROM property_listing_contacts WHERE property_listing_id=?",
                propertyId);
        ContactInput contact = c.contact();
        if (contact != null) {
            jdbc.update("INSERT INTO property_listing_contacts(property_listing_id,phone,"
                            + "whatsapp,email,preferred_method,show_phone,show_whatsapp,show_email)"
                            + " VALUES(?,?,?,?,?,?,?,?)", propertyId, contact.phone(),
                    contact.whatsapp(), contact.email(), contact.preferredMethod(),
                    Boolean.TRUE.equals(contact.showPhone()),
                    Boolean.TRUE.equals(contact.showWhatsapp()),
                    Boolean.TRUE.equals(contact.showEmail()));
        }
    }

    private static PropertyCommand withOwnership(PropertyCommand c, PropertyRow row) {
        return new PropertyCommand(c.countryId(), c.communityId(), row.businessAccountId(),
                c.businessListingId() != null ? c.businessListingId() : row.businessListingId(),
                c.propertyTypeId(), c.visibilityScope(), c.listingPurpose(), c.title(),
                c.description(), c.additionalAttributes(), c.priceAmount(), c.currencyCode(),
                c.pricePeriod(), c.address(), c.bedrooms(), c.bathrooms(), c.receptionRooms(),
                c.floorArea(), c.floorAreaUnit(), c.furnishedStatus(), c.rentalDeposit(),
                c.billsIncluded(), c.minimumTenancyMonths(), c.availabilityDate(), c.tenure(),
                c.conditionKey(), c.communityIds(), c.amenityIds(), c.contact());
    }

    private static void ensureEditable(PropertyRow property) {
        if ("REMOVED".equals(property.status())) {
            throw PropertyRepository.notFound();
        }
        if ("CLOSED".equals(property.status())) {
            throw conflict("PROPERTY_CLOSED");
        }
        if (!EDITABLE.contains(property.status())) {
            throw conflict("PROPERTY_NOT_EDITABLE");
        }
    }

    private static String visibility(PropertyCommand c) {
        return c.visibilityScope() == null ? "COUNTRY" : c.visibilityScope();
    }

    private static String pricePeriod(PropertyCommand c) {
        if (c.pricePeriod() != null) {
            return c.pricePeriod();
        }
        return "SALE".equals(c.listingPurpose()) ? "TOTAL" : "MONTH";
    }

    private static boolean validPeriod(PropertyCommand c) {
        String period = pricePeriod(c);
        return "SALE".equals(c.listingPurpose()) ? "TOTAL".equals(period)
                : Set.of("WEEK", "MONTH", "YEAR").contains(period);
    }

    private static Date sqlDate(PropertyCommand c) {
        return c.availabilityDate() == null ? null : Date.valueOf(c.availabilityDate());
    }

    private static boolean negative(Integer value) {
        return value != null && value < 0;
    }

    private static boolean length(String value, int max) {
        return value != null && value.length() > max;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    private static ResponseStatusException conflict(String code) {
        return new ResponseStatusException(HttpStatus.CONFLICT, code);
    }
}
