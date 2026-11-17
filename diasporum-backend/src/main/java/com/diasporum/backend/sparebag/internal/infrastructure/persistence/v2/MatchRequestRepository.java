package com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2;

import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.MatchRequest;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.Touched;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** {@code spare_bag_match_requests} (V39) plus its idempotency records. */
@Repository
public class MatchRequestRepository {

    private static final String COLS = "m.id,m.sender_request_id,m.journey_id,"
            + "m.requested_by_user_id,m.responded_by_user_id,m.direct_conversation_id,"
            + "m.status,m.message,m.response_note,m.responded_at,m.created_at,m.updated_at";
    private static final String BY_ID = "SELECT " + COLS
            + " FROM spare_bag_match_requests m WHERE m.id=?";
    private static final String OPEN_PAIR = "SELECT " + COLS
            + " FROM spare_bag_match_requests m WHERE m.sender_request_id=? "
            + "AND m.journey_id=? AND m.status IN ('PENDING','ACCEPTED')";
    private static final String INSERT = "INSERT INTO spare_bag_match_requests("
            + "id,sender_request_id,journey_id,requested_by_user_id,message) "
            + "VALUES(?,?,?,?,?)";
    private static final String RESPOND = "UPDATE spare_bag_match_requests SET status=?,"
            + "responded_by_user_id=?,response_note=?,responded_at=now(),updated_at=now() "
            + "WHERE id=? AND status='PENDING'";
    private static final String SET_STATUS = "UPDATE spare_bag_match_requests SET "
            + "status=?,updated_at=now() WHERE id=? AND status=?";
    private static final String LINK = "UPDATE spare_bag_match_requests SET "
            + "direct_conversation_id=?,updated_at=now() WHERE id=?";
    private static final String EXPIRE_OTHERS_FOR_REQUEST = "UPDATE spare_bag_match_requests "
            + "SET status='EXPIRED',updated_at=now() WHERE sender_request_id=? AND id<>? "
            + "AND status='PENDING' RETURNING id,requested_by_user_id";
    private static final String EXPIRE_OPEN_FOR_REQUEST = "UPDATE spare_bag_match_requests "
            + "SET status='EXPIRED',updated_at=now() WHERE sender_request_id=? "
            + "AND status='PENDING' RETURNING id,requested_by_user_id";
    private static final String EXPIRE_OPEN_FOR_JOURNEY = "UPDATE spare_bag_match_requests "
            + "SET status='EXPIRED',updated_at=now() WHERE journey_id=? "
            + "AND status='PENDING' RETURNING id,requested_by_user_id";
    private static final String EXPIRE_STALE = "UPDATE spare_bag_match_requests m "
            + "SET status='EXPIRED',updated_at=now() WHERE m.status='PENDING' AND ("
            + "NOT EXISTS(SELECT 1 FROM spare_bag_sender_requests r WHERE r.id=m.sender_request_id "
            + "AND r.status='PUBLISHED' AND r.deleted_at IS NULL) "
            + "OR NOT EXISTS(SELECT 1 FROM spare_bag_traveller_journeys j WHERE j.id=m.journey_id "
            + "AND j.status='PUBLISHED' AND j.deleted_at IS NULL "
            + "AND COALESCE(j.travel_date_end,j.travel_date)>=CURRENT_DATE)) "
            + "RETURNING m.id,m.requested_by_user_id";
    private static final String HAS_ACCEPTED = "SELECT EXISTS(SELECT 1 FROM "
            + "spare_bag_match_requests WHERE sender_request_id=? AND status='ACCEPTED')";
    private static final String PARTICIPANT_OF_REQUEST = "SELECT EXISTS(SELECT 1 FROM "
            + "spare_bag_match_requests m JOIN spare_bag_traveller_journeys j ON j.id=m.journey_id "
            + "JOIN spare_bag_traveller_profiles p ON p.id=j.traveller_profile_id "
            + "WHERE m.sender_request_id=? AND p.user_id=? AND m.status IN ('PENDING','ACCEPTED','CLOSED'))";
    private static final String PARTICIPANT_OF_JOURNEY = "SELECT EXISTS(SELECT 1 FROM "
            + "spare_bag_match_requests m JOIN spare_bag_sender_requests r ON r.id=m.sender_request_id "
            + "WHERE m.journey_id=? AND r.owner_user_id=? AND m.status IN ('PENDING','ACCEPTED','CLOSED'))";
    private static final String LIST = "SELECT " + COLS + " FROM spare_bag_match_requests m "
            + "JOIN spare_bag_sender_requests r ON r.id=m.sender_request_id "
            + "JOIN spare_bag_traveller_journeys j ON j.id=m.journey_id "
            + "JOIN spare_bag_traveller_profiles p ON p.id=j.traveller_profile_id "
            + "WHERE (r.owner_user_id=? OR p.user_id=?) "
            + "AND ((?='OUTGOING' AND m.requested_by_user_id=?) "
            + "OR (?='INCOMING' AND m.requested_by_user_id<>?)) "
            + "AND (?::text IS NULL OR m.status=?) "
            + "AND (?::timestamptz IS NULL OR (m.created_at,m.id)<(?::timestamptz,?::uuid)) "
            + "ORDER BY m.created_at DESC,m.id DESC LIMIT ?";

    private final JdbcTemplate jdbc;

    public MatchRequestRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<MatchRequest> find(UUID id) {
        return jdbc.query(BY_ID, MatchRequestRepository::row, id).stream().findFirst();
    }

    public Optional<MatchRequest> findForUpdate(UUID id) {
        return jdbc.query(BY_ID + " FOR UPDATE", MatchRequestRepository::row, id).stream()
                .findFirst();
    }

    public Optional<MatchRequest> openPair(UUID senderRequestId, UUID journeyId) {
        return jdbc.query(OPEN_PAIR, MatchRequestRepository::row, senderRequestId, journeyId)
                .stream().findFirst();
    }

    public void insert(UUID id, UUID senderRequestId, UUID journeyId, UUID requester,
            String message) {
        jdbc.update(INSERT, id, senderRequestId, journeyId, requester, message);
    }

    public int respond(UUID id, UUID responder, String status, String note) {
        return jdbc.update(RESPOND, status, responder, note, id);
    }

    public int setStatus(UUID id, String from, String to) {
        return jdbc.update(SET_STATUS, to, id, from);
    }

    public void linkConversation(UUID id, UUID conversationId) {
        jdbc.update(LINK, conversationId, id);
    }

    public List<Touched> expireOtherPending(UUID senderRequestId, UUID exceptId) {
        return jdbc.query(EXPIRE_OTHERS_FOR_REQUEST, MatchRequestRepository::touched,
                senderRequestId, exceptId);
    }

    public List<Touched> expirePendingForRequest(UUID senderRequestId) {
        return jdbc.query(EXPIRE_OPEN_FOR_REQUEST, MatchRequestRepository::touched,
                senderRequestId);
    }

    public List<Touched> expirePendingForJourney(UUID journeyId) {
        return jdbc.query(EXPIRE_OPEN_FOR_JOURNEY, MatchRequestRepository::touched, journeyId);
    }

    /** PENDING matches whose request or journey can no longer be matched. */
    public List<Touched> expireStale() {
        return jdbc.query(EXPIRE_STALE, MatchRequestRepository::touched);
    }

    public boolean hasAccepted(UUID senderRequestId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(HAS_ACCEPTED, Boolean.class,
                senderRequestId));
    }

    /** The user is the traveller side of a live or closed match on this request. */
    public boolean travellerParticipatesInRequest(UUID senderRequestId, UUID userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(PARTICIPANT_OF_REQUEST, Boolean.class,
                senderRequestId, userId));
    }

    /** The user is the sender side of a live or closed match on this journey. */
    public boolean senderParticipatesInJourney(UUID journeyId, UUID userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(PARTICIPANT_OF_JOURNEY, Boolean.class,
                journeyId, userId));
    }

    public List<MatchRequest> list(UUID actor, String direction, String status,
            Instant afterTs, UUID afterId, int limit) {
        return jdbc.query(LIST, MatchRequestRepository::row, actor, actor, direction, actor,
                direction, actor, status, status, SqlSupport.ts(afterTs),
                SqlSupport.ts(afterTs), afterId, limit);
    }

    // =================== idempotency (same table/pattern as legacy contacts) ===================

    public void lock(String key) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
                Object.class, key);
    }

    public Optional<IdempotentResult> idempotent(UUID userId, String operationKey) {
        return jdbc.query("SELECT request_hash,response_body->>'matchRequestId' "
                + "FROM idempotency_keys WHERE user_id=? AND operation_key=? "
                + "AND expires_at>now()", (rs, i) -> new IdempotentResult(rs.getString(1),
                        rs.getString(2) == null ? null : UUID.fromString(rs.getString(2))),
                userId, operationKey).stream().findFirst();
    }

    public void saveIdempotency(UUID userId, String operationKey, String requestHash,
            UUID matchRequestId) {
        jdbc.update("INSERT INTO idempotency_keys(user_id,operation_key,request_hash,"
                + "response_status,response_body,expires_at) VALUES(?,?,?,201,"
                + "jsonb_build_object('matchRequestId',?::text),now()+interval '7 days') "
                + "ON CONFLICT DO NOTHING", userId, operationKey, requestHash,
                matchRequestId.toString());
    }

    public record IdempotentResult(String requestHash, UUID matchRequestId) {
    }

    private static Touched touched(ResultSet rs, int i) throws SQLException {
        return new Touched(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class));
    }

    private static MatchRequest row(ResultSet rs, int i) throws SQLException {
        return new MatchRequest(rs.getObject("id", UUID.class),
                rs.getObject("sender_request_id", UUID.class),
                rs.getObject("journey_id", UUID.class),
                rs.getObject("requested_by_user_id", UUID.class),
                rs.getObject("responded_by_user_id", UUID.class),
                rs.getObject("direct_conversation_id", UUID.class), rs.getString("status"),
                rs.getString("message"), rs.getString("response_note"),
                SqlSupport.ts(rs, "responded_at"), SqlSupport.ts(rs, "created_at"),
                SqlSupport.ts(rs, "updated_at"));
    }
}
