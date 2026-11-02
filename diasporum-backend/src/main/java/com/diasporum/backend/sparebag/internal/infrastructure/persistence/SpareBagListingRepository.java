package com.diasporum.backend.sparebag.internal.infrastructure.persistence;

import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Address;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Airport;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Category;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.DiscoveryFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Listing;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ListingInput;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** PostgreSQL persistence for listings, reference data, attachments and saves. */
@Repository
public class SpareBagListingRepository {

    private static final String COLS = "l.id,l.owner_user_id,l.listing_type::text,"
            + "l.community_id,l.visibility_scope::text,l.title,l.description,"
            + "l.travel_date_start,l.travel_date_end,l.requested_weight_kg,"
            + "l.requested_parcel_count,l.available_capacity_kg,"
            + "l.available_parcel_count,l.max_single_parcel_kg,l.price_amount,"
            + "l.price_unit::text,l.price_currency,l.collection_place,"
            + "l.collection_address_id,l.handover_place,l.handover_address_id,"
            + "l.handover_notes,l.status::text,l.published_at,l.closes_at,"
            + "l.created_at,l.updated_at,"
            + "oa.id AS oa_id,oa.country_id AS oa_country_id,oa.iata_code AS oa_iata,"
            + "oa.icao_code AS oa_icao,oa.name AS oa_name,oa.city AS oa_city,"
            + "oc.name AS oa_country_name,oc.iso2 AS oa_country_iso2,"
            + "da.id AS da_id,da.country_id AS da_country_id,da.iata_code AS da_iata,"
            + "da.icao_code AS da_icao,da.name AS da_name,da.city AS da_city,"
            + "dc.name AS da_country_name,dc.iso2 AS da_country_iso2";
    private static final String FROM = " FROM spare_bag_listings l "
            + "JOIN airports oa ON oa.id=l.origin_airport_id "
            + "JOIN countries oc ON oc.id=oa.country_id "
            + "JOIN airports da ON da.id=l.destination_airport_id "
            + "JOIN countries dc ON dc.id=da.country_id ";

    private final JdbcTemplate jdbc;

    public SpareBagListingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Listing insert(UUID id, UUID ownerId, ListingInput in) {
        jdbc.update("INSERT INTO spare_bag_listings(id,owner_user_id,listing_type,"
                + "community_id,visibility_scope,origin_airport_id,"
                + "destination_airport_id,title,description,travel_date_start,"
                + "travel_date_end,requested_weight_kg,requested_parcel_count,"
                + "available_capacity_kg,available_parcel_count,max_single_parcel_kg,"
                + "price_amount,price_unit,price_currency,collection_place,"
                + "collection_address_id,handover_place,handover_address_id,"
                + "handover_notes) VALUES(?,?,?::spare_bag_listing_type,?,"
                + "?::visibility_scope,?,?,?,?,?,?,?,?,?,?,?,?,?::spare_bag_price_unit,"
                + "?,?,?,?,?,?)", id, ownerId, in.listingType(), in.communityId(),
                in.visibilityScope(), in.originAirportId(), in.destinationAirportId(),
                in.title(), in.description(), in.travelDateStart(), in.travelDateEnd(),
                in.requestedWeightKg(), in.requestedParcelCount(),
                in.availableCapacityKg(), in.availableParcelCount(),
                in.maxSingleParcelKg(), in.priceAmount(), in.priceUnit(),
                in.priceCurrency(), in.collectionPlace(), in.collectionAddressId(),
                in.handoverPlace(), in.handoverAddressId(), in.handoverNotes());
        return find(id).orElseThrow();
    }

    public Listing update(UUID id, ListingInput in) {
        jdbc.update("UPDATE spare_bag_listings SET community_id=?,"
                + "visibility_scope=?::visibility_scope,origin_airport_id=?,"
                + "destination_airport_id=?,title=?,description=?,travel_date_start=?,"
                + "travel_date_end=?,requested_weight_kg=?,requested_parcel_count=?,"
                + "available_capacity_kg=?,available_parcel_count=?,"
                + "max_single_parcel_kg=?,price_amount=?,"
                + "price_unit=?::spare_bag_price_unit,price_currency=?,collection_place=?,"
                + "collection_address_id=?,handover_place=?,handover_address_id=?,"
                + "handover_notes=?,updated_at=now() WHERE id=?", in.communityId(),
                in.visibilityScope(), in.originAirportId(), in.destinationAirportId(),
                in.title(), in.description(), in.travelDateStart(), in.travelDateEnd(),
                in.requestedWeightKg(), in.requestedParcelCount(),
                in.availableCapacityKg(), in.availableParcelCount(),
                in.maxSingleParcelKg(), in.priceAmount(), in.priceUnit(),
                in.priceCurrency(), in.collectionPlace(), in.collectionAddressId(),
                in.handoverPlace(), in.handoverAddressId(), in.handoverNotes(), id);
        return find(id).orElseThrow();
    }

    public Optional<Listing> find(UUID id) {
        return jdbc.query("SELECT " + COLS + FROM
                        + "WHERE l.id=? AND l.deleted_at IS NULL",
                SpareBagListingRepository::listing, id).stream().findFirst();
    }

    public List<Listing> findAll(Collection<UUID> ids) {
        if (ids.isEmpty()) return List.of();
        return jdbc.query("SELECT " + COLS + FROM + "WHERE l.id IN ("
                + placeholders(ids.size()) + ") AND l.deleted_at IS NULL",
                SpareBagListingRepository::listing, ids.toArray());
    }

    public Optional<Listing> findForUpdate(UUID id) {
        return jdbc.query("SELECT " + COLS + FROM
                        + "WHERE l.id=? AND l.deleted_at IS NULL FOR UPDATE OF l",
                SpareBagListingRepository::listing, id).stream().findFirst();
    }

    public void setStatus(UUID id, String status) {
        jdbc.update("UPDATE spare_bag_listings SET status=?::spare_bag_listing_status,"
                + "published_at=CASE WHEN ?='PUBLISHED' THEN COALESCE(published_at,now())"
                + " ELSE published_at END,updated_at=now() WHERE id=?", status, status, id);
    }

    public Optional<Airport> airport(UUID id) {
        return jdbc.query("SELECT a.id,a.country_id,a.iata_code,a.icao_code,a.name,"
                + "a.city,c.name AS country_name,c.iso2 FROM airports a "
                + "JOIN countries c ON c.id=a.country_id "
                + "WHERE a.id=? AND a.is_active=true AND c.is_active=true",
                SpareBagListingRepository::airport, id).stream().findFirst();
    }

    public List<Airport> airports(String search, UUID countryId, int limit) {
        String pattern = search == null || search.isBlank() ? null
                : "%" + search.trim().toLowerCase() + "%";
        return jdbc.query("SELECT a.id,a.country_id,a.iata_code,a.icao_code,a.name,"
                + "a.city,c.name AS country_name,c.iso2 FROM airports a "
                + "JOIN countries c ON c.id=a.country_id "
                + "WHERE a.is_active=true AND c.is_active=true "
                + "AND (?::uuid IS NULL OR a.country_id=?) "
                + "AND (?::text IS NULL OR lower(a.name||' '||a.city||' '||a.iata_code) LIKE ?) "
                + "ORDER BY a.city,a.name LIMIT ?", SpareBagListingRepository::airport,
                countryId, countryId, pattern, pattern, limit);
    }

    public List<Category> categories() {
        return jdbc.query("SELECT category_key,display_name,sort_order "
                + "FROM spare_bag_categories WHERE is_active=true ORDER BY sort_order",
                (rs, i) -> new Category(rs.getString(1), rs.getString(2), rs.getInt(3)));
    }

    public Set<String> activeCategoryKeys() {
        return Set.copyOf(jdbc.queryForList("SELECT category_key FROM spare_bag_categories"
                + " WHERE is_active=true", String.class));
    }

    public Optional<Address> address(UUID id) {
        return jdbc.query("SELECT id,owner_user_id,country_id,visibility::text,"
                + "address_line_1,address_line_2,city,region,postal_code,formatted_address "
                + "FROM addresses WHERE id=?", (rs, i) -> new Address(
                        rs.getObject("id", UUID.class),
                        rs.getObject("owner_user_id", UUID.class),
                        rs.getObject("country_id", UUID.class), rs.getString("visibility"),
                        rs.getString("address_line_1"), rs.getString("address_line_2"),
                        rs.getString("city"), rs.getString("region"),
                        rs.getString("postal_code"), rs.getString("formatted_address")), id)
                .stream().findFirst();
    }

    public Map<UUID, Address> addressesFor(Collection<UUID> ids) {
        Map<UUID, Address> result = new HashMap<>();
        if (ids.isEmpty()) return result;
        jdbc.query("SELECT id,owner_user_id,country_id,visibility::text,address_line_1,"
                + "address_line_2,city,region,postal_code,formatted_address FROM addresses "
                + "WHERE id IN (" + placeholders(ids.size()) + ")", rs -> {
                    Address address = new Address(rs.getObject("id", UUID.class),
                            rs.getObject("owner_user_id", UUID.class),
                            rs.getObject("country_id", UUID.class), rs.getString("visibility"),
                            rs.getString("address_line_1"), rs.getString("address_line_2"),
                            rs.getString("city"), rs.getString("region"),
                            rs.getString("postal_code"), rs.getString("formatted_address"));
                    result.put(address.id(), address);
                }, ids.toArray());
        return result;
    }

    public void replaceCategories(UUID listingId, List<String> keys) {
        jdbc.update("DELETE FROM spare_bag_listing_categories WHERE listing_id=?", listingId);
        for (String key : keys) {
            jdbc.update("INSERT INTO spare_bag_listing_categories(listing_id,category_key)"
                    + " VALUES(?,?)", listingId, key);
        }
    }

    public void replaceMedia(UUID listingId, List<UUID> mediaIds) {
        jdbc.update("DELETE FROM spare_bag_listing_media WHERE listing_id=?", listingId);
        for (int i = 0; i < mediaIds.size(); i++) {
            jdbc.update("INSERT INTO spare_bag_listing_media(listing_id,media_id,sort_order)"
                    + " VALUES(?,?,?)", listingId, mediaIds.get(i), i);
        }
    }

    public Map<UUID, List<Category>> categoriesFor(Collection<UUID> ids) {
        Map<UUID, List<Category>> result = new HashMap<>();
        if (ids.isEmpty()) return result;
        jdbc.query("SELECT lc.listing_id,lc.category_key,c.display_name,c.sort_order "
                + "FROM spare_bag_listing_categories lc JOIN spare_bag_categories c "
                + "ON c.category_key=lc.category_key WHERE lc.listing_id IN ("
                + placeholders(ids.size()) + ") ORDER BY c.sort_order", rs -> {
                    UUID id = rs.getObject("listing_id", UUID.class);
                    result.computeIfAbsent(id, k -> new ArrayList<>()).add(new Category(
                            rs.getString("category_key"), rs.getString("display_name"),
                            rs.getInt("sort_order")));
                }, ids.toArray());
        return result;
    }

    public Map<UUID, List<UUID>> mediaFor(Collection<UUID> ids) {
        Map<UUID, List<UUID>> result = new HashMap<>();
        if (ids.isEmpty()) return result;
        jdbc.query("SELECT listing_id,media_id FROM spare_bag_listing_media "
                + "WHERE listing_id IN (" + placeholders(ids.size())
                + ") ORDER BY listing_id,sort_order", rs -> {
                    result.computeIfAbsent(rs.getObject("listing_id", UUID.class),
                            k -> new ArrayList<>()).add(rs.getObject("media_id", UUID.class));
                }, ids.toArray());
        return result;
    }

    public Set<UUID> savedFor(UUID userId, Collection<UUID> ids) {
        if (ids.isEmpty()) return Set.of();
        return Set.copyOf(jdbc.queryForList("SELECT listing_id FROM spare_bag_listing_saves "
                + "WHERE user_id=? AND listing_id IN (" + placeholders(ids.size()) + ")",
                UUID.class, prepend(userId, ids)));
    }

    public void save(UUID userId, UUID listingId) {
        jdbc.update("INSERT INTO spare_bag_listing_saves(user_id,listing_id) VALUES(?,?)"
                + " ON CONFLICT DO NOTHING", userId, listingId);
    }

    public void unsave(UUID userId, UUID listingId) {
        jdbc.update("DELETE FROM spare_bag_listing_saves WHERE user_id=? AND listing_id=?",
                userId, listingId);
    }

    public List<Listing> discover(UUID viewerCountryId, List<UUID> communityIds,
            DiscoveryFilters f, LocalDate cursorDate, UUID cursorId, int limit) {
        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder("SELECT ").append(COLS).append(FROM)
                .append("WHERE l.deleted_at IS NULL AND l.status='PUBLISHED' ")
                .append("AND COALESCE(l.travel_date_end,l.travel_date_start)>=CURRENT_DATE ")
                .append("AND (l.closes_at IS NULL OR l.closes_at>now()) ");
        sql.append("AND ((l.visibility_scope='COUNTRY' AND oa.country_id=?) ");
        args.add(viewerCountryId);
        if (!communityIds.isEmpty()) {
            sql.append("OR (l.visibility_scope='COMMUNITY' AND l.community_id IN (")
                    .append(placeholders(communityIds.size())).append(")) ");
            args.addAll(communityIds);
        }
        sql.append(") ");
        filter(sql, args, "l.listing_type=?::spare_bag_listing_type", f.listingType());
        filter(sql, args, "l.community_id=?", f.communityId());
        filter(sql, args, "oa.country_id=?", f.originCountryId());
        filter(sql, args, "da.country_id=?", f.destinationCountryId());
        filter(sql, args, "oa.id=?", f.originAirportId());
        filter(sql, args, "da.id=?", f.destinationAirportId());
        filter(sql, args, "COALESCE(l.travel_date_end,l.travel_date_start)>=?", f.dateFrom());
        filter(sql, args, "l.travel_date_start<=?", f.dateTo());
        filter(sql, args, "l.price_amount<=?", f.maxPrice());
        filter(sql, args, "l.available_capacity_kg>=?", f.minimumCapacityKg());
        filter(sql, args, "l.price_currency=?", f.priceCurrency());
        if (f.categoryKey() != null) {
            sql.append("AND EXISTS(SELECT 1 FROM spare_bag_listing_categories fc "
                    + "WHERE fc.listing_id=l.id AND fc.category_key=?) ");
            args.add(f.categoryKey());
        }
        if (cursorDate != null) {
            sql.append("AND (l.travel_date_start,l.id)>(?,?) ");
            args.add(cursorDate);
            args.add(cursorId);
        }
        sql.append("ORDER BY l.travel_date_start,l.id LIMIT ?");
        args.add(limit);
        return jdbc.query(sql.toString(), SpareBagListingRepository::listing, args.toArray());
    }

    public List<Listing> mine(UUID ownerId, String status, Instant cursorTs,
            UUID cursorId, int limit) {
        List<Object> args = new ArrayList<>();
        args.add(ownerId);
        StringBuilder sql = new StringBuilder("SELECT ").append(COLS).append(FROM)
                .append("WHERE l.owner_user_id=? AND l.deleted_at IS NULL ");
        filter(sql, args, "l.status=?::spare_bag_listing_status", status);
        if (cursorTs != null) {
            sql.append("AND (l.created_at,l.id)<(?,?) ");
            args.add(cursorTs);
            args.add(cursorId);
        }
        sql.append("ORDER BY l.created_at DESC,l.id DESC LIMIT ?");
        args.add(limit);
        return jdbc.query(sql.toString(), SpareBagListingRepository::listing, args.toArray());
    }

    public List<Listing> saved(UUID userId, Instant cursorTs, UUID cursorId, int limit) {
        List<Object> args = new ArrayList<>();
        args.add(userId);
        StringBuilder sql = new StringBuilder("SELECT ").append(COLS).append(FROM)
                .append("JOIN spare_bag_listing_saves s ON s.listing_id=l.id ")
                .append("WHERE s.user_id=? AND l.deleted_at IS NULL ");
        if (cursorTs != null) {
            sql.append("AND (l.created_at,l.id)<(?,?) ");
            args.add(cursorTs);
            args.add(cursorId);
        }
        sql.append("ORDER BY l.created_at DESC,l.id DESC LIMIT ?");
        args.add(limit);
        return jdbc.query(sql.toString(), SpareBagListingRepository::listing, args.toArray());
    }

    public boolean hasOpenReport(UUID reporter, String targetType, UUID targetId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM reports "
                + "WHERE reporter_id=? AND target_type=?::report_target_type "
                + "AND target_id=? AND status='OPEN')", Boolean.class,
                reporter, targetType, targetId));
    }

    public UUID report(UUID reporter, UUID countryId, UUID communityId,
            String targetType, UUID targetId, String reason, String details) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO reports(id,reporter_id,country_id,community_id,target_type,"
                + "target_id,reason,details) VALUES(?,?,?,?,?::report_target_type,?,?,?)",
                id, reporter, countryId, communityId, targetType, targetId, reason, details);
        return id;
    }

    public int expireListings() {
        return jdbc.update("UPDATE spare_bag_listings SET status='EXPIRED',updated_at=now() "
                + "WHERE status IN ('PUBLISHED','PAUSED') AND deleted_at IS NULL "
                + "AND (COALESCE(travel_date_end,travel_date_start)<CURRENT_DATE "
                + "OR (closes_at IS NOT NULL AND closes_at<=now()))");
    }

    private static void filter(StringBuilder sql, List<Object> args,
            String clause, Object value) {
        if (value != null) {
            sql.append("AND ").append(clause).append(' ');
            args.add(value);
        }
    }

    private static String placeholders(int size) {
        return String.join(",", java.util.Collections.nCopies(size, "?"));
    }

    private static Object[] prepend(UUID first, Collection<UUID> rest) {
        List<Object> args = new ArrayList<>();
        args.add(first);
        args.addAll(rest);
        return args.toArray();
    }

    private static Listing listing(ResultSet rs, int i) throws SQLException {
        Airport origin = airport(rs, "oa");
        Airport destination = airport(rs, "da");
        return new Listing(rs.getObject("id", UUID.class),
                rs.getObject("owner_user_id", UUID.class), rs.getString("listing_type"),
                rs.getObject("community_id", UUID.class), rs.getString("visibility_scope"),
                origin, destination, rs.getString("title"), rs.getString("description"),
                rs.getObject("travel_date_start", LocalDate.class),
                rs.getObject("travel_date_end", LocalDate.class),
                rs.getBigDecimal("requested_weight_kg"),
                (Integer) rs.getObject("requested_parcel_count"),
                rs.getBigDecimal("available_capacity_kg"),
                (Integer) rs.getObject("available_parcel_count"),
                rs.getBigDecimal("max_single_parcel_kg"), rs.getBigDecimal("price_amount"),
                rs.getString("price_unit"), rs.getString("price_currency"),
                rs.getString("collection_place"),
                rs.getObject("collection_address_id", UUID.class),
                rs.getString("handover_place"),
                rs.getObject("handover_address_id", UUID.class),
                rs.getString("handover_notes"), rs.getString("status"),
                ts(rs, "published_at"), ts(rs, "closes_at"), ts(rs, "created_at"),
                ts(rs, "updated_at"));
    }

    private static Airport airport(ResultSet rs, int i) throws SQLException {
        return new Airport(rs.getObject("id", UUID.class),
                rs.getObject("country_id", UUID.class), rs.getString("iata_code"),
                rs.getString("icao_code"), rs.getString("name"), rs.getString("city"),
                rs.getString("country_name"), rs.getString("iso2"));
    }

    private static Airport airport(ResultSet rs, String p) throws SQLException {
        return new Airport(rs.getObject(p + "_id", UUID.class),
                rs.getObject(p + "_country_id", UUID.class), rs.getString(p + "_iata"),
                rs.getObject(p + "_icao", String.class), rs.getString(p + "_name"),
                rs.getString(p + "_city"), rs.getString(p + "_country_name"),
                rs.getString(p + "_country_iso2"));
    }

    private static Instant ts(ResultSet rs, String column) throws SQLException {
        var value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }
}
