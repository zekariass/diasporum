package com.diasporum.backend.propertylistings.internal.application;

import com.diasporum.backend.propertylistings.internal.application.PropertyModels.AmenityView;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.Listed;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyItem;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyRow;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyTypeView;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PublicLocation;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.web.server.ResponseStatusException;

/** Shared safe JDBC projections and reference-data lookups. */
@Repository
class PropertyRepository {

    static final String COLS = "p.id,p.country_id,p.community_id,p.owner_user_id,"
            + "p.business_account_id,p.business_listing_id,p.created_by_user_id,"
            + "p.property_type_id,"
            + "p.visibility_scope::text,p.listing_purpose,p.title,p.description,"
            + "p.additional_attributes::text AS attributes,p.price_amount,"
            + "p.currency_code,p.price_period,p.bedrooms,p.bathrooms,"
            + "p.reception_rooms,p.floor_area,p.floor_area_unit,p.furnished_status,"
            + "p.rental_deposit,p.bills_included,p.minimum_tenancy_months,"
            + "p.availability_date,p.tenure,p.condition_key,p.status,p.expires_at,"
            + "p.published_at,p.closed_at,p.created_at,p.updated_at";

    static final String LIST_COLS = COLS + ",t.type_key,"
            + "COALESCE(cpt.local_name,t.default_name) AS type_name,"
            + "(SELECT name FROM countries WHERE id=p.country_id) AS country_name,"
            + "a.city,a.region,ST_Y(a.discovery_location::geometry) AS discovery_lat,"
            + "ST_X(a.discovery_location::geometry) AS discovery_lng,"
            + "(SELECT pm.media_id FROM property_listing_media pm"
            + " WHERE pm.property_listing_id=p.id AND pm.is_cover LIMIT 1) AS cover_media_id,"
            + "(SELECT count(*) FROM user_content_views v"
            + " WHERE v.content_type='PROPERTY' AND v.content_id=p.id) AS view_count,"
            + "(SELECT count(*) FROM direct_conversations dc"
            + " WHERE dc.context_type='PROPERTY_LISTING' AND dc.context_id=p.id)"
            + " AS enquiry_count,"
            + "(SELECT count(*) FROM property_listing_saves s2"
            + " WHERE s2.property_listing_id=p.id) AS save_count";

    static final String LIST_FROM = " FROM property_listings p"
            + " JOIN property_types t ON t.id=p.property_type_id"
            + " LEFT JOIN country_property_types cpt ON cpt.country_id=p.country_id"
            + " AND cpt.property_type_id=p.property_type_id"
            + " LEFT JOIN addresses a ON a.id=p.address_id";

    private final JdbcTemplate jdbc;
    private final PropertyAttributes attributes;
    private final PropertyAuthorization authorization;

    PropertyRepository(JdbcTemplate jdbc, PropertyAttributes attributes,
            PropertyAuthorization authorization) {
        this.jdbc = jdbc;
        this.attributes = attributes;
        this.authorization = authorization;
    }

    JdbcTemplate jdbc() {
        return jdbc;
    }

    Optional<PropertyRow> find(UUID id) {
        return jdbc.query("SELECT " + COLS + " FROM property_listings p WHERE p.id=?",
                this::row, id).stream().findFirst();
    }

    Optional<PropertyRow> lock(UUID id) {
        return jdbc.query("SELECT " + COLS
                + " FROM property_listings p WHERE p.id=? FOR UPDATE", this::row, id)
                .stream().findFirst();
    }

    PropertyRow require(UUID id) {
        return find(id).orElseThrow(() -> notFound());
    }

    PropertyRow requireLocked(UUID id) {
        return lock(id).orElseThrow(() -> notFound());
    }

    Listed listed(ResultSet rs, int ignored) throws SQLException {
        Double lat = rs.getObject("discovery_lat", Double.class);
        Double lng = rs.getObject("discovery_lng", Double.class);
        String city = rs.getString("city");
        String region = rs.getString("region");
        PublicLocation location = new PublicLocation(city, region, lat, lng, rs.getString("country_name"));
        return new Listed(row(rs, 0), new PropertyTypeView(
                rs.getObject("property_type_id", UUID.class), rs.getString("type_key"),
                rs.getString("type_name")), location,
                rs.getObject("cover_media_id", UUID.class), rs.getBoolean("saved"),
                rs.getLong("view_count"), rs.getLong("enquiry_count"),
                rs.getLong("save_count"), instant(rs, "cursor_time"));
    }

    PropertyItem item(UUID viewer, Listed listed) {
        return new PropertyItem(listed.property(), listed.propertyType(),
                listed.location(), listed.coverMediaId(), listed.saved(),
                authorization.canManage(viewer, listed.property()), listed.viewCount(),
                listed.enquiryCount(), listed.saveCount());
    }

    Optional<Listed> findListed(UUID viewer, UUID id) {
        return jdbc.query("SELECT " + LIST_COLS + ",EXISTS(SELECT 1"
                        + " FROM property_listing_saves s"
                        + " WHERE s.property_listing_id=p.id AND s.user_id=?) AS saved,"
                        + "p.updated_at AS cursor_time" + LIST_FROM + " WHERE p.id=?",
                this::listed, viewer, id).stream().findFirst();
    }

    List<PropertyTypeView> types(UUID countryId) {
        return jdbc.query("SELECT t.id,t.type_key,cpt.local_name"
                        + " FROM country_property_types cpt JOIN property_types t"
                        + " ON t.id=cpt.property_type_id WHERE cpt.country_id=?"
                        + " AND cpt.is_enabled AND t.is_active"
                        + " ORDER BY cpt.sort_order,cpt.local_name",
                (rs, i) -> new PropertyTypeView(rs.getObject("id", UUID.class),
                        rs.getString("type_key"), rs.getString("local_name")), countryId);
    }

    PropertyTypeView requireType(UUID countryId, UUID typeId) {
        return jdbc.query("SELECT t.id,t.type_key,cpt.local_name"
                        + " FROM country_property_types cpt JOIN property_types t"
                        + " ON t.id=cpt.property_type_id WHERE cpt.country_id=?"
                        + " AND cpt.property_type_id=? AND cpt.is_enabled AND t.is_active",
                (rs, i) -> new PropertyTypeView(rs.getObject("id", UUID.class),
                        rs.getString("type_key"), rs.getString("local_name")),
                countryId, typeId).stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "INVALID_PROPERTY_TYPE"));
    }

    List<AmenityView> amenities() {
        return jdbc.query("SELECT id,amenity_key,display_name FROM property_amenities"
                        + " WHERE is_active ORDER BY sort_order,display_name",
                (rs, i) -> new AmenityView(rs.getObject("id", UUID.class),
                        rs.getString("amenity_key"), rs.getString("display_name")));
    }

    static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "PROPERTY_NOT_FOUND");
    }

    private PropertyRow row(ResultSet rs, int ignored) throws SQLException {
        return new PropertyRow(rs.getObject("id", UUID.class),
                rs.getObject("country_id", UUID.class),
                rs.getObject("community_id", UUID.class),
                rs.getObject("owner_user_id", UUID.class),
                rs.getObject("business_account_id", UUID.class),
                rs.getObject("business_listing_id", UUID.class),
                rs.getObject("created_by_user_id", UUID.class),
                rs.getObject("property_type_id", UUID.class),
                rs.getString("visibility_scope"), rs.getString("listing_purpose"),
                rs.getString("title"), rs.getString("description"),
                attributes.read(rs.getString("attributes")), rs.getBigDecimal("price_amount"),
                rs.getString("currency_code"), rs.getString("price_period"),
                rs.getObject("bedrooms", Integer.class),
                rs.getObject("bathrooms", Integer.class),
                rs.getObject("reception_rooms", Integer.class),
                rs.getBigDecimal("floor_area"), rs.getString("floor_area_unit"),
                rs.getString("furnished_status"), rs.getBigDecimal("rental_deposit"),
                rs.getObject("bills_included", Boolean.class),
                rs.getObject("minimum_tenancy_months", Integer.class),
                rs.getObject("availability_date", LocalDate.class), rs.getString("tenure"),
                rs.getString("condition_key"), rs.getString("status"),
                instant(rs, "expires_at"), instant(rs, "published_at"),
                instant(rs, "closed_at"), instant(rs, "created_at"),
                instant(rs, "updated_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        var timestamp = rs.getTimestamp(column);
        return timestamp == null ? null : timestamp.toInstant();
    }
}
