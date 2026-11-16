package com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence;

import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Engagement;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Quote;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.QuoteInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.QuoteItem;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.QuoteItemInput;
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

/** Immutable quote revisions and accepted-quote engagement persistence. */
@Repository
public class ServiceQuoteRepository {
    private static final String QUOTE_COLS = "q.id,q.service_request_id,q.service_provider_id,"
            + "p.display_name AS provider_display_name,q.revision_no,q.supersedes_quote_id,"
            + "q.submitted_by_user_id,q.title,q.scope_of_work,q.amount,q.currency_code,"
            + "q.estimated_duration_value,q.estimated_duration_unit,q.valid_until,q.inclusions,"
            + "q.exclusions,q.terms_and_conditions,q.status,q.sent_at,q.responded_at";
    private static final String ENGAGEMENT_COLS = "e.id,e.service_request_id,e.accepted_quote_id,"
            + "e.service_provider_id,p.display_name AS provider_display_name,e.customer_user_id,"
            + "e.status,e.accepted_at,e.started_at,e.completion_submitted_at,e.completed_at,"
            + "e.cancelled_at,e.issue_raised_at,e.issue_reason,e.customer_completion_note,"
            + "e.provider_completion_note,e.created_at,e.updated_at";

    private final JdbcTemplate jdbc;

    public ServiceQuoteRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Quote insertQuote(UUID id, UUID requestId, UUID actorUserId, QuoteInput in, int revision) {
        jdbc.update("INSERT INTO service_quotes(id,service_request_id,service_provider_id,"
                + "revision_no,supersedes_quote_id,submitted_by_user_id,title,scope_of_work,amount,"
                + "currency_code,estimated_duration_value,estimated_duration_unit,valid_until,"
                + "inclusions,exclusions,terms_and_conditions) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                id, requestId, in.serviceProviderId(), revision, in.supersedesQuoteId(), actorUserId,
                in.title().trim(), in.scopeOfWork().trim(), in.amount(), in.currencyCode().toUpperCase(),
                in.estimatedDurationValue(), in.estimatedDurationUnit(),
                in.validUntil() == null ? null : Timestamp.from(in.validUntil()), trim(in.inclusions()),
                trim(in.exclusions()), trim(in.termsAndConditions()));
        int line = 1;
        for (QuoteItemInput item : in.items()) {
            jdbc.update("INSERT INTO service_quote_items(id,quote_id,line_no,description,quantity,"
                    + "unit_label,unit_amount,line_amount) VALUES(?,?,?,?,?,?,?,?)", UUID.randomUUID(), id,
                    line++, item.description().trim(), item.quantity(), trim(item.unitLabel()),
                    item.unitAmount(), item.quantity().multiply(item.unitAmount()));
        }
        return findQuote(id).orElseThrow();
    }

    public Optional<Quote> findQuote(UUID id) {
        return jdbc.query("SELECT " + QUOTE_COLS + " FROM service_quotes q "
                + "JOIN service_providers p ON p.id=q.service_provider_id WHERE q.id=?",
                ServiceQuoteRepository::quote, id).stream().findFirst().map(this::withItems);
    }

    public List<Quote> quotesForRequest(UUID requestId) {
        List<Quote> quotes = jdbc.query("SELECT " + QUOTE_COLS + " FROM service_quotes q "
                + "JOIN service_providers p ON p.id=q.service_provider_id WHERE q.service_request_id=? "
                + "ORDER BY q.sent_at DESC,q.id DESC", ServiceQuoteRepository::quote, requestId);
        Map<UUID, List<QuoteItem>> items = itemsFor(quotes.stream().map(Quote::id).toList());
        return quotes.stream().map(q -> q.withItems(items.getOrDefault(q.id(), List.of()))).toList();
    }

    public boolean transitionQuote(UUID id, String expected, String target) {
        return jdbc.update("UPDATE service_quotes SET status=?,responded_at=now() "
                + "WHERE id=? AND status=?", target, id, expected) == 1;
    }

    public Engagement insertEngagement(UUID id, Quote quote, UUID customerUserId) {
        jdbc.update("INSERT INTO service_engagements(id,service_request_id,accepted_quote_id,"
                + "service_provider_id,customer_user_id) VALUES(?,?,?,?,?)", id,
                quote.serviceRequestId(), quote.id(), quote.serviceProviderId(), customerUserId);
        return findEngagement(id).orElseThrow();
    }

    public Optional<Engagement> findEngagement(UUID id) {
        return jdbc.query("SELECT " + ENGAGEMENT_COLS + " FROM service_engagements e "
                + "JOIN service_providers p ON p.id=e.service_provider_id WHERE e.id=?",
                ServiceQuoteRepository::engagement, id).stream().findFirst();
    }

    public Optional<Engagement> findEngagementForUpdate(UUID id) {
        return jdbc.query("SELECT " + ENGAGEMENT_COLS + " FROM service_engagements e "
                + "JOIN service_providers p ON p.id=e.service_provider_id WHERE e.id=? FOR UPDATE OF e",
                ServiceQuoteRepository::engagement, id).stream().findFirst();
    }

    public Optional<Engagement> engagementForRequest(UUID requestId) {
        return jdbc.query("SELECT " + ENGAGEMENT_COLS + " FROM service_engagements e "
                + "JOIN service_providers p ON p.id=e.service_provider_id WHERE e.service_request_id=?",
                ServiceQuoteRepository::engagement, requestId).stream().findFirst();
    }

    public boolean transitionEngagement(UUID id, String expected, String target,
            String note, String reason) {
        return jdbc.update("UPDATE service_engagements SET status=?,"
                + "provider_completion_note=CASE WHEN ?='COMPLETION_SUBMITTED' THEN ? ELSE provider_completion_note END,"
                + "customer_completion_note=CASE WHEN ?='COMPLETED' THEN ? ELSE customer_completion_note END,"
                + "issue_reason=CASE WHEN ?='ISSUE_RAISED' THEN ? ELSE issue_reason END,"
                + "updated_at=now() WHERE id=? AND status=?", target, target, trim(note), target,
                trim(note), target, trim(reason), id, expected) == 1;
    }

    public void recordEngagementActor(UUID engagementId, UUID actorUserId, String reason) {
        jdbc.update("UPDATE service_engagement_status_history SET actor_user_id=?,reason=? "
                + "WHERE id=(SELECT id FROM service_engagement_status_history WHERE engagement_id=? "
                + "ORDER BY created_at DESC,id DESC LIMIT 1)", actorUserId, trim(reason), engagementId);
    }

    public boolean completedEngagementExists(UUID requestId, UUID providerId, UUID customerUserId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM service_engagements "
                + "WHERE service_request_id=? AND service_provider_id=? AND customer_user_id=? "
                + "AND status='COMPLETED')", Boolean.class, requestId, providerId, customerUserId));
    }

    private Quote withItems(Quote quote) {
        return quote.withItems(itemsFor(List.of(quote.id())).getOrDefault(quote.id(), List.of()));
    }

    private Map<UUID, List<QuoteItem>> itemsFor(Collection<UUID> quoteIds) {
        if (quoteIds.isEmpty()) {
            return Map.of();
        }
        String placeholders = String.join(",", java.util.Collections.nCopies(quoteIds.size(), "?"));
        Map<UUID, List<QuoteItem>> result = new HashMap<>();
        jdbc.query("SELECT id,quote_id,line_no,description,quantity,unit_label,unit_amount,line_amount "
                + "FROM service_quote_items WHERE quote_id IN(" + placeholders + ") ORDER BY quote_id,line_no",
                rs -> {
                    UUID quoteId = rs.getObject("quote_id", UUID.class);
                    result.computeIfAbsent(quoteId, ignored -> new ArrayList<>()).add(new QuoteItem(
                            rs.getObject("id", UUID.class), rs.getInt("line_no"),
                            rs.getString("description"), rs.getBigDecimal("quantity"),
                            rs.getString("unit_label"), rs.getBigDecimal("unit_amount"),
                            rs.getBigDecimal("line_amount")));
                }, quoteIds.toArray());
        return result;
    }

    private static Quote quote(ResultSet rs, int row) throws SQLException {
        return new Quote(rs.getObject("id", UUID.class), rs.getObject("service_request_id", UUID.class),
                rs.getObject("service_provider_id", UUID.class), rs.getString("provider_display_name"),
                rs.getInt("revision_no"), rs.getObject("supersedes_quote_id", UUID.class),
                rs.getObject("submitted_by_user_id", UUID.class), rs.getString("title"),
                rs.getString("scope_of_work"), rs.getBigDecimal("amount"), rs.getString("currency_code"),
                rs.getObject("estimated_duration_value", Integer.class),
                rs.getString("estimated_duration_unit"), instant(rs, "valid_until"),
                rs.getString("inclusions"), rs.getString("exclusions"),
                rs.getString("terms_and_conditions"), rs.getString("status"),
                instant(rs, "sent_at"), instant(rs, "responded_at"), List.of());
    }

    private static Engagement engagement(ResultSet rs, int row) throws SQLException {
        return new Engagement(rs.getObject("id", UUID.class), rs.getObject("service_request_id", UUID.class),
                rs.getObject("accepted_quote_id", UUID.class), rs.getObject("service_provider_id", UUID.class),
                rs.getString("provider_display_name"), rs.getObject("customer_user_id", UUID.class),
                rs.getString("status"), instant(rs, "accepted_at"), instant(rs, "started_at"),
                instant(rs, "completion_submitted_at"), instant(rs, "completed_at"),
                instant(rs, "cancelled_at"), instant(rs, "issue_raised_at"), rs.getString("issue_reason"),
                rs.getString("customer_completion_note"), rs.getString("provider_completion_note"),
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static String trim(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
