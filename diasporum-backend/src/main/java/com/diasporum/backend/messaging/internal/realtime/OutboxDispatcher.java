package com.diasporum.backend.messaging.internal.realtime;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * Transactional-outbox dispatcher for realtime fan-out.
 *
 * <p>Events were already written to {@code outbox_events} in the same
 * transaction that persisted the message — PostgreSQL stays the source of
 * truth and nothing is lost when Ably is down. Each cycle claims a batch
 * with {@code FOR UPDATE SKIP LOCKED} + a stale-{@code locked_at} reclaim so
 * multiple backend instances cannot process the same row concurrently,
 * publishes one Ably message per authorized recipient channel
 * ({@code user:{userId}} — a personal participant resolves to their own id,
 * a business participant to every currently-active member), then marks the
 * row published. Failures back off linearly via {@code available_at} and are
 * parked after {@code maxAttempts} for ops re-drive (row stays unpublished,
 * never silently dropped).
 */
@Component
public class OutboxDispatcher {

    private static final Logger log =
            LoggerFactory.getLogger(OutboxDispatcher.class);
    private static final Instant PARKED = Instant.parse("9999-01-01T00:00:00Z");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final AblyGateway ably;
    private final BusinessAccountsApi businesses;
    private final OutboxProperties props;
    private final ObjectMapper mapper = new ObjectMapper();

    public OutboxDispatcher(JdbcTemplate jdbc,
            org.springframework.transaction.PlatformTransactionManager txm,
            AblyGateway ably, BusinessAccountsApi businesses,
            OutboxProperties props) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(txm);
        this.ably = ably;
        this.businesses = businesses;
        this.props = props;
    }

    /** Claimed-but-not-yet-published event. */
    public record ClaimedEvent(UUID id, UUID aggregateId, String aggregateType,
                               String eventType, String payloadJson, int attemptCount) {
    }

    /**
     * One dispatch cycle — invoked on a fixed delay by {@link OutboxScheduler}
     * in production, and directly by tests. Skipped entirely when realtime is
     * disabled so queued events simply wait for a usable gateway.
     */
    public void dispatch() {
        if (!ably.isUsable()) {
            return;
        }
        List<ClaimedEvent> batch = claimBatch();
        for (ClaimedEvent e : batch) {
            try {
                publish(e);
            } catch (Exception ex) {
                log.warn("outbox event {} publish failed (attempt {}): {}",
                        e.id(), e.attemptCount() + 1, ex.getMessage());
                markFailed(e, ex.getMessage());
            }
        }
    }

    /**
     * Claims up to {@code batchSize} due events in one transaction —
     * {@code FOR UPDATE SKIP LOCKED} makes concurrent workers take disjoint
     * sets; rows whose {@code locked_at} is older than {@code lockTimeout}
     * are reclaimed (a worker that died mid-batch).
     */
    public List<ClaimedEvent> claimBatch() {
        String sql = "WITH picked AS ("
                + " SELECT id FROM outbox_events"
                + " WHERE destination='ABLY' AND published_at IS NULL"
                + "   AND available_at <= now()"
                + "   AND (locked_at IS NULL OR locked_at < now() - ?::interval)"
                + " ORDER BY created_at LIMIT ?"
                + " FOR UPDATE SKIP LOCKED)"
                + " UPDATE outbox_events o SET locked_at=now()"
                + " FROM picked WHERE o.id=picked.id"
                + " RETURNING o.id,o.aggregate_id,o.aggregate_type,o.event_type,o.payload::text,"
                + "o.attempt_count";
        return tx.execute(status -> jdbc.query(sql,
                (rs, i) -> new ClaimedEvent(
                        rs.getObject("id", UUID.class),
                        rs.getObject("aggregate_id", UUID.class),
                        rs.getString("aggregate_type"),
                        rs.getString("event_type"),
                        rs.getString("payload"),
                        rs.getInt("attempt_count")),
                props.lockTimeout().toString(), props.batchSize()));
    }

    /**
     * Publishes one claimed event to every authorized participant channel
     * and marks it published. Recipients are resolved live at publish time —
     * a member revoked between enqueue and dispatch simply never receives it.
     */
    void publish(ClaimedEvent e) throws Exception {
        Set<UUID> recipients = "USER".equals(e.aggregateType())
                ? Set.of(e.aggregateId()) : recipientsFor(e.aggregateId());
        if (recipients.isEmpty()) {
            // Conversation deleted between enqueue and dispatch — nothing to
            // deliver; mark published so the queue does not stall.
            markPublished(e.id());
            return;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> data = new LinkedHashMap<>(
                mapper.readValue(e.payloadJson(), Map.class));
        data.put("eventId", e.id().toString());
        data.put("type", e.eventType());
        for (UUID userId : recipients) {
            ably.publish("user:" + userId, e.eventType(), data);
        }
        markPublished(e.id());
    }

    /**
     * Participant-side recipients: personal side → that user; business side →
     * all currently active members (live membership, never a stale row).
     */
    Set<UUID> recipientsFor(UUID conversationId) {
        var sides = jdbc.query("SELECT participant_a_id,"
                        + "participant_a_business_account_id,participant_b_id,"
                        + "participant_b_business_account_id"
                        + " FROM direct_conversations WHERE id=?",
                (rs, i) -> new UUID[]{rs.getObject(1, UUID.class),
                        rs.getObject(2, UUID.class),
                        rs.getObject(3, UUID.class),
                        rs.getObject(4, UUID.class)},
                conversationId);
        Set<UUID> out = new HashSet<>();
        for (UUID[] s : sides) {
            for (int k = 0; k < 2; k++) {
                UUID user = s[k * 2];
                UUID biz = s[k * 2 + 1];
                if (biz == null) {
                    if (user != null) {
                        out.add(user);
                    }
                } else {
                    out.addAll(businesses.activeMemberIds(biz));
                }
            }
        }
        return out;
    }

    void markPublished(UUID id) {
        tx.executeWithoutResult(status -> jdbc.update(
                "UPDATE outbox_events SET published_at=now(),"
                        + " locked_at=NULL WHERE id=?", id));
    }

    /** Linear backoff; parks the row after {@code maxAttempts}. */
    void markFailed(ClaimedEvent e, String error) {
        int attempts = e.attemptCount() + 1;
        if (attempts >= props.maxAttempts()) {
            tx.executeWithoutResult(status -> jdbc.update(
                    "UPDATE outbox_events SET attempt_count=?,last_error=?,"
                            + "available_at=?,locked_at=NULL WHERE id=?",
                    attempts, truncate(error), java.sql.Timestamp.from(PARKED),
                    e.id()));
            log.error("outbox event {} parked after {} attempts", e.id(),
                    attempts);
        } else {
            Instant next = Instant.now().plus(
                    props.retryBackoff().multipliedBy(attempts));
            tx.executeWithoutResult(status -> jdbc.update(
                    "UPDATE outbox_events SET attempt_count=?,last_error=?,"
                            + "available_at=?,locked_at=NULL WHERE id=?",
                    attempts, truncate(error),
                    java.sql.Timestamp.from(next), e.id()));
        }
    }

    private static String truncate(String s) {
        return s == null ? null : s.substring(0, Math.min(s.length(), 2000));
    }
}
