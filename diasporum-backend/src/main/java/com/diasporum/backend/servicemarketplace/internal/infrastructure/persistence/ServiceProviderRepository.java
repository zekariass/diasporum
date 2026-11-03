package com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence;

import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Category;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Cursor;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Provider;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderSearch;
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

/** JDBC persistence and PostGIS discovery for service providers/categories. */
@Repository
public class ServiceProviderRepository {
    private static final String COLS = "sp.id,sp.owner_user_id,sp.business_account_id,"
            + "sp.display_name,sp.description,ST_Y(sp.base_location::geometry) AS latitude,"
            + "ST_X(sp.base_location::geometry) AS longitude,sp.radius_km,sp.status,"
            + "sp.verification_status,sp.created_at,sp.updated_at";

    private final JdbcTemplate jdbc;

    public ServiceProviderRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Category> categories(String languageCode, UUID parentId) {
        return jdbc.query("SELECT c.id,c.category_key,c.parent_id,"
                + "COALESCE(requested.display_name,english.display_name,c.category_key) AS display_name,"
                + "COALESCE(requested.description,english.description) AS description,c.sort_order "
                + "FROM service_categories c "
                + "LEFT JOIN service_category_translations english ON english.service_category_id=c.id "
                + "AND english.language_id=(SELECT id FROM languages WHERE language_code='en') "
                + "LEFT JOIN service_category_translations requested ON requested.service_category_id=c.id "
                + "AND requested.language_id=(SELECT id FROM languages WHERE language_code=?) "
                + "WHERE c.is_active=true AND (?::uuid IS NULL OR c.parent_id=?) "
                + "ORDER BY c.sort_order,c.category_key,c.id", (rs, row) -> category(rs),
                languageCode, parentId, parentId);
    }

    public boolean languageExists(String languageCode) {
        return bool("SELECT EXISTS(SELECT 1 FROM languages WHERE language_code=? AND is_active=true)",
                languageCode);
    }

    public boolean activeCategory(UUID id) {
        return bool("SELECT EXISTS(SELECT 1 FROM service_categories WHERE id=? AND is_active=true)", id);
    }

    public boolean activeCountry(UUID id) {
        return bool("SELECT EXISTS(SELECT 1 FROM countries WHERE id=? AND is_active=true)", id);
    }

    public Provider insert(UUID id, UUID ownerUserId, ProviderInput in) {
        jdbc.update("INSERT INTO service_providers(id,owner_user_id,business_account_id,"
                + "display_name,description,base_location,radius_km) VALUES(?,?,?,?,?,"
                + "ST_SetSRID(ST_MakePoint(?,?),4326)::geography,?)", id, ownerUserId,
                in.businessAccountId(), in.displayName().trim(), trim(in.description()),
                in.baseLongitude(), in.baseLatitude(), in.radiusKm());
        replaceCategories(id, in.categoryIds());
        return find(id).orElseThrow();
    }

    public Provider update(UUID id, ProviderInput in) {
        jdbc.update("UPDATE service_providers SET display_name=?,description=?,"
                + "base_location=ST_SetSRID(ST_MakePoint(?,?),4326)::geography,"
                + "radius_km=?,updated_at=now() WHERE id=?", in.displayName().trim(),
                trim(in.description()), in.baseLongitude(), in.baseLatitude(), in.radiusKm(), id);
        replaceCategories(id, in.categoryIds());
        return find(id).orElseThrow();
    }

    public void replaceCategories(UUID providerId, List<UUID> categoryIds) {
        jdbc.update("DELETE FROM service_provider_services WHERE service_provider_id=?", providerId);
        for (UUID categoryId : categoryIds) {
            jdbc.update("INSERT INTO service_provider_services(service_provider_id,service_category_id) "
                    + "VALUES(?,?)", providerId, categoryId);
        }
    }

    public Optional<Provider> find(UUID id) {
        return jdbc.query("SELECT " + COLS + " FROM service_providers sp WHERE sp.id=?",
                ServiceProviderRepository::provider, id).stream().findFirst();
    }

    public Optional<Provider> findForUpdate(UUID id) {
        return jdbc.query("SELECT " + COLS + " FROM service_providers sp WHERE sp.id=? FOR UPDATE",
                ServiceProviderRepository::provider, id).stream().findFirst();
    }

    public Optional<Provider> findAllByRequestAndEndpoint(UUID requestId, UUID userId,
            UUID businessAccountId) {
        return jdbc.query("SELECT " + COLS + " FROM service_providers sp "
                + "JOIN service_lead_access l ON l.service_provider_id=sp.id "
                + "WHERE l.service_request_id=? AND l.status='ACTIVE' AND l.chat_enabled=true "
                + "AND ((sp.owner_user_id=? AND ?::uuid IS NULL) "
                + "OR (sp.business_account_id=? AND ?::uuid IS NOT NULL))",
                ServiceProviderRepository::provider, requestId, userId, businessAccountId,
                businessAccountId, businessAccountId).stream().findFirst();
    }

    public void setStatus(UUID id, String status) {
        jdbc.update("UPDATE service_providers SET status=?,updated_at=now() WHERE id=?", status, id);
    }

    public List<Provider> owned(UUID ownerUserId, List<UUID> businessIds, String status,
            Cursor cursor, int limit) {
        StringBuilder sql = new StringBuilder("SELECT " + COLS + " FROM service_providers sp "
                + "WHERE (sp.owner_user_id=?");
        List<Object> args = new ArrayList<>();
        args.add(ownerUserId);
        if (!businessIds.isEmpty()) {
            sql.append(" OR sp.business_account_id IN (").append(placeholders(businessIds.size())).append(")");
            args.addAll(businessIds);
        }
        sql.append(")");
        if (status != null) {
            sql.append(" AND sp.status=?");
            args.add(status);
        }
        if (cursor != null) {
            sql.append(" AND (sp.created_at,sp.id)<(?,?)");
            args.add(Timestamp.from(Instant.parse(cursor.primary())));
            args.add(cursor.id());
        }
        sql.append(" ORDER BY sp.created_at DESC,sp.id DESC LIMIT ?");
        args.add(limit + 1);
        return jdbc.query(sql.toString(), ServiceProviderRepository::provider, args.toArray());
    }

    public List<UUID> manageableProviderIds(UUID ownerUserId, List<UUID> businessIds) {
        StringBuilder sql = new StringBuilder("SELECT id FROM service_providers "
                + "WHERE status<>'CLOSED' AND (owner_user_id=?");
        List<Object> args = new ArrayList<>();
        args.add(ownerUserId);
        if (!businessIds.isEmpty()) {
            sql.append(" OR business_account_id IN (").append(placeholders(businessIds.size())).append(")");
            args.addAll(businessIds);
        }
        sql.append(") ORDER BY id");
        return jdbc.query(sql.toString(), (rs, row) -> rs.getObject(1, UUID.class), args.toArray());
    }

    public List<Provider> discover(ProviderSearch search, Cursor cursor, int limit) {
        boolean distance = "DISTANCE".equals(search.sort());
        String point = "ST_SetSRID(ST_MakePoint(?,?),4326)::geography";
        String distanceSql = distance ? "ST_Distance(sp.base_location," + point + ")"
                : "NULL::double precision";
        StringBuilder sql = new StringBuilder("SELECT " + COLS + "," + distanceSql
                + " AS distance_meters FROM service_providers sp WHERE sp.status='ACTIVE'");
        List<Object> args = new ArrayList<>();
        if (distance) {
            args.add(search.originLongitude());
            args.add(search.originLatitude());
        }
        if (search.categoryId() != null) {
            sql.append(" AND EXISTS(SELECT 1 FROM service_provider_services sps "
                    + "WHERE sps.service_provider_id=sp.id AND sps.service_category_id=?)");
            args.add(search.categoryId());
        }
        if (search.query() != null && !search.query().isBlank()) {
            sql.append(" AND lower(sp.display_name||' '||COALESCE(sp.description,'')) LIKE ?");
            args.add("%" + search.query().trim().toLowerCase() + "%");
        }
        if (search.originLatitude() != null && search.radiusKm() != null) {
            sql.append(" AND ST_DWithin(sp.base_location,").append(point).append(",?)");
            args.add(search.originLongitude());
            args.add(search.originLatitude());
            args.add(search.radiusKm().doubleValue() * 1000d);
        }
        if (cursor != null) {
            if (distance) {
                sql.append(" AND (ST_Distance(sp.base_location,").append(point).append("),sp.id)>(?,?)");
                args.add(search.originLongitude());
                args.add(search.originLatitude());
                args.add(Double.parseDouble(cursor.primary()));
                args.add(cursor.id());
            } else {
                sql.append(" AND (sp.created_at,sp.id)<(?,?)");
                args.add(Timestamp.from(Instant.parse(cursor.primary())));
                args.add(cursor.id());
            }
        }
        sql.append(distance ? " ORDER BY distance_meters ASC,sp.id ASC"
                : " ORDER BY sp.created_at DESC,sp.id DESC");
        sql.append(" LIMIT ?");
        args.add(limit + 1);
        return jdbc.query(sql.toString(), ServiceProviderRepository::providerWithDistance, args.toArray());
    }

    public List<Provider> matching(UUID requestId, Double maxDistanceKm, String sort,
            Cursor cursor, int limit) {
        boolean distance = "DISTANCE".equals(sort);
        StringBuilder sql = new StringBuilder("SELECT " + COLS
                + ",ST_Distance(sp.base_location,sr.location) AS distance_meters "
                + "FROM service_providers sp JOIN service_requests sr ON sr.id=? "
                + "JOIN service_provider_services sps ON sps.service_provider_id=sp.id "
                + "AND sps.service_category_id=sr.service_category_id "
                + "WHERE sp.status='ACTIVE' AND ST_DWithin(sp.base_location,sr.location,LEAST(sp.radius_km*1000,?))");
        List<Object> args = new ArrayList<>();
        args.add(requestId);
        args.add(maxDistanceKm);
        if (cursor != null) {
            if (distance) {
                sql.append(" AND (ST_Distance(sp.base_location,sr.location),sp.id)>(?,?)");
                args.add(Double.parseDouble(cursor.primary()));
                args.add(cursor.id());
            } else {
                sql.append(" AND (sp.created_at,sp.id)<(?,?)");
                args.add(Timestamp.from(Instant.parse(cursor.primary())));
                args.add(cursor.id());
            }
        }
        sql.append(distance ? " ORDER BY distance_meters ASC,sp.id ASC"
                : " ORDER BY sp.created_at DESC,sp.id DESC");
        sql.append(" LIMIT ?");
        args.add(limit + 1);
        return jdbc.query(sql.toString(), ServiceProviderRepository::providerWithDistance, args.toArray());
    }

    public Map<UUID, List<Category>> categoriesFor(Collection<UUID> providerIds) {
        if (providerIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, List<Category>> result = new HashMap<>();
        jdbc.query("SELECT sps.service_provider_id,c.id,c.category_key,c.parent_id,"
                + "COALESCE(t.display_name,c.category_key) AS display_name,t.description AS description,c.sort_order "
                + "FROM service_provider_services sps JOIN service_categories c "
                + "ON c.id=sps.service_category_id LEFT JOIN service_category_translations t "
                + "ON t.service_category_id=c.id AND t.language_id="
                + "(SELECT id FROM languages WHERE language_code='en') "
                + "WHERE sps.service_provider_id IN (" + placeholders(providerIds.size()) + ") "
                + "ORDER BY c.sort_order,c.category_key", rs -> {
                    UUID providerId = rs.getObject("service_provider_id", UUID.class);
                    result.computeIfAbsent(providerId, ignored -> new ArrayList<>()).add(category(rs));
                }, providerIds.toArray());
        return result;
    }

    public boolean providerOwnsCategory(UUID providerId, UUID categoryId) {
        return bool("SELECT EXISTS(SELECT 1 FROM service_provider_services "
                + "WHERE service_provider_id=? AND service_category_id=?)", providerId, categoryId);
    }

    private static Provider provider(ResultSet rs, int row) throws SQLException {
        return readProvider(rs, null);
    }

    private static Provider providerWithDistance(ResultSet rs, int row) throws SQLException {
        return readProvider(rs, rs.getObject("distance_meters", Double.class));
    }

    private static Provider readProvider(ResultSet rs, Double distance) throws SQLException {
        return new Provider(rs.getObject("id", UUID.class),
                rs.getObject("owner_user_id", UUID.class),
                rs.getObject("business_account_id", UUID.class), rs.getString("display_name"),
                rs.getString("description"), rs.getObject("latitude", Double.class),
                rs.getObject("longitude", Double.class), rs.getBigDecimal("radius_km"),
                rs.getString("status"), rs.getString("verification_status"), List.of(), distance,
                false, instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private static Category category(ResultSet rs) throws SQLException {
        return new Category(rs.getObject("id", UUID.class), rs.getString("category_key"),
                rs.getObject("parent_id", UUID.class), rs.getString("display_name"),
                rs.getString("description"), rs.getInt("sort_order"));
    }

    private boolean bool(String sql, Object... args) {
        return Boolean.TRUE.equals(jdbc.queryForObject(sql, Boolean.class, args));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String placeholders(int size) {
        return String.join(",", java.util.Collections.nCopies(size, "?"));
    }
}
