package com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2;

import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.ModerationItem;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderItem;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderItemInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequest;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequestFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.Touched;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** {@code spare_bag_sender_requests} with its items and media links. */
@Repository
public class SenderRequestRepository {

    private static final String COLS = "r.id,r.owner_user_id,r.from_country_id,r.from_city,"
            + "r.to_country_id,r.to_city,r.description,r.status,r.published_at,r.closes_at,"
            + "r.created_at,r.updated_at";
    private static final String BY_ID = "SELECT " + COLS
            + " FROM spare_bag_sender_requests r WHERE r.id=? AND r.deleted_at IS NULL";
    private static final String INSERT = "INSERT INTO spare_bag_sender_requests("
            + "id,owner_user_id,from_country_id,from_city,to_country_id,to_city,description,"
            + "closes_at) VALUES(?,?,?,?,?,?,?,?)";
    private static final String UPDATE = "UPDATE spare_bag_sender_requests SET "
            + "from_country_id=?,from_city=?,to_country_id=?,to_city=?,description=?,"
            + "closes_at=?,updated_at=now() WHERE id=? AND deleted_at IS NULL";
    private static final String TRANSITION = "UPDATE spare_bag_sender_requests SET "
            + "status=?,published_at=CASE WHEN ?='PUBLISHED' "
            + "THEN COALESCE(published_at,now()) ELSE published_at END,updated_at=now() "
            + "WHERE id=? AND deleted_at IS NULL AND status=ANY(?::text[])";
    private static final String SET_CLOSES_AT = "UPDATE spare_bag_sender_requests "
            + "SET closes_at=?,updated_at=now() WHERE id=?";
    private static final String SOFT_DELETE = "UPDATE spare_bag_sender_requests "
            + "SET deleted_at=now(),updated_at=now() WHERE id=? AND status='DRAFT' "
            + "AND deleted_at IS NULL";
    private static final String DELETE_ITEMS = "DELETE FROM spare_bag_sender_items "
            + "WHERE sender_request_id=?";
    private static final String INSERT_ITEM = "INSERT INTO spare_bag_sender_items("
            + "sender_request_id,item_name,item_description,category_key,quantity,unit_code,"
            + "per_unit_amount,per_unit_unit,declared_value_amount,declared_value_currency,"
            + "sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?)";
    private static final String ITEMS = "SELECT id,sender_request_id,item_name,"
            + "item_description,category_key,quantity,unit_code,per_unit_amount,"
            + "per_unit_unit,declared_value_amount,declared_value_currency,sort_order "
            + "FROM spare_bag_sender_items WHERE sender_request_id=ANY(?::uuid[]) "
            + "ORDER BY sender_request_id,sort_order,created_at";
    private static final String DELETE_MEDIA = "DELETE FROM spare_bag_sender_request_media "
            + "WHERE sender_request_id=?";
    private static final String INSERT_MEDIA = "INSERT INTO spare_bag_sender_request_media("
            + "sender_request_id,media_id,sort_order) VALUES(?,?,?)";
    private static final String MEDIA = "SELECT sender_request_id,media_id "
            + "FROM spare_bag_sender_request_media WHERE sender_request_id=ANY(?::uuid[]) "
            + "ORDER BY sender_request_id,sort_order";
    private static final String EXPIRE = "UPDATE spare_bag_sender_requests "
            + "SET status='EXPIRED',updated_at=now() WHERE deleted_at IS NULL "
            + "AND status IN ('PENDING_REVIEW','PUBLISHED','PAUSED') "
            + "AND closes_at IS NOT NULL AND closes_at<=now() RETURNING id,owner_user_id";
    private static final String PENDING_REVIEW = "SELECT r.id,r.owner_user_id,"
            + "r.from_country_id,r.from_city,r.to_country_id,r.to_city,r.updated_at "
            + "FROM spare_bag_sender_requests r "
            + "WHERE r.status='PENDING_REVIEW' AND r.deleted_at IS NULL "
            + "AND (?::uuid[] IS NULL OR r.from_country_id=ANY(?::uuid[]) "
            + "OR r.to_country_id=ANY(?::uuid[])) "
            + "AND (?::timestamptz IS NULL OR (r.updated_at,r.id)>(?::timestamptz,?::uuid)) "
            + "ORDER BY r.updated_at,r.id LIMIT ?";

    private final JdbcTemplate jdbc;

    public SenderRequestRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<SenderRequest> find(UUID id) {
        return jdbc.query(BY_ID, SenderRequestRepository::row, id).stream().findFirst();
    }

    public Optional<SenderRequest> findForUpdate(UUID id) {
        return jdbc.query(BY_ID + " FOR UPDATE", SenderRequestRepository::row, id).stream()
                .findFirst();
    }

    public List<SenderRequest> findAll(Collection<UUID> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        return jdbc.query("SELECT " + COLS + " FROM spare_bag_sender_requests r "
                + "WHERE r.id=ANY(?::uuid[])", SenderRequestRepository::row,
                SqlSupport.uuidArray(ids));
    }

    public void insert(UUID id, UUID owner, UUID fromCountry, String fromCity,
            UUID toCountry, String toCity, String description, Instant closesAt) {
        jdbc.update(INSERT, id, owner, fromCountry, fromCity, toCountry, toCity,
                description, SqlSupport.ts(closesAt));
    }

    public void update(UUID id, UUID fromCountry, String fromCity, UUID toCountry,
            String toCity, String description, Instant closesAt) {
        jdbc.update(UPDATE, fromCountry, fromCity, toCountry, toCity, description,
                SqlSupport.ts(closesAt), id);
    }

    public int transition(UUID id, Collection<String> from, String to) {
        return jdbc.update(TRANSITION, to, to, id, SqlSupport.textArray(from));
    }

    public void setClosesAt(UUID id, Instant closesAt) {
        jdbc.update(SET_CLOSES_AT, SqlSupport.ts(closesAt), id);
    }

    public int softDeleteDraft(UUID id) {
        return jdbc.update(SOFT_DELETE, id);
    }

    public void replaceItems(UUID requestId, List<SenderItemInput> items) {
        jdbc.update(DELETE_ITEMS, requestId);
        int order = 0;
        for (SenderItemInput item : items) {
            jdbc.update(INSERT_ITEM, requestId, item.itemName(), item.itemDescription(),
                    item.categoryKey(), item.quantity(), item.unitCode(), item.perUnitAmount(),
                    item.perUnitUnit(), item.declaredValueAmount(),
                    item.declaredValueCurrency(), order++);
        }
    }

    public void replaceMedia(UUID requestId, List<UUID> mediaIds) {
        jdbc.update(DELETE_MEDIA, requestId);
        int order = 0;
        for (UUID mediaId : mediaIds) {
            jdbc.update(INSERT_MEDIA, requestId, mediaId, order++);
        }
    }

    public Map<UUID, List<SenderItem>> items(Collection<UUID> requestIds) {
        Map<UUID, List<SenderItem>> out = new LinkedHashMap<>();
        if (requestIds.isEmpty()) {
            return out;
        }
        jdbc.query(ITEMS, rs -> {
            SenderItem item = item(rs);
            out.computeIfAbsent(item.senderRequestId(), k -> new ArrayList<>()).add(item);
        }, SqlSupport.uuidArray(requestIds));
        return out;
    }

    public Map<UUID, List<UUID>> media(Collection<UUID> requestIds) {
        Map<UUID, List<UUID>> out = new LinkedHashMap<>();
        if (requestIds.isEmpty()) {
            return out;
        }
        jdbc.query(MEDIA, rs -> {
            out.computeIfAbsent(rs.getObject(1, UUID.class), k -> new ArrayList<>())
                    .add(rs.getObject(2, UUID.class));
        }, SqlSupport.uuidArray(requestIds));
        return out;
    }

    public List<Touched> expire() {
        return jdbc.query(EXPIRE, (rs, i) -> new Touched(rs.getObject(1, UUID.class),
                rs.getObject(2, UUID.class)));
    }

    /**
     * Published, open requests whose origin or destination is one of
     * {@code visibleCountries} (design doc section 6.6), newest first.
     */
    public List<SenderRequest> search(Set<UUID> visibleCountries, SenderRequestFilters f,
            Instant afterTs, UUID afterId, int limit) {
        StringBuilder sql = new StringBuilder("SELECT ").append(COLS)
                .append(" FROM spare_bag_sender_requests r WHERE r.status='PUBLISHED' "
                        + "AND r.deleted_at IS NULL "
                        + "AND (r.closes_at IS NULL OR r.closes_at>now()) "
                        + "AND (r.from_country_id=ANY(?::uuid[]) "
                        + "OR r.to_country_id=ANY(?::uuid[])) ");
        List<Object> args = new ArrayList<>();
        String visible = SqlSupport.uuidArray(visibleCountries);
        args.add(visible);
        args.add(visible);
        if (f.fromCountryId() != null) {
            sql.append("AND r.from_country_id=? ");
            args.add(f.fromCountryId());
        }
        if (f.toCountryId() != null) {
            sql.append("AND r.to_country_id=? ");
            args.add(f.toCountryId());
        }
        if (f.category() != null) {
            sql.append("AND EXISTS(SELECT 1 FROM spare_bag_sender_items i "
                    + "WHERE i.sender_request_id=r.id AND i.category_key=?) ");
            args.add(f.category());
        }
        if (afterTs != null) {
            sql.append("AND (r.published_at,r.id)<(?,?) ");
            args.add(SqlSupport.ts(afterTs));
            args.add(afterId);
        }
        sql.append("ORDER BY r.published_at DESC,r.id DESC LIMIT ?");
        args.add(limit);
        return jdbc.query(sql.toString(), SenderRequestRepository::row, args.toArray());
    }

    public List<SenderRequest> mine(UUID owner, String status, Instant afterTs, UUID afterId,
            int limit) {
        return jdbc.query("SELECT " + COLS + " FROM spare_bag_sender_requests r "
                + "WHERE r.owner_user_id=? AND r.deleted_at IS NULL "
                + "AND (?::text IS NULL OR r.status=?) "
                + "AND (?::timestamptz IS NULL OR (r.created_at,r.id)<(?::timestamptz,?::uuid)) "
                + "ORDER BY r.created_at DESC,r.id DESC LIMIT ?",
                SenderRequestRepository::row, owner, status, status, SqlSupport.ts(afterTs),
                SqlSupport.ts(afterTs), afterId, limit);
    }

    public List<ModerationItem> pendingReview(Set<UUID> countryScope, Instant afterTs,
            UUID afterId, int limit) {
        String scope = countryScope == null ? null : SqlSupport.uuidArray(countryScope);
        return jdbc.query(PENDING_REVIEW, (rs, i) -> new ModerationItem("SENDER_REQUEST",
                rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
                rs.getObject(3, UUID.class), rs.getString(4), rs.getObject(5, UUID.class),
                rs.getString(6), SqlSupport.ts(rs, "updated_at")), scope, scope, scope,
                SqlSupport.ts(afterTs), SqlSupport.ts(afterTs), afterId, limit);
    }

    private static SenderItem item(ResultSet rs) throws SQLException {
        return new SenderItem(rs.getObject("id", UUID.class),
                rs.getObject("sender_request_id", UUID.class), rs.getString("item_name"),
                rs.getString("item_description"), rs.getString("category_key"),
                rs.getBigDecimal("quantity"), rs.getString("unit_code"),
                rs.getBigDecimal("per_unit_amount"), rs.getString("per_unit_unit"),
                rs.getBigDecimal("declared_value_amount"),
                rs.getString("declared_value_currency"), rs.getInt("sort_order"));
    }

    private static SenderRequest row(ResultSet rs, int i) throws SQLException {
        return new SenderRequest(rs.getObject("id", UUID.class),
                rs.getObject("owner_user_id", UUID.class),
                rs.getObject("from_country_id", UUID.class), rs.getString("from_city"),
                rs.getObject("to_country_id", UUID.class), rs.getString("to_city"),
                rs.getString("description"), rs.getString("status"),
                SqlSupport.ts(rs, "published_at"), SqlSupport.ts(rs, "closes_at"),
                SqlSupport.ts(rs, "created_at"), SqlSupport.ts(rs, "updated_at"));
    }
}
