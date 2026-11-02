package com.diasporum.backend.vehiclelistings.internal.infrastructure.persistence;

import com.diasporum.backend.vehiclelistings.internal.domain.VehicleCatalogItem;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleCursor;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleFeature;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleListing;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleLocation;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleQueryResult;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleSearch;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** Feature-owned JDBC persistence and PostgreSQL/PostGIS discovery. */
@Repository
public class VehicleRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public VehicleRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public record Attachment(UUID mediaId, int sortOrder, boolean cover) {
    }

    private static final String COLS = "v.id,v.country_id,v.community_id,v.owner_user_id,"
            + "v.business_account_id,v.created_by_user_id,v.visibility_scope::text,"
            + "v.listing_purpose,v.vehicle_category_id,v.make_id,v.model_id,v.variant_id,"
            + "c.category_key,c.display_name AS category_name,m.display_name AS make_name,"
            + "mo.display_name AS model_name,va.display_name AS variant_name,v.title,"
            + "v.description,v.model_year,v.mileage,v.mileage_unit,v.fuel_type,v.transmission,"
            + "v.drive_type,v.body_type,v.engine_size_cc,v.colour,v.doors,v.seats,"
            + "v.condition_key,v.registration_year,v.previous_owners,v.additional_attributes::text,"
            + "v.mot_expiry,v.service_history,v.price_amount,v.currency_code,v.price_period,"
            + "v.rental_deposit,v.mileage_allowance,v.rental_conditions,v.address_id,v.status,"
            + "v.expires_at,v.published_at,v.created_at,v.updated_at,(s.user_id IS NOT NULL) AS saved,"
            + "a.city,a.region,a.formatted_address";

    private static final String FROM = " FROM vehicle_listings v "
            + "JOIN vehicle_categories c ON c.id=v.vehicle_category_id "
            + "JOIN vehicle_makes m ON m.id=v.make_id "
            + "JOIN vehicle_models mo ON mo.id=v.model_id AND mo.make_id=v.make_id "
            + "LEFT JOIN vehicle_variants va ON va.id=v.variant_id "
            + "LEFT JOIN addresses a ON a.id=v.address_id "
            + "LEFT JOIN vehicle_listing_saves s ON s.vehicle_listing_id=v.id AND s.user_id=? ";

    private String select(String distanceExpression) {
        return "SELECT " + COLS + "," + distanceExpression + " AS distance_meters" + FROM;
    }

    private VehicleListing row(ResultSet rs, int i) throws SQLException {
        Map<String, Object> attributes = mapper.readValue(rs.getString("additional_attributes"),
                new TypeReference<LinkedHashMap<String, Object>>() { });
        return new VehicleListing(rs.getObject("id", UUID.class),
                rs.getObject("country_id", UUID.class), rs.getObject("community_id", UUID.class),
                rs.getObject("owner_user_id", UUID.class),
                rs.getObject("business_account_id", UUID.class),
                rs.getObject("created_by_user_id", UUID.class), rs.getString("visibility_scope"),
                rs.getString("listing_purpose"), rs.getObject("vehicle_category_id", UUID.class),
                rs.getObject("make_id", UUID.class), rs.getObject("model_id", UUID.class),
                rs.getObject("variant_id", UUID.class), rs.getString("category_key"),
                rs.getString("category_name"), rs.getString("make_name"),
                rs.getString("model_name"), rs.getString("variant_name"), rs.getString("title"),
                rs.getString("description"), rs.getObject("model_year", Integer.class),
                rs.getObject("mileage", Integer.class), rs.getString("mileage_unit"),
                rs.getString("fuel_type"), rs.getString("transmission"),
                rs.getString("drive_type"), rs.getString("body_type"),
                rs.getObject("engine_size_cc", Integer.class), rs.getString("colour"),
                rs.getObject("doors", Integer.class), rs.getObject("seats", Integer.class),
                rs.getString("condition_key"), rs.getObject("registration_year", Integer.class),
                rs.getObject("previous_owners", Integer.class),
                Collections.unmodifiableMap(attributes),
                rs.getObject("mot_expiry", LocalDate.class), rs.getString("service_history"),
                rs.getBigDecimal("price_amount"), rs.getString("currency_code"),
                rs.getString("price_period"), rs.getBigDecimal("rental_deposit"),
                rs.getObject("mileage_allowance", Integer.class), rs.getString("rental_conditions"),
                rs.getObject("address_id", UUID.class), rs.getString("status"),
                instant(rs, "expires_at"), instant(rs, "published_at"),
                instant(rs, "created_at"), instant(rs, "updated_at"), rs.getBoolean("saved"),
                rs.getObject("distance_meters", Double.class),
                new VehicleLocation(rs.getObject("country_id", UUID.class), rs.getString("city"),
                        rs.getString("region"), rs.getString("formatted_address")));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    public Optional<VehicleListing> find(UUID viewer, UUID id, boolean lock) {
        return jdbc.query(select("NULL::double precision") + "WHERE v.id=?"
                        + (lock ? " FOR UPDATE OF v" : ""), this::row, viewer, id)
                .stream().findFirst();
    }

    public void insert(VehicleListing v) {
        jdbc.update("INSERT INTO vehicle_listings(id,country_id,community_id,owner_user_id,"
                        + "business_account_id,created_by_user_id,visibility_scope,listing_purpose,"
                        + "vehicle_category_id,make_id,model_id,variant_id,title,description,model_year,"
                        + "mileage,mileage_unit,fuel_type,transmission,drive_type,body_type,engine_size_cc,"
                        + "colour,doors,seats,condition_key,registration_year,previous_owners,"
                        + "additional_attributes,mot_expiry,service_history,price_amount,currency_code,"
                        + "price_period,rental_deposit,mileage_allowance,rental_conditions,address_id,status,"
                        + "expires_at,published_at) VALUES(?,?,?,?,?,?,?::visibility_scope,?,?,?,?,?,?,?,?,?,?,?,"
                        + "?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?,?,?,?,?,?,?,?,?,?)",
                v.id(), v.countryId(), v.communityId(), v.ownerUserId(), v.businessAccountId(),
                v.createdByUserId(), v.visibilityScope(), v.listingPurpose(), v.categoryId(), v.makeId(),
                v.modelId(), v.variantId(), v.title(), v.description(), v.modelYear(), v.mileage(),
                v.mileageUnit(), v.fuelType(), v.transmission(), v.driveType(), v.bodyType(),
                v.engineSizeCc(), v.colour(), v.doors(), v.seats(), v.conditionKey(),
                v.registrationYear(), v.previousOwners(), json(v.additionalAttributes()), v.motExpiry(),
                v.serviceHistory(), v.priceAmount(), v.currencyCode(), v.pricePeriod(), v.rentalDeposit(),
                v.mileageAllowance(), v.rentalConditions(), v.addressId(), v.status(),
                v.expiresAt() == null ? null : Timestamp.from(v.expiresAt()),
                v.publishedAt() == null ? null : Timestamp.from(v.publishedAt()));
    }

    public void update(VehicleListing v) {
        jdbc.update("UPDATE vehicle_listings SET country_id=?,community_id=?,"
                        + "visibility_scope=?::visibility_scope,listing_purpose=?,vehicle_category_id=?,"
                        + "make_id=?,model_id=?,variant_id=?,title=?,description=?,model_year=?,mileage=?,"
                        + "mileage_unit=?,fuel_type=?,transmission=?,drive_type=?,body_type=?,engine_size_cc=?,"
                        + "colour=?,doors=?,seats=?,condition_key=?,registration_year=?,previous_owners=?,"
                        + "additional_attributes=?::jsonb,mot_expiry=?,service_history=?,price_amount=?,"
                        + "currency_code=?,price_period=?,rental_deposit=?,mileage_allowance=?,"
                        + "rental_conditions=?,address_id=?,expires_at=? WHERE id=?",
                v.countryId(), v.communityId(), v.visibilityScope(), v.listingPurpose(), v.categoryId(),
                v.makeId(), v.modelId(), v.variantId(), v.title(), v.description(), v.modelYear(), v.mileage(),
                v.mileageUnit(), v.fuelType(), v.transmission(), v.driveType(), v.bodyType(),
                v.engineSizeCc(), v.colour(), v.doors(), v.seats(), v.conditionKey(),
                v.registrationYear(), v.previousOwners(), json(v.additionalAttributes()), v.motExpiry(),
                v.serviceHistory(), v.priceAmount(), v.currencyCode(), v.pricePeriod(), v.rentalDeposit(),
                v.mileageAllowance(), v.rentalConditions(), v.addressId(),
                v.expiresAt() == null ? null : Timestamp.from(v.expiresAt()), v.id());
    }

    public void transition(UUID id, String status) {
        jdbc.update("UPDATE vehicle_listings SET status=?,published_at=CASE WHEN ?='PUBLISHED' "
                + "THEN COALESCE(published_at,now()) ELSE published_at END WHERE id=?",
                status, status, id);
    }

    public UUID createAddress(UUID countryId, String city, String region, String formattedAddress,
            Double latitude, Double longitude, UUID ownerUserId) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO addresses(id,country_id,city,region,formatted_address,"
                        + "discovery_location,visibility,owner_user_id) VALUES(?,?,?,?,?,"
                        + "CASE WHEN ?::float8 IS NULL OR ?::float8 IS NULL THEN NULL ELSE "
                        + "ST_SetSRID(ST_MakePoint(?::float8,?::float8),4326)::geography END,"
                        + "'PUBLIC',?)",
                id, countryId, city, region, formattedAddress, latitude, longitude,
                longitude, latitude, ownerUserId);
        return id;
    }

    public void replaceCommunities(UUID listingId, Collection<UUID> communityIds) {
        jdbc.update("DELETE FROM vehicle_listing_communities WHERE vehicle_listing_id=?", listingId);
        for (UUID communityId : communityIds) {
            jdbc.update("INSERT INTO vehicle_listing_communities(vehicle_listing_id,community_id) "
                    + "VALUES(?,?)", listingId, communityId);
        }
    }

    public List<UUID> selectedCommunities(UUID listingId) {
        return jdbc.queryForList("SELECT community_id FROM vehicle_listing_communities "
                + "WHERE vehicle_listing_id=? ORDER BY community_id", UUID.class, listingId);
    }

    public void replaceFeatures(UUID listingId, Collection<UUID> featureIds) {
        jdbc.update("DELETE FROM vehicle_listing_features WHERE vehicle_listing_id=?", listingId);
        for (UUID featureId : featureIds) {
            jdbc.update("INSERT INTO vehicle_listing_features(vehicle_listing_id,feature_id) "
                    + "VALUES(?,?)", listingId, featureId);
        }
    }

    public void replaceMedia(UUID listingId, List<Attachment> attachments) {
        jdbc.update("DELETE FROM vehicle_listing_media WHERE vehicle_listing_id=?", listingId);
        for (Attachment attachment : attachments) {
            jdbc.update("INSERT INTO vehicle_listing_media(vehicle_listing_id,media_id,sort_order,is_cover) "
                            + "VALUES(?,?,?,?)", listingId, attachment.mediaId(),
                    attachment.sortOrder(), attachment.cover());
        }
    }

    public List<Attachment> attachments(UUID listingId) {
        return jdbc.query("SELECT media_id,sort_order,is_cover FROM vehicle_listing_media "
                        + "WHERE vehicle_listing_id=? ORDER BY sort_order,media_id",
                (rs, i) -> new Attachment(rs.getObject("media_id", UUID.class), rs.getInt("sort_order"),
                        rs.getBoolean("is_cover")), listingId);
    }

    public Map<UUID, List<Attachment>> attachmentsFor(Collection<UUID> listingIds) {
        if (listingIds.isEmpty()) return Map.of();
        Sql in = in(listingIds);
        return jdbc.query("SELECT vehicle_listing_id,media_id,sort_order,is_cover "
                        + "FROM vehicle_listing_media WHERE vehicle_listing_id IN (" + in.sql + ") "
                        + "ORDER BY vehicle_listing_id,sort_order,media_id",
                rs -> {
                    Map<UUID, List<Attachment>> result = new LinkedHashMap<>();
                    while (rs.next()) {
                        result.computeIfAbsent(rs.getObject("vehicle_listing_id", UUID.class),
                                k -> new ArrayList<>()).add(new Attachment(
                                rs.getObject("media_id", UUID.class), rs.getInt("sort_order"),
                                rs.getBoolean("is_cover")));
                    }
                    return result;
                }, in.args.toArray());
    }

    public Map<UUID, List<VehicleFeature>> featuresFor(Collection<UUID> listingIds) {
        if (listingIds.isEmpty()) return Map.of();
        Sql in = in(listingIds);
        return jdbc.query("SELECT j.vehicle_listing_id,f.id,f.feature_key,f.display_name "
                        + "FROM vehicle_listing_features j JOIN vehicle_features f ON f.id=j.feature_id "
                        + "WHERE j.vehicle_listing_id IN (" + in.sql + ") "
                        + "ORDER BY j.vehicle_listing_id,f.sort_order,f.display_name",
                rs -> {
                    Map<UUID, List<VehicleFeature>> result = new LinkedHashMap<>();
                    while (rs.next()) {
                        result.computeIfAbsent(rs.getObject("vehicle_listing_id", UUID.class),
                                k -> new ArrayList<>()).add(new VehicleFeature(
                                rs.getObject("id", UUID.class), rs.getString("feature_key"),
                                rs.getString("display_name")));
                    }
                    return result;
                }, in.args.toArray());
    }

    public void save(UUID viewer, UUID listingId) {
        jdbc.update("INSERT INTO vehicle_listing_saves(vehicle_listing_id,user_id) VALUES(?,?) "
                + "ON CONFLICT DO NOTHING", listingId, viewer);
    }

    public void unsave(UUID viewer, UUID listingId) {
        jdbc.update("DELETE FROM vehicle_listing_saves WHERE vehicle_listing_id=? AND user_id=?",
                listingId, viewer);
    }

    public VehicleQueryResult discover(UUID viewer, UUID viewerCountry,
            Collection<UUID> accessibleCommunities, VehicleSearch f, VehicleCursor cursor, int limit) {
        boolean distance = "DISTANCE".equals(f.sort());
        String distanceSql = distance ? "ST_Distance(a.discovery_location,"
                + "ST_SetSRID(ST_MakePoint(?,?),4326)::geography)" : "NULL::double precision";
        Sql sql = new Sql(select(distanceSql) + "JOIN countries co ON co.id=v.country_id AND co.is_active ");
        if (distance) {
            sql.args.add(f.originLongitude());
            sql.args.add(f.originLatitude());
        }
        sql.args.add(viewer);
        sql.add("WHERE v.status='PUBLISHED' AND (v.expires_at IS NULL OR v.expires_at>now())");
        addVisibility(sql, viewerCountry, accessibleCommunities);
        if (f.keyword() != null && !f.keyword().isBlank()) {
            sql.add("AND (v.title ILIKE ? OR v.description ILIKE ? OR m.display_name ILIKE ? "
                    + "OR mo.display_name ILIKE ?)");
            String q = "%" + f.keyword().trim() + "%";
            sql.args.addAll(List.of(q, q, q, q));
        }
        eq(sql, "v.listing_purpose", f.purpose());
        eq(sql, "v.vehicle_category_id", f.categoryId());
        eq(sql, "v.make_id", f.makeId());
        eq(sql, "v.model_id", f.modelId());
        eq(sql, "v.variant_id", f.variantId());
        range(sql, "v.model_year", f.yearMin(), f.yearMax());
        range(sql, "v.mileage", f.mileageMin(), f.mileageMax());
        range(sql, "v.price_amount", f.priceMin(), f.priceMax());
        range(sql, "v.engine_size_cc", f.engineSizeMin(), f.engineSizeMax());
        eq(sql, "v.currency_code", f.currency());
        eq(sql, "v.fuel_type", f.fuelType());
        eq(sql, "v.transmission", f.transmission());
        eq(sql, "v.body_type", f.bodyType());
        eq(sql, "v.condition_key", f.condition());
        eq(sql, "v.country_id", f.countryId());
        if (f.communityId() != null) {
            sql.add("AND (v.community_id=? OR EXISTS(SELECT 1 FROM vehicle_listing_communities fc "
                    + "WHERE fc.vehicle_listing_id=v.id AND fc.community_id=?))",
                    f.communityId(), f.communityId());
        }
        if (f.city() != null) sql.add("AND a.city ILIKE ?", f.city());
        if (f.region() != null) sql.add("AND a.region ILIKE ?", f.region());
        if (f.originLatitude() != null) {
            sql.add("AND a.discovery_location IS NOT NULL");
            if (f.radiusMeters() != null) {
                sql.add("AND ST_DWithin(a.discovery_location,"
                        + "ST_SetSRID(ST_MakePoint(?,?),4326)::geography,?)",
                        f.originLongitude(), f.originLatitude(), f.radiusMeters());
            }
        }
        f.attributeFilters().forEach((key, value) -> sql.add("AND v.additional_attributes @> ?::jsonb",
                json(Map.of(key, jsonScalar(value)))));
        addDiscoveryCursor(sql, f, cursor);
        sql.add(switch (f.sort()) {
            case "PRICE_ASC" -> "ORDER BY v.price_amount ASC,v.id ASC";
            case "PRICE_DESC" -> "ORDER BY v.price_amount DESC,v.id DESC";
            case "DISTANCE" -> "ORDER BY distance_meters ASC,v.id ASC";
            default -> "ORDER BY v.published_at DESC,v.id DESC";
        });
        sql.add("LIMIT ?", limit + 1);
        List<VehicleListing> rows = jdbc.query(sql.sql.toString(), this::row, sql.args.toArray());
        return page(rows, limit, v -> switch (f.sort()) {
            case "PRICE_ASC", "PRICE_DESC" -> v.priceAmount().toPlainString();
            case "DISTANCE" -> Double.toString(v.distanceMeters());
            default -> v.publishedAt().toString();
        });
    }

    public VehicleQueryResult owned(UUID viewer, Collection<UUID> businessIds, UUID businessFilter,
            String status, VehicleCursor cursor, int limit) {
        Sql sql = new Sql(select("NULL::double precision"));
        sql.args.add(viewer);
        sql.add("WHERE v.status<>'REMOVED' AND (v.owner_user_id=?"
                + (businessIds.isEmpty() ? "" : " OR v.business_account_id IN ("
                + placeholders(businessIds.size()) + ")") + ")", viewer);
        sql.args.addAll(businessIds);
        eq(sql, "v.business_account_id", businessFilter);
        eq(sql, "v.status", status);
        addCursor(sql, "OWNED", cursor);
        sql.add("ORDER BY v.created_at DESC,v.id DESC LIMIT ?", limit + 1);
        List<VehicleListing> rows = jdbc.query(sql.sql.toString(), this::row, sql.args.toArray());
        return page(rows, limit, v -> v.createdAt().toString());
    }

    public VehicleQueryResult saved(UUID viewer, UUID viewerCountry,
            Collection<UUID> accessibleCommunities, VehicleCursor cursor, int limit) {
        Sql sql = new Sql(select("NULL::double precision")
                + "JOIN vehicle_listing_saves sv ON sv.vehicle_listing_id=v.id AND sv.user_id=? "
                + "JOIN countries co ON co.id=v.country_id AND co.is_active ");
        sql.args.add(viewer);
        sql.args.add(viewer);
        sql.add("WHERE v.status='PUBLISHED' AND (v.expires_at IS NULL OR v.expires_at>now())");
        addVisibility(sql, viewerCountry, accessibleCommunities);
        addCursor(sql, "SAVED", cursor);
        sql.add("ORDER BY sv.created_at DESC,v.id DESC LIMIT ?", limit + 1);
        List<VehicleListing> rows = jdbc.query(sql.sql.toString(), this::row, sql.args.toArray());
        Map<UUID, Instant> savedAt = new LinkedHashMap<>();
        if (!rows.isEmpty()) {
            Sql in = in(rows.stream().map(VehicleListing::id).toList());
            jdbc.query("SELECT vehicle_listing_id,created_at FROM vehicle_listing_saves "
                            + "WHERE user_id=? AND vehicle_listing_id IN (" + in.sql + ")", rs -> {
                        savedAt.put(rs.getObject("vehicle_listing_id", UUID.class),
                                rs.getTimestamp("created_at").toInstant());
                    }, concat(List.of(viewer), in.args).toArray());
        }
        return page(rows, limit, v -> savedAt.get(v.id()).toString());
    }

    private static void addVisibility(Sql sql, UUID viewerCountry,
            Collection<UUID> accessibleCommunities) {
        sql.add("AND (v.country_id=? AND (v.visibility_scope='COUNTRY'"
                + (accessibleCommunities.isEmpty() ? "" : " OR (v.visibility_scope='COMMUNITY' "
                + "AND v.community_id IN (" + placeholders(accessibleCommunities.size()) + ") "
                + "AND EXISTS(SELECT 1 FROM communities ac WHERE ac.id=v.community_id AND ac.is_active)) "
                + "OR (v.visibility_scope='SELECTED_COMMUNITIES' AND EXISTS(SELECT 1 "
                + "FROM vehicle_listing_communities sc JOIN communities cc ON cc.id=sc.community_id "
                + "AND cc.is_active WHERE sc.vehicle_listing_id=v.id AND sc.community_id IN ("
                + placeholders(accessibleCommunities.size()) + ")))") + "))", viewerCountry);
        sql.args.addAll(accessibleCommunities);
        if (!accessibleCommunities.isEmpty()) sql.args.addAll(accessibleCommunities);
    }

    private static void addDiscoveryCursor(Sql sql, VehicleSearch f, VehicleCursor cursor) {
        if (cursor == null) return;
        if ("DISTANCE".equals(f.sort())) {
            sql.add("AND (ST_Distance(a.discovery_location,"
                    + "ST_SetSRID(ST_MakePoint(?,?),4326)::geography),v.id)>(?,?)",
                    f.originLongitude(), f.originLatitude(),
                    Double.parseDouble(cursor.sortKey()), cursor.id());
            return;
        }
        addCursor(sql, f.sort(), cursor);
    }

    private static void addCursor(Sql sql, String sort, VehicleCursor cursor) {
        if (cursor == null) return;
        String key = cursor.sortKey();
        switch (sort) {
            case "PRICE_ASC" -> sql.add("AND (v.price_amount,v.id)>(?,?)",
                    new BigDecimal(key), cursor.id());
            case "PRICE_DESC" -> sql.add("AND (v.price_amount,v.id)<(?,?)",
                    new BigDecimal(key), cursor.id());
            case "OWNED" -> sql.add("AND (v.created_at,v.id)<(?,?)",
                    Timestamp.from(Instant.parse(key)), cursor.id());
            case "SAVED" -> sql.add("AND (sv.created_at,v.id)<(?,?)",
                    Timestamp.from(Instant.parse(key)), cursor.id());
            default -> sql.add("AND (v.published_at,v.id)<(?,?)",
                    Timestamp.from(Instant.parse(key)), cursor.id());
        }
    }

    private static VehicleQueryResult page(List<VehicleListing> rows, int limit,
            Function<VehicleListing, String> sortKey) {
        if (rows.size() <= limit) return new VehicleQueryResult(rows, null);
        List<VehicleListing> page = List.copyOf(rows.subList(0, limit));
        VehicleListing last = page.getLast();
        return new VehicleQueryResult(page, sortKey.apply(last));
    }

    public List<VehicleCatalogItem> categories() {
        return jdbc.query("SELECT id,category_key,display_name,sort_order FROM vehicle_categories "
                + "WHERE is_active ORDER BY sort_order,display_name", this::catalogRow);
    }

    public List<VehicleCatalogItem> makes() {
        return jdbc.query("SELECT id,make_key,display_name,0 AS sort_order FROM vehicle_makes "
                + "WHERE is_active ORDER BY display_name", this::catalogRow);
    }

    public List<VehicleCatalogItem> models(UUID makeId) {
        return jdbc.query("SELECT id,model_key,display_name,0 AS sort_order FROM vehicle_models "
                + "WHERE make_id=? AND is_active ORDER BY display_name", this::catalogRow, makeId);
    }

    public List<VehicleCatalogItem> variants(UUID modelId) {
        return jdbc.query("SELECT id,variant_key,display_name,0 AS sort_order FROM vehicle_variants "
                + "WHERE model_id=? AND is_active ORDER BY display_name", this::catalogRow, modelId);
    }

    public List<VehicleCatalogItem> features() {
        return jdbc.query("SELECT id,feature_key,display_name,sort_order FROM vehicle_features "
                + "WHERE is_active ORDER BY sort_order,display_name", this::catalogRow);
    }

    private VehicleCatalogItem catalogRow(ResultSet rs, int i) throws SQLException {
        return new VehicleCatalogItem(rs.getObject("id", UUID.class), rs.getString(2),
                rs.getString("display_name"), rs.getInt("sort_order"));
    }

    public boolean catalogueValid(UUID categoryId, UUID makeId, UUID modelId, UUID variantId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM vehicle_categories c "
                + "JOIN vehicle_makes m ON m.is_active JOIN vehicle_models mo ON mo.make_id=m.id "
                + "AND mo.is_active WHERE c.id=? AND c.is_active AND m.id=? AND mo.id=? AND (?::uuid IS NULL "
                + "OR EXISTS(SELECT 1 FROM vehicle_variants va WHERE va.id=? AND va.model_id=mo.id "
                + "AND va.is_active)))", Boolean.class, categoryId, makeId, modelId, variantId, variantId));
    }

    public List<VehicleCatalogItem> activeFeatures(Collection<UUID> ids) {
        if (ids.isEmpty()) return List.of();
        Sql in = in(ids);
        return jdbc.query("SELECT id,feature_key,display_name,sort_order FROM vehicle_features "
                + "WHERE is_active AND id IN (" + in.sql + ")", this::catalogRow, in.args.toArray());
    }

    private String json(Object value) {
        return mapper.writeValueAsString(value);
    }

    private static Object jsonScalar(String value) {
        if ("true".equalsIgnoreCase(value) || "false".equalsIgnoreCase(value)) {
            return Boolean.parseBoolean(value);
        }
        try {
            return new BigDecimal(value);
        } catch (NumberFormatException ignored) {
            return value;
        }
    }

    private static void eq(Sql sql, String column, Object value) {
        if (value != null) sql.add("AND " + column + "=?", value);
    }

    private static void range(Sql sql, String column, Number min, Number max) {
        if (min != null) sql.add("AND " + column + ">=?", min);
        if (max != null) sql.add("AND " + column + "<=?", max);
    }

    private static Sql in(Collection<UUID> ids) {
        Sql sql = new Sql(placeholders(ids.size()));
        sql.args.addAll(ids);
        return sql;
    }

    private static String placeholders(int size) {
        return String.join(",", Collections.nCopies(size, "?"));
    }

    private static List<Object> concat(List<?> first, List<?> second) {
        List<Object> result = new ArrayList<>(first);
        result.addAll(second);
        return result;
    }

    private static final class Sql {
        private final StringBuilder sql;
        private final List<Object> args = new ArrayList<>();

        private Sql(String initial) {
            this.sql = new StringBuilder(initial);
        }

        private void add(String fragment, Object... values) {
            sql.append(' ').append(fragment);
            args.addAll(List.of(values));
        }
    }
}
