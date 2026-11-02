package com.diasporum.backend.businessdirectory.internal.application;

import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.BusinessView;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.Page;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.ReviewView;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Reviews, ratings, saved businesses, and shared report integration. */
@Service
public class BusinessEngagementService extends DirectorySupport {

    private static final Set<String> REPORT_REASONS = Set.of("SPAM", "SCAM",
            "HARASSMENT", "HATE", "SEXUAL_MISCONDUCT", "MISINFORMATION",
            "IMPERSONATION", "PRIVACY", "OTHER");
    private static final String REVIEW_COLS = "r.id,r.business_id,r.reviewer_user_id,"
            + "r.rating,r.body,r.owner_response,r.owner_responded_at,r.created_at,r.updated_at";

    private final BusinessDirectoryService directory;
    private final IdentityApi identity;

    public BusinessEngagementService(JdbcTemplate jdbc, BusinessDirectoryService directory,
            IdentityApi identity) {
        super(jdbc);
        this.directory = directory;
        this.identity = identity;
    }

    public record RatingSummary(BigDecimal averageRating, int reviewCount) {
    }

    private record ReviewRow(UUID id, UUID businessId, UUID reviewerUserId, int rating,
            String body, String ownerResponse, Instant ownerRespondedAt,
            Instant createdAt, Instant updatedAt) {
    }

    private static ReviewRow review(ResultSet rs, int rowNum) throws SQLException {
        return new ReviewRow(rs.getObject("id", UUID.class),
                rs.getObject("business_id", UUID.class),
                rs.getObject("reviewer_user_id", UUID.class), rs.getInt("rating"),
                rs.getString("body"), rs.getString("owner_response"),
                ts(rs, "owner_responded_at"), ts(rs, "created_at"), ts(rs, "updated_at"));
    }

    // =================== reviews and ratings ===================

    public Page<ReviewView> reviews(UUID viewer, UUID businessId, String cursor, int size) {
        directory.requirePubliclyViewable(viewer, businessId);
        int limit = clamp(size);
        var args = new ArrayList<Object>();
        args.add(businessId);
        String where = " WHERE r.business_id=? AND r.status='PUBLISHED'";
        if (cursor != null) {
            var c = decodeTimeCursor(cursor);
            where += " AND (r.created_at,r.id) < (?,?)";
            args.add(Timestamp.from(c.createdAt()));
            args.add(c.id());
        }
        args.add(limit + 1);
        var rows = new ArrayList<>(jdbc.query("SELECT " + REVIEW_COLS
                + " FROM business_reviews r" + where
                + " ORDER BY r.created_at DESC,r.id DESC LIMIT ?",
                BusinessEngagementService::review, args.toArray()));
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            var last = rows.get(rows.size() - 1);
            next = encodeTimeCursor(last.createdAt(), last.id());
        }
        var profiles = identity.profileSummaries(rows.stream()
                        .map(ReviewRow::reviewerUserId).collect(Collectors.toSet())).stream()
                .collect(Collectors.toMap(ProfileSummary::id, Function.identity(), (a, b) -> a));
        return new Page<>(rows.stream().map(r -> view(r, viewer, profiles)).toList(), next);
    }

    @Transactional
    public ReviewView createReview(UUID reviewer, UUID businessId, int rating, String body) {
        var business = directory.requirePubliclyViewable(reviewer, businessId);
        if (directory.canManage(reviewer, business)) {
            throw forbidden("BUSINESS_MANAGER_CANNOT_REVIEW");
        }
        validateReview(rating, body);
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("INSERT INTO business_reviews(id,business_id,reviewer_user_id,rating,"
                            + "body,status) VALUES(?,?,?,?,?,'PUBLISHED')",
                    id, businessId, reviewer, rating, BusinessDirectoryService.clean(body));
        } catch (DuplicateKeyException e) {
            throw conflict("REVIEW_ALREADY_EXISTS");
        }
        return ownReview(reviewer, businessId, id);
    }

    @Transactional
    public ReviewView updateReview(UUID reviewer, UUID businessId, UUID reviewId,
            int rating, String body) {
        directory.requirePubliclyViewable(reviewer, businessId);
        var current = requireReview(businessId, reviewId);
        if (!reviewer.equals(current.reviewerUserId())) {
            throw forbidden("NOT_REVIEW_OWNER");
        }
        validateReview(rating, body);
        jdbc.update("UPDATE business_reviews SET rating=?,body=?,updated_at=now() WHERE id=?",
                rating, BusinessDirectoryService.clean(body), reviewId);
        return ownReview(reviewer, businessId, reviewId);
    }

    @Transactional
    public void deleteReview(UUID reviewer, UUID businessId, UUID reviewId) {
        var current = requireReview(businessId, reviewId);
        if (!reviewer.equals(current.reviewerUserId())) {
            throw forbidden("NOT_REVIEW_OWNER");
        }
        jdbc.update("DELETE FROM business_reviews WHERE id=?", reviewId);
    }

    @Transactional
    public ReviewView respondToReview(UUID manager, UUID businessId, UUID reviewId,
            String response) {
        directory.requireManaged(manager, businessId);
        requireReview(businessId, reviewId);
        if (response != null && response.length() > 4000) {
            throw bad("REVIEW_RESPONSE_TOO_LONG");
        }
        String cleaned = BusinessDirectoryService.clean(response);
        jdbc.update("UPDATE business_reviews SET owner_response=?,owner_responded_at=?,"
                        + "updated_at=now() WHERE id=?", cleaned,
                cleaned == null ? null : Timestamp.from(Instant.now()), reviewId);
        audit(manager, "BUSINESS_REVIEW_RESPONSE_UPDATED", "BUSINESS_REVIEW", reviewId);
        return ownReview(manager, businessId, reviewId);
    }

    public RatingSummary rating(UUID viewer, UUID businessId) {
        var b = directory.requirePubliclyViewable(viewer, businessId);
        return new RatingSummary(b.averageRating(), b.reviewCount());
    }

    private ReviewView ownReview(UUID viewer, UUID businessId, UUID reviewId) {
        var row = requireReview(businessId, reviewId);
        var profiles = identity.profileSummaries(List.of(row.reviewerUserId())).stream()
                .collect(Collectors.toMap(ProfileSummary::id, Function.identity(), (a, b) -> a));
        return view(row, viewer, profiles);
    }

    private ReviewRow requireReview(UUID businessId, UUID reviewId) {
        return jdbc.query("SELECT " + REVIEW_COLS + " FROM business_reviews r"
                        + " WHERE r.id=? AND r.business_id=? AND r.status='PUBLISHED'",
                BusinessEngagementService::review, reviewId, businessId).stream().findFirst()
                .orElseThrow(() -> notFound("REVIEW_NOT_FOUND"));
    }

    private static ReviewView view(ReviewRow r, UUID viewer,
            Map<UUID, ProfileSummary> profiles) {
        return new ReviewView(r.id(), r.businessId(), r.rating(), r.body(),
                r.ownerResponse(), r.ownerRespondedAt(), r.createdAt(), r.updatedAt(),
                profiles.get(r.reviewerUserId()), viewer.equals(r.reviewerUserId()));
    }

    private static void validateReview(int rating, String body) {
        if (rating < 1 || rating > 5) {
            throw bad("RATING_INVALID");
        }
        if (body != null && body.length() > 4000) {
            throw bad("REVIEW_TOO_LONG");
        }
    }

    // =================== saved businesses ===================

    @Transactional
    public void save(UUID viewer, UUID businessId) {
        directory.requirePubliclyViewable(viewer, businessId);
        jdbc.update("INSERT INTO business_saves(user_id,business_id) VALUES(?,?)"
                + " ON CONFLICT DO NOTHING", viewer, businessId);
    }

    @Transactional
    public void unsave(UUID viewer, UUID businessId) {
        jdbc.update("DELETE FROM business_saves WHERE user_id=? AND business_id=?",
                viewer, businessId);
    }

    public Page<BusinessView> saved(UUID viewer, String cursor, int size) {
        return directory.saved(viewer, cursor, size);
    }

    // =================== shared reports ===================

    @Transactional
    public UUID reportBusiness(UUID reporter, UUID businessId, String reason, String details) {
        var business = directory.requirePubliclyViewable(reporter, businessId);
        return report(reporter, "BUSINESS", businessId, business.countryId(),
                business.communityId(), reason, details);
    }

    @Transactional
    public UUID reportReview(UUID reporter, UUID businessId, UUID reviewId,
            String reason, String details) {
        var business = directory.requirePubliclyViewable(reporter, businessId);
        requireReview(businessId, reviewId);
        return report(reporter, "BUSINESS_REVIEW", reviewId, business.countryId(),
                business.communityId(), reason, details);
    }

    private UUID report(UUID reporter, String targetType, UUID targetId, UUID countryId,
            UUID communityId, String reason, String details) {
        if (reason == null || !REPORT_REASONS.contains(reason)) {
            throw bad("INVALID_REPORT_REASON");
        }
        if (details != null && details.length() > 4000) {
            throw bad("REPORT_DETAILS_TOO_LONG");
        }
        Integer open = jdbc.queryForObject("SELECT count(*) FROM reports"
                        + " WHERE reporter_id=? AND target_type=?::report_target_type"
                        + " AND target_id=? AND status='OPEN'", Integer.class,
                reporter, targetType, targetId);
        if (open != null && open > 0) {
            throw conflict("REPORT_DUPLICATE");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO reports(id,reporter_id,country_id,community_id,target_type,"
                        + "target_id,reason,details) VALUES(?,?,?,?,?::report_target_type,?,?,?)",
                id, reporter, countryId, communityId, targetType, targetId, reason, details);
        return id;
    }
}
