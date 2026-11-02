package com.diasporum.backend.sparebag.internal.infrastructure.persistence;

import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ContactInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ContactRequest;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Contact-request, idempotency and messaging-link persistence. */
@Repository
public class SpareBagContactRepository {

    private static final String COLS = "id,sender_listing_id,passenger_listing_id,"
            + "requested_by_user_id,responded_by_user_id,direct_conversation_id,"
            + "status::text,parcel_weight_kg,proposed_price_amount,proposed_price_unit::text,"
            + "price_currency,message,response_note,created_at,updated_at,responded_at,expires_at";

    private final JdbcTemplate jdbc;

    public SpareBagContactRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public ContactRequest insert(UUID id, UUID senderListingId,
            UUID passengerListingId, UUID requesterId, ContactInput in) {
        jdbc.update("INSERT INTO spare_bag_contact_requests(id,sender_listing_id,"
                + "passenger_listing_id,requested_by_user_id,parcel_weight_kg,"
                + "proposed_price_amount,proposed_price_unit,price_currency,message) "
                + "VALUES(?,?,?,?,?,?,?::spare_bag_price_unit,?,?)", id,
                senderListingId, passengerListingId, requesterId, in.parcelWeightKg(),
                in.proposedPriceAmount(), in.proposedPriceUnit(), in.priceCurrency(),
                in.message());
        return find(id).orElseThrow();
    }

    public Optional<ContactRequest> find(UUID id) {
        return jdbc.query("SELECT " + COLS + " FROM spare_bag_contact_requests WHERE id=?",
                SpareBagContactRepository::contact, id).stream().findFirst();
    }

    public Optional<ContactRequest> findForUpdate(UUID id) {
        return jdbc.query("SELECT " + COLS + " FROM spare_bag_contact_requests "
                + "WHERE id=? FOR UPDATE", SpareBagContactRepository::contact, id)
                .stream().findFirst();
    }

    public Optional<ContactRequest> pendingPair(UUID senderListingId,
            UUID passengerListingId) {
        return jdbc.query("SELECT " + COLS + " FROM spare_bag_contact_requests "
                + "WHERE sender_listing_id=? AND passenger_listing_id=? AND status='PENDING'",
                SpareBagContactRepository::contact, senderListingId, passengerListingId)
                .stream().findFirst();
    }

    public List<ContactRequest> forUser(UUID userId, String direction,
            Instant cursorTs, UUID cursorId, int limit) {
        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder("SELECT cr.")
                .append(COLS.replace(",", ",cr."))
                .append(" FROM spare_bag_contact_requests cr ")
                .append("JOIN spare_bag_listings sl ON sl.id=cr.sender_listing_id ")
                .append("JOIN spare_bag_listings pl ON pl.id=cr.passenger_listing_id ")
                .append("WHERE (cr.requested_by_user_id=? OR sl.owner_user_id=? ")
                .append("OR pl.owner_user_id=?) ");
        args.add(userId);
        args.add(userId);
        args.add(userId);
        if ("OUTGOING".equals(direction)) {
            sql.append("AND cr.requested_by_user_id=? ");
            args.add(userId);
        } else if ("INCOMING".equals(direction)) {
            sql.append("AND cr.requested_by_user_id<>? ")
                    .append("AND (sl.owner_user_id=? OR pl.owner_user_id=?) ");
            args.add(userId);
            args.add(userId);
            args.add(userId);
        }
        if (cursorTs != null) {
            sql.append("AND (cr.created_at,cr.id)<(?,?) ");
            args.add(cursorTs);
            args.add(cursorId);
        }
        sql.append("ORDER BY cr.created_at DESC,cr.id DESC LIMIT ?");
        args.add(limit);
        return jdbc.query(sql.toString(), SpareBagContactRepository::contact, args.toArray());
    }

    public void respond(UUID id, UUID responderId, String status, String note) {
        jdbc.update("UPDATE spare_bag_contact_requests SET status=?::spare_bag_contact_status,"
                + "responded_by_user_id=?,responded_at=now(),response_note=?,updated_at=now() "
                + "WHERE id=?", status, responderId, note, id);
    }

    public void setStatus(UUID id, String status) {
        jdbc.update("UPDATE spare_bag_contact_requests SET status=?::spare_bag_contact_status,"
                + "updated_at=now() WHERE id=?", status, id);
    }

    public void linkConversation(UUID id, UUID conversationId) {
        jdbc.update("UPDATE spare_bag_contact_requests SET direct_conversation_id=?,"
                + "updated_at=now() WHERE id=?", conversationId, id);
    }

    public boolean acceptedParticipant(UUID listingId, UUID userId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS("
                + "SELECT 1 FROM spare_bag_contact_requests cr "
                + "JOIN spare_bag_listings sl ON sl.id=cr.sender_listing_id "
                + "JOIN spare_bag_listings pl ON pl.id=cr.passenger_listing_id "
                + "WHERE cr.status='ACCEPTED' AND (sl.id=? OR pl.id=?) "
                + "AND (sl.owner_user_id=? OR pl.owner_user_id=?))", Boolean.class,
                listingId, listingId, userId, userId));
    }

    public java.util.Set<UUID> acceptedListingsForViewer(UUID userId,
            java.util.Collection<UUID> listingIds) {
        if (listingIds.isEmpty()) return java.util.Set.of();
        String placeholders = String.join(",",
                java.util.Collections.nCopies(listingIds.size(), "?"));
        List<Object> args = new ArrayList<>();
        args.add(userId);
        args.add(userId);
        args.addAll(listingIds);
        return java.util.Set.copyOf(jdbc.queryForList("SELECT DISTINCT cr.sender_listing_id "
                + "FROM spare_bag_contact_requests cr "
                + "JOIN spare_bag_listings sl ON sl.id=cr.sender_listing_id "
                + "JOIN spare_bag_listings pl ON pl.id=cr.passenger_listing_id "
                + "WHERE cr.status='ACCEPTED' AND (sl.owner_user_id=? OR pl.owner_user_id=?) "
                + "AND cr.sender_listing_id IN (" + placeholders + ") "
                + "UNION SELECT DISTINCT cr.passenger_listing_id "
                + "FROM spare_bag_contact_requests cr "
                + "JOIN spare_bag_listings sl ON sl.id=cr.sender_listing_id "
                + "JOIN spare_bag_listings pl ON pl.id=cr.passenger_listing_id "
                + "WHERE cr.status='ACCEPTED' AND (sl.owner_user_id=? OR pl.owner_user_id=?) "
                + "AND cr.passenger_listing_id IN (" + placeholders + ")",
                UUID.class, withRepeatedViewer(userId, listingIds)));
    }

    private static Object[] withRepeatedViewer(UUID userId,
            java.util.Collection<UUID> listingIds) {
        List<Object> args = new ArrayList<>();
        args.add(userId);
        args.add(userId);
        args.addAll(listingIds);
        args.add(userId);
        args.add(userId);
        args.addAll(listingIds);
        return args.toArray();
    }

    public void lock(String key) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
                Object.class, key);
    }

    public Optional<IdempotentResult> idempotent(UUID userId, String operationKey) {
        return jdbc.query("SELECT request_hash,response_body->>'contactRequestId' "
                + "FROM idempotency_keys WHERE user_id=? AND operation_key=? "
                + "AND expires_at>now()", (rs, i) -> new IdempotentResult(
                        rs.getString(1), UUID.fromString(rs.getString(2))), userId, operationKey)
                .stream().findFirst();
    }

    public void saveIdempotency(UUID userId, String operationKey, String requestHash,
            UUID contactRequestId) {
        jdbc.update("INSERT INTO idempotency_keys(user_id,operation_key,request_hash,"
                + "response_status,response_body,expires_at) VALUES(?,?,?,201,"
                + "jsonb_build_object('contactRequestId',?::text),now()+interval '7 days')",
                userId, operationKey, requestHash, contactRequestId.toString());
    }

    public int expirePending() {
        return jdbc.update("UPDATE spare_bag_contact_requests cr SET status='EXPIRED',"
                + "updated_at=now() WHERE cr.status='PENDING' AND (cr.expires_at<=now() "
                + "OR EXISTS(SELECT 1 FROM spare_bag_listings sl "
                + "JOIN spare_bag_listings pl ON pl.id=cr.passenger_listing_id "
                + "WHERE sl.id=cr.sender_listing_id AND (sl.status<>'PUBLISHED' "
                + "OR pl.status<>'PUBLISHED' "
                + "OR COALESCE(sl.travel_date_end,sl.travel_date_start)<CURRENT_DATE "
                + "OR COALESCE(pl.travel_date_end,pl.travel_date_start)<CURRENT_DATE "
                + "OR (sl.closes_at IS NOT NULL AND sl.closes_at<=now()) "
                + "OR (pl.closes_at IS NOT NULL AND pl.closes_at<=now()))))");
    }

    public record IdempotentResult(String requestHash, UUID contactRequestId) {
    }

    private static ContactRequest contact(ResultSet rs, int i) throws SQLException {
        return new ContactRequest(rs.getObject("id", UUID.class),
                rs.getObject("sender_listing_id", UUID.class),
                rs.getObject("passenger_listing_id", UUID.class),
                rs.getObject("requested_by_user_id", UUID.class),
                rs.getObject("responded_by_user_id", UUID.class),
                rs.getObject("direct_conversation_id", UUID.class), rs.getString("status"),
                rs.getBigDecimal("parcel_weight_kg"),
                rs.getBigDecimal("proposed_price_amount"),
                rs.getString("proposed_price_unit"), rs.getString("price_currency"),
                rs.getString("message"), rs.getString("response_note"),
                ts(rs, "created_at"), ts(rs, "updated_at"), ts(rs, "responded_at"),
                ts(rs, "expires_at"));
    }

    private static Instant ts(ResultSet rs, String column) throws SQLException {
        var value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }
}
