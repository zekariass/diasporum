package com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2;

import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.Journey;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.JourneyFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.JourneyInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.ModerationItem;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.Touched;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** {@code spare_bag_traveller_journeys}; owner resolved via the traveller profile. */
@Repository
public class JourneyRepository {

    private static final String COLS = "j.id,j.traveller_profile_id,p.user_id AS owner_user_id,"
            + "j.from_country_id,j.from_city,j.to_country_id,j.to_city,j.from_airport_id,"
            + "j.to_airport_id,j.pickup_location,j.delivery_location,j.travel_date,"
            + "j.travel_date_end,j.available_capacity_kg,j.max_single_parcel_kg,"
            + "j.price_per_kg,j.price_per_piece,j.price_currency,j.accepted_categories,"
            + "j.notes,j.status,j.published_at,j.closes_at,j.created_at,j.updated_at,"
            + "p.verification_status AS traveller_verification_status,"
            + "p.status AS traveller_status";
    private static final String FROM = " FROM spare_bag_traveller_journeys j "
            + "JOIN spare_bag_traveller_profiles p ON p.id=j.traveller_profile_id ";
    private static final String BY_ID = "SELECT " + COLS + FROM
            + "WHERE j.id=? AND j.deleted_at IS NULL";
    private static final String INSERT = "INSERT INTO spare_bag_traveller_journeys("
            + "id,traveller_profile_id,from_country_id,from_city,to_country_id,to_city,"
            + "from_airport_id,to_airport_id,pickup_location,delivery_location,travel_date,"
            + "travel_date_end,available_capacity_kg,max_single_parcel_kg,price_per_kg,"
            + "price_per_piece,price_currency,accepted_categories,notes,closes_at) "
            + "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::text[],?,?)";
    private static final String UPDATE = "UPDATE spare_bag_traveller_journeys SET "
            + "from_country_id=?,from_city=?,to_country_id=?,to_city=?,from_airport_id=?,"
            + "to_airport_id=?,pickup_location=?,delivery_location=?,travel_date=?,"
            + "travel_date_end=?,available_capacity_kg=?,max_single_parcel_kg=?,"
            + "price_per_kg=?,price_per_piece=?,price_currency=?,"
            + "accepted_categories=?::text[],notes=?,closes_at=?,updated_at=now() "
            + "WHERE id=? AND deleted_at IS NULL";
    private static final String TRANSITION = "UPDATE spare_bag_traveller_journeys SET "
            + "status=?,published_at=CASE WHEN ?='PUBLISHED' "
            + "THEN COALESCE(published_at,now()) ELSE published_at END,updated_at=now() "
            + "WHERE id=? AND deleted_at IS NULL AND status=ANY(?::text[])";
    private static final String SOFT_DELETE = "UPDATE spare_bag_traveller_journeys "
            + "SET deleted_at=now(),updated_at=now() WHERE id=? AND status='DRAFT' "
            + "AND deleted_at IS NULL";
    private static final String CLOSE_FOR_PROFILE = "UPDATE spare_bag_traveller_journeys "
            + "SET status='CLOSED',updated_at=now() WHERE traveller_profile_id=? "
            + "AND deleted_at IS NULL "
            + "AND status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED')";
    private static final String EXPIRE = "UPDATE spare_bag_traveller_journeys j "
            + "SET status='EXPIRED',updated_at=now() FROM spare_bag_traveller_profiles p "
            + "WHERE p.id=j.traveller_profile_id AND j.deleted_at IS NULL "
            + "AND j.status IN ('PENDING_REVIEW','PUBLISHED','PAUSED') "
            + "AND ((j.closes_at IS NOT NULL AND j.closes_at<=now()) "
            + "OR COALESCE(j.travel_date_end,j.travel_date)<CURRENT_DATE) "
            + "RETURNING j.id,p.user_id";
    private static final String PENDING_REVIEW = "SELECT j.id,p.user_id,j.from_country_id,"
            + "j.from_city,j.to_country_id,j.to_city,j.updated_at" + FROM
            + "WHERE j.status='PENDING_REVIEW' AND j.deleted_at IS NULL "
            + "AND (?::uuid[] IS NULL OR j.from_country_id=ANY(?::uuid[]) "
            + "OR j.to_country_id=ANY(?::uuid[])) "
            + "AND (?::timestamptz IS NULL OR (j.updated_at,j.id)>(?::timestamptz,?::uuid)) "
            + "ORDER BY j.updated_at,j.id LIMIT ?";

    private final JdbcTemplate jdbc;

    public JourneyRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Journey> find(UUID id) {
        return jdbc.query(BY_ID, JourneyRepository::row, id).stream().findFirst();
    }

    public Optional<Journey> findForUpdate(UUID id) {
        return jdbc.query(BY_ID + " FOR UPDATE OF j", JourneyRepository::row, id).stream()
                .findFirst();
    }

    public List<Journey> findAll(Collection<UUID> ids) {
        if (ids.isEmpty()) {
            return List.of();
        }
        return jdbc.query("SELECT " + COLS + FROM + "WHERE j.id=ANY(?::uuid[])",
                JourneyRepository::row, SqlSupport.uuidArray(ids));
    }

    public void insert(UUID id, UUID profileId, JourneyInput in) {
        jdbc.update(INSERT, id, profileId, in.fromCountryId(), in.fromCity(),
                in.toCountryId(), in.toCity(), in.fromAirportId(), in.toAirportId(),
                in.pickupLocation(), in.deliveryLocation(), SqlSupport.date(in.travelDate()),
                SqlSupport.date(in.travelDateEnd()), in.availableCapacityKg(),
                in.maxSingleParcelKg(), in.pricePerKg(), in.pricePerPiece(),
                in.priceCurrency(), SqlSupport.textArray(in.acceptedCategories()),
                in.notes(), SqlSupport.ts(in.closesAt()));
    }

    public void update(UUID id, JourneyInput in) {
        jdbc.update(UPDATE, in.fromCountryId(), in.fromCity(), in.toCountryId(),
                in.toCity(), in.fromAirportId(), in.toAirportId(), in.pickupLocation(),
                in.deliveryLocation(), SqlSupport.date(in.travelDate()),
                SqlSupport.date(in.travelDateEnd()), in.availableCapacityKg(),
                in.maxSingleParcelKg(), in.pricePerKg(), in.pricePerPiece(),
                in.priceCurrency(), SqlSupport.textArray(in.acceptedCategories()),
                in.notes(), SqlSupport.ts(in.closesAt()), id);
    }

    /** Guarded status change; returns rows updated (0 = lost the race / wrong state). */
    public int transition(UUID id, Collection<String> from, String to) {
        return jdbc.update(TRANSITION, to, to, id, SqlSupport.textArray(from));
    }

    public int softDeleteDraft(UUID id) {
        return jdbc.update(SOFT_DELETE, id);
    }

    public int closeOpenForProfile(UUID profileId) {
        return jdbc.update(CLOSE_FOR_PROFILE, profileId);
    }

    public List<Touched> expire() {
        return jdbc.query(EXPIRE, (rs, i) -> new Touched(rs.getObject(1, UUID.class),
                rs.getObject(2, UUID.class)));
    }

    /**
     * Published, open, future journeys whose origin or destination is one of
     * {@code visibleCountries} (design doc section 6.6), keyset-ordered by
     * (travel_date, id).
     */
    public List<Journey> search(Set<UUID> visibleCountries, JourneyFilters f,
            LocalDate afterDate, UUID afterId, int limit) {
        StringBuilder sql = new StringBuilder("SELECT ").append(COLS).append(FROM)
                .append("WHERE j.status='PUBLISHED' AND j.deleted_at IS NULL "
                        + "AND p.status='ACTIVE' "
                        + "AND (j.closes_at IS NULL OR j.closes_at>now()) "
                        + "AND COALESCE(j.travel_date_end,j.travel_date)>=CURRENT_DATE "
                        + "AND (j.from_country_id=ANY(?::uuid[]) "
                        + "OR j.to_country_id=ANY(?::uuid[])) ");
        List<Object> args = new ArrayList<>();
        String visible = SqlSupport.uuidArray(visibleCountries);
        args.add(visible);
        args.add(visible);
        if (f.fromCountryId() != null) {
            sql.append("AND j.from_country_id=? ");
            args.add(f.fromCountryId());
        }
        if (f.toCountryId() != null) {
            sql.append("AND j.to_country_id=? ");
            args.add(f.toCountryId());
        }
        if (f.dateFrom() != null) {
            sql.append("AND COALESCE(j.travel_date_end,j.travel_date)>=? ");
            args.add(SqlSupport.date(f.dateFrom()));
        }
        if (f.dateTo() != null) {
            sql.append("AND j.travel_date<=? ");
            args.add(SqlSupport.date(f.dateTo()));
        }
        if (f.category() != null) {
            // NULL accepted_categories = accepts anything
            sql.append("AND (j.accepted_categories IS NULL OR ?=ANY(j.accepted_categories)) ");
            args.add(f.category());
        }
        if (f.verifiedOnly()) {
            sql.append("AND p.verification_status='VERIFIED' ");
        }
        if (afterDate != null) {
            sql.append("AND (j.travel_date,j.id)>(?,?) ");
            args.add(SqlSupport.date(afterDate));
            args.add(afterId);
        }
        sql.append("ORDER BY j.travel_date,j.id LIMIT ?");
        args.add(limit);
        return jdbc.query(sql.toString(), JourneyRepository::row, args.toArray());
    }

    public List<Journey> mine(UUID ownerUserId, String status, Instant afterTs, UUID afterId,
            int limit) {
        return jdbc.query("SELECT " + COLS + FROM + "WHERE p.user_id=? "
                + "AND j.deleted_at IS NULL AND (?::text IS NULL OR j.status=?) "
                + "AND (?::timestamptz IS NULL OR (j.created_at,j.id)<(?::timestamptz,?::uuid)) "
                + "ORDER BY j.created_at DESC,j.id DESC LIMIT ?", JourneyRepository::row,
                ownerUserId, status, status, SqlSupport.ts(afterTs), SqlSupport.ts(afterTs),
                afterId, limit);
    }

    public List<ModerationItem> pendingReview(Set<UUID> countryScope, Instant afterTs,
            UUID afterId, int limit) {
        String scope = countryScope == null ? null : SqlSupport.uuidArray(countryScope);
        return jdbc.query(PENDING_REVIEW, (rs, i) -> new ModerationItem("JOURNEY",
                rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
                rs.getObject(3, UUID.class), rs.getString(4), rs.getObject(5, UUID.class),
                rs.getString(6), SqlSupport.ts(rs, "updated_at")), scope, scope, scope,
                SqlSupport.ts(afterTs), SqlSupport.ts(afterTs), afterId, limit);
    }

    private static Journey row(ResultSet rs, int i) throws SQLException {
        return new Journey(rs.getObject("id", UUID.class),
                rs.getObject("traveller_profile_id", UUID.class),
                rs.getObject("owner_user_id", UUID.class),
                rs.getObject("from_country_id", UUID.class), rs.getString("from_city"),
                rs.getObject("to_country_id", UUID.class), rs.getString("to_city"),
                rs.getObject("from_airport_id", UUID.class),
                rs.getObject("to_airport_id", UUID.class), rs.getString("pickup_location"),
                rs.getString("delivery_location"), SqlSupport.date(rs, "travel_date"),
                SqlSupport.date(rs, "travel_date_end"),
                rs.getBigDecimal("available_capacity_kg"),
                rs.getBigDecimal("max_single_parcel_kg"), rs.getBigDecimal("price_per_kg"),
                rs.getBigDecimal("price_per_piece"), rs.getString("price_currency"),
                SqlSupport.textList(rs, "accepted_categories"), rs.getString("notes"),
                rs.getString("status"), SqlSupport.ts(rs, "published_at"),
                SqlSupport.ts(rs, "closes_at"), SqlSupport.ts(rs, "created_at"),
                SqlSupport.ts(rs, "updated_at"),
                rs.getString("traveller_verification_status"),
                rs.getString("traveller_status"));
    }
}
