package com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence;

import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ContactAddress;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Cursor;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.LeadAccess;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderResponse;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Report;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ReportInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ResponseInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Review;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ReviewInput;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Persistence for responses, paid lead grants, reviews, reports and moderation. */
@Repository
public class ServiceEngagementRepository {
    private static final String RESPONSE_COLS = "r.id,r.service_request_id,r.service_provider_id,"
            + "p.display_name AS provider_display_name,r.responded_by_user_id,r.response_type,"
            + "r.message,r.quoted_amount,r.currency_code,r.status,r.created_at,r.updated_at";
    private static final String LEAD_COLS = "l.id,l.service_request_id,l.service_provider_id,"
            + "l.chat_enabled,l.contact_details_unlocked,l.status,l.granted_by_user_id,l.accessed_at";
    private static final String REVIEW_COLS = "v.id,v.service_request_id,v.service_provider_id,"
            + "v.reviewer_user_id,v.rating,v.review_text,v.status,v.provider_response,"
            + "v.created_at,v.updated_at";
    private static final String REPORT_COLS = "r.id,r.reporter_user_id,r.target_type,r.target_id,"
            + "r.reason_code,r.description,r.status,r.created_at,r.resolved_at,r.resolution_note";

    private final JdbcTemplate jdbc;

    public ServiceEngagementRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public ProviderResponse insertResponse(UUID id, UUID requestId, UUID respondedBy,
            ResponseInput in) {
        jdbc.update("INSERT INTO service_request_responses(id,service_request_id,service_provider_id,"
                + "responded_by_user_id,response_type,message,quoted_amount,currency_code) "
                + "VALUES(?,?,?,?,?,?,?,?)", id, requestId, in.serviceProviderId(), respondedBy,
                in.responseType(), in.message().trim(), in.quotedAmount(), in.currencyCode());
        return findResponse(id).orElseThrow();
    }

    public ProviderResponse updateResponse(UUID id, ResponseInput in) {
        jdbc.update("UPDATE service_request_responses SET response_type=?,message=?,quoted_amount=?,"
                + "currency_code=?,status='SENT',updated_at=now() WHERE id=?", in.responseType(),
                in.message().trim(), in.quotedAmount(), in.currencyCode(), id);
        return findResponse(id).orElseThrow();
    }

    public boolean transitionResponse(UUID id, String expectedStatus, String nextStatus) {
        return jdbc.update("UPDATE service_request_responses SET status=?,updated_at=now() "
                + "WHERE id=? AND status=?", nextStatus, id, expectedStatus) == 1;
    }

    public Optional<ProviderResponse> findResponse(UUID id) {
        return jdbc.query("SELECT " + RESPONSE_COLS + " FROM service_request_responses r "
                + "JOIN service_providers p ON p.id=r.service_provider_id WHERE r.id=?",
                ServiceEngagementRepository::response, id).stream().findFirst();
    }

    public Optional<ProviderResponse> findResponse(UUID requestId, UUID providerId) {
        return jdbc.query("SELECT " + RESPONSE_COLS + " FROM service_request_responses r "
                + "JOIN service_providers p ON p.id=r.service_provider_id "
                + "WHERE r.service_request_id=? AND r.service_provider_id=?",
                ServiceEngagementRepository::response, requestId, providerId).stream().findFirst();
    }

    public List<ProviderResponse> responsesForRequest(UUID requestId, Cursor cursor, int limit) {
        StringBuilder sql = new StringBuilder("SELECT " + RESPONSE_COLS
                + " FROM service_request_responses r JOIN service_providers p "
                + "ON p.id=r.service_provider_id WHERE r.service_request_id=?");
        List<Object> args = new ArrayList<>();
        args.add(requestId);
        if (cursor != null) {
            sql.append(" AND (r.created_at,r.id)<(?,?)");
            args.add(Timestamp.from(Instant.parse(cursor.primary())));
            args.add(cursor.id());
        }
        sql.append(" ORDER BY r.created_at DESC,r.id DESC LIMIT ?");
        args.add(limit + 1);
        return jdbc.query(sql.toString(), ServiceEngagementRepository::response, args.toArray());
    }

    public List<ProviderResponse> responsesForProviders(List<UUID> providerIds, Cursor cursor, int limit) {
        if (providerIds.isEmpty()) {
            return List.of();
        }
        StringBuilder sql = new StringBuilder("SELECT " + RESPONSE_COLS
                + " FROM service_request_responses r JOIN service_providers p "
                + "ON p.id=r.service_provider_id WHERE r.service_provider_id IN ("
                + placeholders(providerIds.size()) + ")");
        List<Object> args = new ArrayList<>(providerIds);
        if (cursor != null) {
            sql.append(" AND (r.created_at,r.id)<(?,?)");
            args.add(Timestamp.from(Instant.parse(cursor.primary())));
            args.add(cursor.id());
        }
        sql.append(" ORDER BY r.created_at DESC,r.id DESC LIMIT ?");
        args.add(limit + 1);
        return jdbc.query(sql.toString(), ServiceEngagementRepository::response, args.toArray());
    }

    public Optional<LeadAccess> findLead(UUID id) {
        return jdbc.query("SELECT " + LEAD_COLS + " FROM service_lead_access l WHERE l.id=?",
                ServiceEngagementRepository::lead, id).stream().findFirst();
    }

    public Optional<LeadAccess> findLead(UUID requestId, UUID providerId) {
        return jdbc.query("SELECT " + LEAD_COLS + " FROM service_lead_access l "
                + "WHERE l.service_request_id=? AND l.service_provider_id=?",
                ServiceEngagementRepository::lead, requestId, providerId).stream().findFirst();
    }

    public Optional<LeadAccess> findLeadForUpdate(UUID requestId, UUID providerId) {
        return jdbc.query("SELECT " + LEAD_COLS + " FROM service_lead_access l "
                + "WHERE l.service_request_id=? AND l.service_provider_id=? FOR UPDATE OF l",
                ServiceEngagementRepository::lead, requestId, providerId).stream().findFirst();
    }

    public LeadAccess insertLead(UUID id, UUID requestId, UUID providerId, UUID grantedBy,
            UUID usageRecordId, boolean chat, boolean contact) {
        jdbc.update("INSERT INTO service_lead_access(id,service_request_id,service_provider_id,"
                + "granted_by_user_id,billing_usage_record_id,chat_enabled,contact_details_unlocked) "
                + "VALUES(?,?,?,?,?,?,?)", id, requestId, providerId, grantedBy, usageRecordId, chat, contact);
        return findLead(id).orElseThrow();
    }

    public LeadAccess upgradeLead(UUID id, boolean chat, boolean contact) {
        jdbc.update("UPDATE service_lead_access SET chat_enabled=chat_enabled OR ?,"
                + "contact_details_unlocked=contact_details_unlocked OR ? WHERE id=?", chat, contact, id);
        return findLead(id).orElseThrow();
    }

    public Optional<LeadAccess> activeLead(UUID requestId, UUID providerId) {
        return jdbc.query("SELECT " + LEAD_COLS + " FROM service_lead_access l "
                + "WHERE l.service_request_id=? AND l.service_provider_id=? AND l.status='ACTIVE' "
                + "AND l.chat_enabled=true", ServiceEngagementRepository::lead, requestId, providerId)
                .stream().findFirst();
    }

    public Optional<ContactAddress> requestAddress(UUID requestId) {
        return jdbc.query("SELECT a.id,a.address_line_1,a.address_line_2,a.city,a.region,a.postal_code,"
                + "a.formatted_address,ST_Y(a.location::geometry) AS latitude,"
                + "ST_X(a.location::geometry) AS longitude FROM service_requests sr "
                + "JOIN addresses a ON a.id=sr.address_id WHERE sr.id=?", 
                (rs, row) -> new ContactAddress(rs.getObject("id", UUID.class),
                        rs.getString("address_line_1"), rs.getString("address_line_2"),
                        rs.getString("city"), rs.getString("region"), rs.getString("postal_code"),
                        rs.getString("formatted_address"), rs.getObject("latitude", Double.class),
                        rs.getObject("longitude", Double.class)), requestId).stream().findFirst();
    }

    public Review insertReview(UUID id, UUID requestId, UUID reviewerId, ReviewInput in) {
        jdbc.update("INSERT INTO service_reviews(id,service_request_id,service_provider_id,"
                + "reviewer_user_id,rating,review_text) VALUES(?,?,?,?,?,?)", id, requestId,
                in.serviceProviderId(), reviewerId, in.rating(), trim(in.reviewText()));
        return findReview(id).orElseThrow();
    }

    public Review updateReview(UUID id, ReviewInput in) {
        jdbc.update("UPDATE service_reviews SET rating=?,review_text=?,status='PUBLISHED',"
                + "provider_response=NULL,updated_at=now() WHERE id=?", in.rating(),
                trim(in.reviewText()), id);
        return findReview(id).orElseThrow();
    }

    public Optional<Review> findReview(UUID id) {
        return jdbc.query("SELECT " + REVIEW_COLS + " FROM service_reviews v WHERE v.id=?",
                ServiceEngagementRepository::review, id).stream().findFirst();
    }

    public List<Review> reviews(UUID requestId, UUID providerId, UUID reviewerId,
            boolean publishedOnly, Cursor cursor, int limit) {
        StringBuilder sql = new StringBuilder("SELECT " + REVIEW_COLS + " FROM service_reviews v WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (requestId != null) {
            sql.append(" AND v.service_request_id=?");
            args.add(requestId);
        }
        if (providerId != null) {
            sql.append(" AND v.service_provider_id=?");
            args.add(providerId);
        }
        if (reviewerId != null) {
            sql.append(" AND v.reviewer_user_id=?");
            args.add(reviewerId);
        }
        if (publishedOnly) {
            sql.append(" AND v.status='PUBLISHED'");
        }
        if (cursor != null) {
            sql.append(" AND (v.created_at,v.id)<(?,?)");
            args.add(Timestamp.from(Instant.parse(cursor.primary())));
            args.add(cursor.id());
        }
        sql.append(" ORDER BY v.created_at DESC,v.id DESC LIMIT ?");
        args.add(limit + 1);
        return jdbc.query(sql.toString(), ServiceEngagementRepository::review, args.toArray());
    }

    public void providerReviewResponse(UUID id, UUID actorUserId, String response) {
        jdbc.update("UPDATE service_reviews SET provider_response=?,provider_response_by_user_id=?,"
                + "provider_responded_at=now(),updated_at=now() WHERE id=?",
                response.trim(), actorUserId, id);
    }

    public Report insertReport(UUID id, UUID reporterId, ReportInput in) {
        jdbc.update("INSERT INTO service_reports(id,reporter_user_id,target_type,target_id,"
                + "reason_code,description) VALUES(?,?,?,?,?,?)", id, reporterId, in.targetType(),
                in.targetId(), in.reasonCode().trim(), in.description().trim());
        return findReport(id).orElseThrow();
    }

    public Optional<Report> findReport(UUID id) {
        return jdbc.query("SELECT " + REPORT_COLS + " FROM service_reports r WHERE r.id=?",
                ServiceEngagementRepository::report, id).stream().findFirst();
    }

    public boolean duplicateOpenReport(UUID reporterId, ReportInput in) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM service_reports "
                + "WHERE reporter_user_id=? AND target_type=? AND target_id=? AND status='OPEN')",
                Boolean.class, reporterId, in.targetType(), in.targetId()));
    }

    public int recentReportCount(UUID reporterId) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM service_reports "
                + "WHERE reporter_user_id=? AND created_at>now()-interval '1 hour'", Integer.class, reporterId);
        return count == null ? 0 : count;
    }

    public List<Report> reports(String status, String targetType, UUID countryId,
            Cursor cursor, int limit) {
        StringBuilder sql = new StringBuilder("SELECT " + REPORT_COLS + " FROM service_reports r ");
        List<Object> args = new ArrayList<>();
        if (countryId != null) {
            sql.append("LEFT JOIN service_requests sr ON r.target_type='SERVICE_REQUEST' "
                    + "AND sr.id=r.target_id LEFT JOIN service_reviews rv ON r.target_type='SERVICE_REVIEW' "
                    + "AND rv.id=r.target_id LEFT JOIN service_requests rvr ON rvr.id=rv.service_request_id ");
        }
        sql.append("WHERE 1=1");
        if (status != null) {
            sql.append(" AND r.status=?::report_status");
            args.add(status);
        }
        if (targetType != null) {
            sql.append(" AND r.target_type=?");
            args.add(targetType);
        }
        if (countryId != null) {
            sql.append(" AND COALESCE(sr.country_id,rvr.country_id)=? AND r.target_type<>'SERVICE_PROVIDER'");
            args.add(countryId);
        }
        if (cursor != null) {
            sql.append(" AND (r.created_at,r.id)<(?,?)");
            args.add(Timestamp.from(Instant.parse(cursor.primary())));
            args.add(cursor.id());
        }
        sql.append(" ORDER BY r.created_at DESC,r.id DESC LIMIT ?");
        args.add(limit + 1);
        return jdbc.query(sql.toString(), ServiceEngagementRepository::report, args.toArray());
    }

    public void resolveReport(UUID id, String status, UUID moderatorId, String note) {
        jdbc.update("UPDATE service_reports SET status=?::report_status,resolved_by=?,resolved_at=now(),"
                + "resolution_note=? WHERE id=?", status, moderatorId, trim(note), id);
    }

    public void moderationAction(UUID id, UUID moderatorId, String targetType, UUID targetId,
            String action, String reason) {
        jdbc.update("INSERT INTO service_moderation_actions(id,actor_user_id,target_type,target_id,"
                + "action_key,reason) VALUES(?,?,?,?,?,?)", id, moderatorId, targetType, targetId,
                action, trim(reason));
    }

    public void moderateTarget(String targetType, UUID targetId, String action) {
        if ("SERVICE_REQUEST".equals(targetType) && List.of("HIDE", "REMOVE").contains(action)) {
            jdbc.update("UPDATE service_requests SET status='REMOVED',updated_at=now() WHERE id=?", targetId);
        } else if ("SERVICE_REQUEST".equals(targetType) && "RESTORE".equals(action)) {
            jdbc.update("UPDATE service_requests SET status='PAUSED',updated_at=now() WHERE id=?", targetId);
        } else if ("SERVICE_PROVIDER".equals(targetType) && "SUSPEND_PROVIDER".equals(action)) {
            jdbc.update("UPDATE service_providers SET status='SUSPENDED',updated_at=now() WHERE id=?", targetId);
        } else if ("SERVICE_PROVIDER".equals(targetType) && "RESTORE".equals(action)) {
            jdbc.update("UPDATE service_providers SET status='ACTIVE',updated_at=now() WHERE id=?", targetId);
        } else if ("SERVICE_REVIEW".equals(targetType)) {
            String status = switch (action) {
                case "HIDE" -> "HIDDEN";
                case "REMOVE" -> "REJECTED";
                case "RESTORE" -> "PUBLISHED";
                default -> null;
            };
            if (status != null) {
                jdbc.update("UPDATE service_reviews SET status=?,updated_at=now() WHERE id=?", status, targetId);
            }
        }
    }

    private static ProviderResponse response(ResultSet rs, int row) throws SQLException {
        return new ProviderResponse(rs.getObject("id", UUID.class),
                rs.getObject("service_request_id", UUID.class),
                rs.getObject("service_provider_id", UUID.class), rs.getString("provider_display_name"),
                rs.getObject("responded_by_user_id", UUID.class), rs.getString("response_type"),
                rs.getString("message"), rs.getBigDecimal("quoted_amount"),
                rs.getString("currency_code"), rs.getString("status"),
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private static LeadAccess lead(ResultSet rs, int row) throws SQLException {
        return new LeadAccess(rs.getObject("id", UUID.class),
                rs.getObject("service_request_id", UUID.class),
                rs.getObject("service_provider_id", UUID.class), rs.getBoolean("chat_enabled"),
                rs.getBoolean("contact_details_unlocked"), rs.getString("status"),
                rs.getObject("granted_by_user_id", UUID.class), instant(rs, "accessed_at"), null);
    }

    private static Review review(ResultSet rs, int row) throws SQLException {
        return new Review(rs.getObject("id", UUID.class),
                rs.getObject("service_request_id", UUID.class),
                rs.getObject("service_provider_id", UUID.class),
                rs.getObject("reviewer_user_id", UUID.class), null, rs.getInt("rating"),
                rs.getString("review_text"), rs.getString("status"), rs.getString("provider_response"),
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private static Report report(ResultSet rs, int row) throws SQLException {
        return new Report(rs.getObject("id", UUID.class), rs.getObject("reporter_user_id", UUID.class),
                rs.getString("target_type"), rs.getObject("target_id", UUID.class),
                rs.getString("reason_code"), rs.getString("description"), rs.getString("status"),
                instant(rs, "created_at"), instant(rs, "resolved_at"), rs.getString("resolution_note"));
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
