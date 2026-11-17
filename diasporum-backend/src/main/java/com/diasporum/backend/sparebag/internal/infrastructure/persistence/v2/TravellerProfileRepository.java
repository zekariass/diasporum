package com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2;

import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.RegularRoute;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.TravellerProfile;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

/** {@code spare_bag_traveller_profiles} (one per user). */
@Repository
public class TravellerProfileRepository {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String COLS = "id,user_id,display_name,bio,verification_status,"
            + "accepted_item_categories,regular_routes::text AS regular_routes,status,"
            + "created_at,updated_at";
    private static final String BY_ID = "SELECT " + COLS
            + " FROM spare_bag_traveller_profiles WHERE id=?";
    private static final String BY_USER = "SELECT " + COLS
            + " FROM spare_bag_traveller_profiles WHERE user_id=?";
    private static final String INSERT = "INSERT INTO spare_bag_traveller_profiles("
            + "user_id,display_name,bio,accepted_item_categories,regular_routes) "
            + "VALUES(?,?,?,?::text[],?::jsonb) ON CONFLICT(user_id) DO NOTHING";
    private static final String UPDATE = "UPDATE spare_bag_traveller_profiles SET "
            + "display_name=?,bio=?,accepted_item_categories=?::text[],"
            + "regular_routes=?::jsonb,updated_at=now() WHERE id=?";
    private static final String SET_STATUS = "UPDATE spare_bag_traveller_profiles "
            + "SET status=?,updated_at=now() WHERE id=? AND status=ANY(?::text[])";
    private static final String SET_VERIFICATION = "UPDATE spare_bag_traveller_profiles "
            + "SET verification_status=?,updated_at=now() "
            + "WHERE id=? AND verification_status=ANY(?::text[])";
    private static final String PENDING_VERIFICATIONS = "SELECT " + COLS
            + " FROM spare_bag_traveller_profiles WHERE verification_status='PENDING' "
            + "AND (?::timestamptz IS NULL OR (updated_at,id)>(?::timestamptz,?::uuid)) "
            + "ORDER BY updated_at,id LIMIT ?";

    private final JdbcTemplate jdbc;

    public TravellerProfileRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<TravellerProfile> find(UUID id) {
        return jdbc.query(BY_ID, TravellerProfileRepository::row, id).stream().findFirst();
    }

    public Optional<TravellerProfile> findForUpdate(UUID id) {
        return jdbc.query(BY_ID + " FOR UPDATE", TravellerProfileRepository::row, id)
                .stream().findFirst();
    }

    public Optional<TravellerProfile> byUser(UUID userId) {
        return jdbc.query(BY_USER, TravellerProfileRepository::row, userId).stream()
                .findFirst();
    }

    public Optional<TravellerProfile> byUserForUpdate(UUID userId) {
        return jdbc.query(BY_USER + " FOR UPDATE", TravellerProfileRepository::row, userId)
                .stream().findFirst();
    }

    public List<TravellerProfile> findAll(Collection<UUID> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        return jdbc.query("SELECT " + COLS + " FROM spare_bag_traveller_profiles "
                + "WHERE id=ANY(?::uuid[])", TravellerProfileRepository::row,
                SqlSupport.uuidArray(ids));
    }

    /** Inserts unless the user already has a profile (UNIQUE user_id). */
    public void insertIfAbsent(UUID userId, String displayName, String bio,
            List<String> categories, List<RegularRoute> routes) {
        jdbc.update(INSERT, userId, displayName, bio, SqlSupport.textArray(categories),
                routesJson(routes));
    }

    public void update(UUID id, String displayName, String bio, List<String> categories,
            List<RegularRoute> routes) {
        jdbc.update(UPDATE, displayName, bio, SqlSupport.textArray(categories),
                routesJson(routes), id);
    }

    public int setStatus(UUID id, Collection<String> from, String to) {
        return jdbc.update(SET_STATUS, to, id, SqlSupport.textArray(from));
    }

    public int setVerification(UUID id, Collection<String> from, String to) {
        return jdbc.update(SET_VERIFICATION, to, id, SqlSupport.textArray(from));
    }

    public List<TravellerProfile> pendingVerifications(Instant afterTs, UUID afterId,
            int limit) {
        return jdbc.query(PENDING_VERIFICATIONS, TravellerProfileRepository::row,
                SqlSupport.ts(afterTs), SqlSupport.ts(afterTs), afterId, limit);
    }

    private static String routesJson(List<RegularRoute> routes) {
        if (routes == null) {
            return null;
        }
        List<Map<String, String>> out = new ArrayList<>();
        for (RegularRoute r : routes) {
            Map<String, String> m = new LinkedHashMap<>();
            m.put("fromCountryId", r.fromCountryId().toString());
            m.put("toCountryId", r.toCountryId().toString());
            out.add(m);
        }
        return JSON.writeValueAsString(out);
    }

    @SuppressWarnings("unchecked")
    private static List<RegularRoute> routes(String raw) {
        if (raw == null) {
            return null;
        }
        List<RegularRoute> out = new ArrayList<>();
        for (Object o : JSON.readValue(raw, List.class)) {
            if (o instanceof Map<?, ?> m && m.get("fromCountryId") != null
                    && m.get("toCountryId") != null) {
                out.add(new RegularRoute(UUID.fromString(m.get("fromCountryId").toString()),
                        UUID.fromString(m.get("toCountryId").toString())));
            }
        }
        return out;
    }

    private static TravellerProfile row(ResultSet rs, int i) throws SQLException {
        return new TravellerProfile(rs.getObject("id", UUID.class),
                rs.getObject("user_id", UUID.class), rs.getString("display_name"),
                rs.getString("bio"), rs.getString("verification_status"),
                SqlSupport.textList(rs, "accepted_item_categories"),
                routes(rs.getString("regular_routes")), rs.getString("status"),
                SqlSupport.ts(rs, "created_at"), SqlSupport.ts(rs, "updated_at"));
    }
}
