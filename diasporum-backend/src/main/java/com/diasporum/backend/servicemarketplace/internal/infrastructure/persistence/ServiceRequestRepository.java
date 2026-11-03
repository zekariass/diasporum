package com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence;

import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Cursor;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.RequestInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.RequestSearch;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ServiceRequest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** JDBC persistence and deterministic PostGIS search for service requests. */
@Repository
public class ServiceRequestRepository {
    private static final String COLS = "sr.id,sr.customer_user_id,sr.service_category_id,"
            + "COALESCE(ct.display_name,c.category_key) AS category_display_name,sr.country_id,"
            + "sr.address_id,ST_Y(sr.location::geometry) AS latitude,"
            + "ST_X(sr.location::geometry) AS longitude,sr.title,sr.description,sr.budget_min,"
            + "sr.budget_max,sr.currency_code,sr.preferred_date,sr.status,sr.expires_at,"
            + "sr.published_at,sr.created_at,sr.updated_at";
    private static final String FROM = " FROM service_requests sr "
            + "JOIN service_categories c ON c.id=sr.service_category_id "
            + "LEFT JOIN service_category_translations ct ON ct.service_category_id=c.id "
            + "AND ct.language_id=(SELECT id FROM languages WHERE language_code='en') "
            + "LEFT JOIN addresses a ON a.id=sr.address_id ";

    private final JdbcTemplate jdbc;

    public ServiceRequestRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public ServiceRequest insert(UUID id, UUID customerUserId, RequestInput in) {
        jdbc.update("INSERT INTO service_requests(id,customer_user_id,service_category_id,country_id,"
                + "address_id,location,title,description,budget_min,budget_max,currency_code,"
                + "preferred_date,expires_at) VALUES(?,?,?,?,?,"
                + "ST_SetSRID(ST_MakePoint(?,?),4326)::geography,?,?,?,?,?,?,?)", id,
                customerUserId, in.serviceCategoryId(), in.countryId(), in.addressId(),
                in.longitude(), in.latitude(), in.title().trim(), in.description().trim(),
                in.budgetMin(), in.budgetMax(), upper(in.currencyCode()), in.preferredDate(),
                in.expiresAt() == null ? null : Timestamp.from(in.expiresAt()));
        replaceMedia(id, in.mediaIds());
        return find(id).orElseThrow();
    }

    public ServiceRequest update(UUID id, RequestInput in) {
        jdbc.update("UPDATE service_requests SET service_category_id=?,country_id=?,address_id=?,"
                + "location=ST_SetSRID(ST_MakePoint(?,?),4326)::geography,title=?,description=?,"
                + "budget_min=?,budget_max=?,currency_code=?,preferred_date=?,expires_at=?,"
                + "updated_at=now() WHERE id=?", in.serviceCategoryId(), in.countryId(), in.addressId(),
                in.longitude(), in.latitude(), in.title().trim(), in.description().trim(),
                in.budgetMin(), in.budgetMax(), upper(in.currencyCode()), in.preferredDate(),
                in.expiresAt() == null ? null : Timestamp.from(in.expiresAt()), id);
        replaceMedia(id, in.mediaIds());
        return find(id).orElseThrow();
    }

    public void replaceMedia(UUID requestId, List<UUID> mediaIds) {
        jdbc.update("DELETE FROM service_request_media WHERE service_request_id=?", requestId);
        short order = 0;
        for (UUID mediaId : mediaIds) {
            jdbc.update("INSERT INTO service_request_media(service_request_id,media_id,sort_order) "
                    + "VALUES(?,?,?)", requestId, mediaId, order++);
        }
    }

    public Optional<ServiceRequest> find(UUID id) {
        return jdbc.query("SELECT " + COLS + ",NULL::double precision AS distance_meters" + FROM + "WHERE sr.id=?", ServiceRequestRepository::request,
                id).stream().findFirst();
    }

    public Optional<ServiceRequest> findForUpdate(UUID id) {
        return jdbc.query("SELECT " + COLS + ",NULL::double precision AS distance_meters" + FROM + "WHERE sr.id=? FOR UPDATE OF sr",
                ServiceRequestRepository::request, id).stream().findFirst();
    }

    public void setStatus(UUID id, String status, boolean publish) {
        jdbc.update("UPDATE service_requests SET status=?,published_at=CASE WHEN ? "
                + "THEN COALESCE(published_at,now()) ELSE published_at END,updated_at=now() WHERE id=?",
                status, publish, id);
    }

    public void softDelete(UUID id) {
        jdbc.update("UPDATE service_requests SET status='REMOVED',deleted_at=now(),updated_at=now() "
                + "WHERE id=?", id);
    }

    public List<ServiceRequest> owned(UUID customerUserId, String status, Cursor cursor, int limit) {
        StringBuilder sql = new StringBuilder("SELECT " + COLS + ",NULL::double precision AS distance_meters" + FROM
                + "WHERE sr.customer_user_id=? AND sr.deleted_at IS NULL");
        List<Object> args = new ArrayList<>();
        args.add(customerUserId);
        if (status != null) {
            sql.append(" AND sr.status=?");
            args.add(status);
        }
        if (cursor != null) {
            sql.append(" AND (sr.created_at,sr.id)<(?,?)");
            args.add(Timestamp.from(Instant.parse(cursor.primary())));
            args.add(cursor.id());
        }
        sql.append(" ORDER BY sr.created_at DESC,sr.id DESC LIMIT ?");
        args.add(limit + 1);
        return jdbc.query(sql.toString(), ServiceRequestRepository::request, args.toArray());
    }

    public List<ServiceRequest> discover(UUID actorUserId, UUID providerId, RequestSearch search,
            Cursor cursor, int limit) {
        String sort = search.sort();
        boolean distance = "DISTANCE".equals(sort);
        boolean price = sort.startsWith("PRICE_");
        String distanceSelect = distance ? ",ST_Distance(sr.location,sp.base_location) AS distance_meters"
                : ",NULL::double precision AS distance_meters";
        StringBuilder sql = new StringBuilder("SELECT " + COLS + distanceSelect + FROM);
        List<Object> args = new ArrayList<>();
        sql.append("JOIN service_providers sp ON sp.id=? AND sp.status='ACTIVE' "
                + "JOIN service_provider_services sps ON sps.service_provider_id=sp.id "
                + "AND sps.service_category_id=sr.service_category_id ");
        args.add(providerId);
        sql.append("WHERE sr.status='OPEN' AND sr.deleted_at IS NULL "
                + "AND (sr.expires_at IS NULL OR sr.expires_at>now()) "
                + "AND sr.customer_user_id<>? "
                + "AND (sp.owner_user_id IS NULL OR sr.customer_user_id<>sp.owner_user_id) "
                + "AND (sp.business_account_id IS NULL OR NOT EXISTS("
                + "SELECT 1 FROM business_account_members m "
                + "WHERE m.business_account_id=sp.business_account_id "
                + "AND m.user_id=sr.customer_user_id AND m.accepted_at IS NOT NULL "
                + "AND m.revoked_at IS NULL)) "
                + "AND ST_DWithin(sr.location,sp.base_location,sp.radius_km*1000)");
        args.add(actorUserId);
        if (search.categoryId() != null) {
            sql.append(" AND sr.service_category_id=?");
            args.add(search.categoryId());
        }
        if (search.countryId() != null) {
            sql.append(" AND sr.country_id=?");
            args.add(search.countryId());
        }
        if (search.city() != null && !search.city().isBlank()) {
            sql.append(" AND sr.address_id IS NOT NULL AND lower(a.city)=lower(?)");
            args.add(search.city().trim());
        }
        if (search.budgetMin() != null) {
            sql.append(" AND COALESCE(sr.budget_max,sr.budget_min)>=?");
            args.add(search.budgetMin());
        }
        if (search.budgetMax() != null) {
            sql.append(" AND COALESCE(sr.budget_min,sr.budget_max)<=?");
            args.add(search.budgetMax());
        }
        if (search.currencyCode() != null) {
            sql.append(" AND sr.currency_code=?");
            args.add(upper(search.currencyCode()));
        }
        if (search.preferredDateFrom() != null) {
            sql.append(" AND sr.preferred_date>=?");
            args.add(search.preferredDateFrom());
        }
        if (search.preferredDateTo() != null) {
            sql.append(" AND sr.preferred_date<=?");
            args.add(search.preferredDateTo());
        }
        if (search.maxDistanceKm() != null) {
            sql.append(" AND ST_DWithin(sr.location,sp.base_location,?)");
            args.add(search.maxDistanceKm().doubleValue() * 1000d);
        }
        appendCursor(sql, args, search, cursor, distance, price);
        if (distance) {
            sql.append(" ORDER BY distance_meters ASC,sr.id ASC");
        } else if (price) {
            String direction = "PRICE_ASC".equals(sort) ? "ASC" : "DESC";
            String sentinel = "PRICE_ASC".equals(sort)
                    ? "1000000000000000000000000000000" : "-1000000000000000000000000000000";
            sql.append(" ORDER BY COALESCE(COALESCE(sr.budget_min,sr.budget_max),").append(sentinel)
                    .append(") ").append(direction)
                    .append(",COALESCE(COALESCE(sr.budget_max,sr.budget_min),").append(sentinel)
                    .append(") ").append(direction).append(",sr.id ").append(direction);
        } else {
            sql.append(" ORDER BY sr.published_at DESC,sr.id DESC");
        }
        sql.append(" LIMIT ?");
        args.add(limit + 1);
        return jdbc.query(sql.toString(), ServiceRequestRepository::requestWithDistance, args.toArray());
    }

    private void appendCursor(StringBuilder sql, List<Object> args, RequestSearch search,
            Cursor cursor, boolean distance, boolean price) {
        if (cursor == null) {
            return;
        }
        if (distance) {
            sql.append(" AND (ST_Distance(sr.location,sp.base_location),sr.id)>(?,?)");
            args.add(Double.parseDouble(cursor.primary()));
            args.add(cursor.id());
        } else if (price) {
            boolean asc = "PRICE_ASC".equals(search.sort());
            String sentinel = asc ? "1000000000000000000000000000000"
                    : "-1000000000000000000000000000000";
            String operator = asc ? ">" : "<";
            sql.append(" AND (COALESCE(COALESCE(sr.budget_min,sr.budget_max),").append(sentinel)
                    .append("),COALESCE(COALESCE(sr.budget_max,sr.budget_min),").append(sentinel)
                    .append("),sr.id)").append(operator).append("(?,?,?)");
            args.add(new java.math.BigDecimal(cursor.primary()));
            args.add(new java.math.BigDecimal(cursor.secondary()));
            args.add(cursor.id());
        } else {
            sql.append(" AND (sr.published_at,sr.id)<(?,?)");
            args.add(Timestamp.from(Instant.parse(cursor.primary())));
            args.add(cursor.id());
        }
    }

    public Map<UUID, List<UUID>> mediaFor(Collection<UUID> requestIds) {
        if (requestIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, List<UUID>> result = new HashMap<>();
        jdbc.query("SELECT service_request_id,media_id FROM service_request_media "
                + "WHERE service_request_id IN (" + placeholders(requestIds.size()) + ") "
                + "ORDER BY service_request_id,sort_order,media_id", rs -> {
                    result.computeIfAbsent(rs.getObject(1, UUID.class), ignored -> new ArrayList<>())
                            .add(rs.getObject(2, UUID.class));
                }, requestIds.toArray());
        return result;
    }

    public boolean hasMedia(UUID requestId, UUID mediaId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM service_request_media "
                + "WHERE service_request_id=? AND media_id=?)", Boolean.class, requestId, mediaId));
    }

    public boolean ownedAddress(UUID addressId, UUID userId, UUID countryId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM addresses "
                + "WHERE id=? AND owner_user_id=? AND country_id=?)", Boolean.class,
                addressId, userId, countryId));
    }

    public int expireRequests() {
        return jdbc.update("UPDATE service_requests SET status='EXPIRED',updated_at=now() "
                + "WHERE status IN('OPEN','PAUSED') AND expires_at<=now()");
    }

    private static ServiceRequest request(ResultSet rs, int row) throws SQLException {
        return readRequest(rs);
    }

    private static ServiceRequest requestWithDistance(ResultSet rs, int row) throws SQLException {
        return readRequest(rs);
    }

    private static ServiceRequest readRequest(ResultSet rs) throws SQLException {
        return new ServiceRequest(rs.getObject("id", UUID.class),
                rs.getObject("customer_user_id", UUID.class), null,
                rs.getObject("service_category_id", UUID.class),
                rs.getString("category_display_name"), rs.getObject("country_id", UUID.class),
                rs.getObject("address_id", UUID.class), rs.getObject("latitude", Double.class),
                rs.getObject("longitude", Double.class), rs.getString("title"),
                rs.getString("description"), rs.getBigDecimal("budget_min"),
                rs.getBigDecimal("budget_max"), rs.getString("currency_code"),
                rs.getObject("preferred_date", java.time.LocalDate.class), rs.getString("status"),
                instant(rs, "expires_at"), instant(rs, "published_at"), List.of(),
                rs.getObject("distance_meters", Double.class), false,
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static String upper(String value) {
        return value == null ? null : value.trim().toUpperCase();
    }

    private static String placeholders(int size) {
        return String.join(",", java.util.Collections.nCopies(size, "?"));
    }
}
