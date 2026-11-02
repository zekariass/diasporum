package com.diasporum.backend.businessdirectory.internal.application;

import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.CategoryView;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Verification workflow and small category-administration surface for platform staff. */
@Service
public class BusinessDirectoryAdminService extends DirectorySupport {

    private static final Pattern SLUG = Pattern.compile("[a-z0-9]+(?:-[a-z0-9]+)*");
    private static final Set<String> STAFF_STATUSES = Set.of(
            "VERIFIED", "REJECTED", "REVOKED");

    private final BusinessDirectoryService directory;

    public BusinessDirectoryAdminService(JdbcTemplate jdbc,
            BusinessDirectoryService directory) {
        super(jdbc);
        this.directory = directory;
    }

    public record VerificationView(String status) {
    }

    @Transactional
    public VerificationView requestVerification(UUID actor, UUID businessId) {
        var business = directory.requireManaged(actor, businessId);
        if (!Set.of("UNVERIFIED", "REJECTED", "REVOKED")
                .contains(business.verificationStatus())) {
            throw conflict("VERIFICATION_REQUEST_NOT_ALLOWED");
        }
        jdbc.update("UPDATE business_listings SET verification_status='PENDING',"
                + "updated_at=now() WHERE id=?", businessId);
        audit(actor, "BUSINESS_VERIFICATION_REQUESTED", "BUSINESS", businessId);
        return new VerificationView("PENDING");
    }

    public VerificationView verification(UUID viewer, UUID businessId) {
        return new VerificationView(directory.requireViewable(viewer, businessId)
                .verificationStatus());
    }

    @Transactional
    public VerificationView changeVerification(UUID actor, UUID businessId,
            String status, String reason) {
        var business = directory.requireListing(businessId);
        requireVerificationStaff(actor, business);
        if (directory.canManage(actor, business)) {
            throw forbidden("CANNOT_VERIFY_OWN_BUSINESS");
        }
        if (!STAFF_STATUSES.contains(status)) {
            throw bad("INVALID_VERIFICATION_STATUS");
        }
        if (reason == null || reason.isBlank() || reason.trim().length() > 2000) {
            throw bad("VERIFICATION_REASON_REQUIRED");
        }
        boolean validTransition = switch (status) {
            case "VERIFIED", "REJECTED" -> "PENDING".equals(business.verificationStatus());
            case "REVOKED" -> "VERIFIED".equals(business.verificationStatus());
            default -> false;
        };
        if (!validTransition) {
            throw conflict("INVALID_VERIFICATION_TRANSITION");
        }
        jdbc.update("UPDATE business_listings SET verification_status=?::"
                        + "business_verification_status,updated_at=now() WHERE id=?",
                status, businessId);
        String action = switch (status) {
            case "VERIFIED" -> "APPROVE_CONTENT";
            case "REJECTED" -> "REJECT_LISTING";
            default -> "REVOKE_VERIFICATION";
        };
        jdbc.update("INSERT INTO moderation_actions(id,moderator_id,country_id,community_id,"
                        + "target_type,target_id,action_type,reason,metadata)"
                        + " VALUES(?,?,?,?,'BUSINESS',?,?::moderation_action_type,?,"
                        + "jsonb_build_object('from',?,'to',?))",
                UUID.randomUUID(), actor, business.countryId(), business.communityId(),
                businessId, action, reason.trim(), business.verificationStatus(), status);
        jdbc.update("INSERT INTO audit_logs(actor_user_id,actor_type,action_key,target_type,"
                        + "target_id,metadata) VALUES(?,'ADMIN',?,'BUSINESS',?,"
                        + "jsonb_build_object('from',?,'to',?,'reason',?))",
                actor, "BUSINESS_VERIFICATION_" + status, businessId,
                business.verificationStatus(), status, reason.trim());
        return new VerificationView(status);
    }

    private void requireVerificationStaff(UUID actor,
            BusinessDirectoryService.ListingRow business) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM global_user_roles r"
                        + " WHERE r.user_id=? AND r.revoked_at IS NULL AND ("
                        + " (r.role_key='PLATFORM_ADMIN' AND r.scope_type='GLOBAL')"
                        + " OR (r.role_key='PLATFORM_MODERATOR' AND ("
                        + " r.scope_type='GLOBAL'"
                        + " OR (r.scope_type='COUNTRY' AND r.country_id=?)"
                        + " OR (r.scope_type='COMMUNITY' AND (r.community_id=? OR EXISTS"
                        + " (SELECT 1 FROM business_listing_communities bc"
                        + " WHERE bc.business_listing_id=? AND bc.community_id=r.community_id)))"
                        + " )))", Integer.class, actor, business.countryId(),
                business.communityId(), business.id());
        if (count == null || count == 0) {
            throw forbidden("VERIFICATION_STAFF_REQUIRED");
        }
    }

    @Transactional
    public CategoryView createCategory(UUID actor, UUID countryId, String name,
            String slug, String iconKey) {
        requireGlobalAdmin(actor);
        if (countryId != null) {
            Integer countries = jdbc.queryForObject("SELECT count(*) FROM countries"
                    + " WHERE id=? AND is_active", Integer.class, countryId);
            if (countries == null || countries == 0) {
                throw bad("INVALID_COUNTRY");
            }
        }
        if (name == null || name.trim().isEmpty() || name.trim().length() > 120
                || slug == null || slug.length() > 100 || !SLUG.matcher(slug).matches()
                || iconKey != null && iconKey.length() > 80) {
            throw bad("INVALID_CATEGORY");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO business_categories(id,country_id,name,slug,icon_key)"
                + " VALUES(?,?,?,?,?)", id, countryId, name.trim(), slug,
                BusinessDirectoryService.clean(iconKey));
        audit(actor, "BUSINESS_CATEGORY_CREATED", "BUSINESS_CATEGORY", id);
        return category(id);
    }

    @Transactional
    public CategoryView setCategoryActive(UUID actor, UUID categoryId, boolean active) {
        requireGlobalAdmin(actor);
        if (jdbc.update("UPDATE business_categories SET is_active=? WHERE id=?",
                active, categoryId) == 0) {
            throw notFound("CATEGORY_NOT_FOUND");
        }
        audit(actor, active ? "BUSINESS_CATEGORY_ACTIVATED" : "BUSINESS_CATEGORY_DEACTIVATED",
                "BUSINESS_CATEGORY", categoryId);
        return category(categoryId);
    }

    private CategoryView category(UUID id) {
        return jdbc.query("SELECT id,country_id,name,slug,icon_key,is_active"
                        + " FROM business_categories WHERE id=?",
                (rs, i) -> new CategoryView(rs.getObject("id", UUID.class),
                        rs.getObject("country_id", UUID.class), rs.getString("name"),
                        rs.getString("slug"), rs.getString("icon_key"),
                        rs.getBoolean("is_active")), id).stream().findFirst()
                .orElseThrow(() -> notFound("CATEGORY_NOT_FOUND"));
    }

    private void requireGlobalAdmin(UUID actor) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM global_user_roles"
                        + " WHERE user_id=? AND role_key='PLATFORM_ADMIN'"
                        + " AND scope_type='GLOBAL' AND revoked_at IS NULL",
                Integer.class, actor);
        if (count == null || count == 0) {
            throw forbidden("PLATFORM_ADMIN_REQUIRED");
        }
    }
}
