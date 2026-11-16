package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.forbidden;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.instant;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.pageSize;

import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Page;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Platform moderation and market governance for the shop marketplace. Every write is
 * recorded in the shared moderation_actions/audit tables and gated on PLATFORM_ADMIN or
 * PLATFORM_MODERATOR (global or country-scoped).
 */
@Service
public class MarketplaceAdminService {
    private static final Set<String> MARKET_STATUSES = Set.of("DISABLED", "BROWSING_ONLY", "ACTIVE", "SUSPENDED");
    private static final Set<String> SHOP_ACTIONS = Set.of("APPROVE", "REJECT", "SUSPEND", "RESTRICT", "REINSTATE");
    private static final Set<String> SELLER_ACTIONS = Set.of("APPROVE", "REJECT", "SUSPEND", "RESTRICT", "REINSTATE");

    private final JdbcTemplate jdbc;
    private final ShopSupport support;

    public MarketplaceAdminService(ShopSupport support) {
        this.jdbc = support.jdbc();
        this.support = support;
    }

    private void requireModerator(UUID actorUserId, UUID countryId) {
        Boolean global = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM global_user_roles WHERE user_id=? "
                + "AND role_key IN('PLATFORM_ADMIN','PLATFORM_MODERATOR') AND scope_type='GLOBAL' "
                + "AND revoked_at IS NULL)", Boolean.class, actorUserId);
        if (Boolean.TRUE.equals(global)) {
            return;
        }
        if (countryId != null && Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM global_user_roles "
                + "WHERE user_id=? AND country_id=? AND scope_type='COUNTRY' "
                + "AND role_key IN('PLATFORM_ADMIN','PLATFORM_MODERATOR') AND revoked_at IS NULL)",
                Boolean.class, actorUserId, countryId))) {
            return;
        }
        throw forbidden("MODERATOR_REQUIRED");
    }

    public record MarketSetting(UUID countryId, String countryName, String iso2, String marketStatus,
            boolean buyerCheckoutEnabled, boolean sellerOnboardingEnabled, boolean shippingEnabled,
            boolean taxEnabled, String defaultCurrency, List<String> supportedCurrencies,
            Instant enabledAt, String disabledReason) {
    }

    public List<MarketSetting> markets(UUID actor) {
        requireModerator(actor, null);
        return jdbc.query("SELECT s.country_id,c.name,c.iso2,s.market_status,s.buyer_checkout_enabled,"
                + "s.seller_onboarding_enabled,s.shipping_enabled,s.tax_enabled,s.default_currency::text,"
                + "s.supported_currencies,s.enabled_at,s.disabled_reason FROM marketplace_country_settings s "
                + "JOIN countries c ON c.id=s.country_id ORDER BY c.name", (rs, i) -> new MarketSetting(
                        rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getBoolean(5), rs.getBoolean(6), rs.getBoolean(7), rs.getBoolean(8), rs.getString(9),
                        List.of((String[]) rs.getArray(10).getArray()), instant(rs, "enabled_at"), rs.getString(12)));
    }

    public record MarketUpdate(String marketStatus, Boolean buyerCheckoutEnabled, Boolean sellerOnboardingEnabled,
            Boolean shippingEnabled, Boolean taxEnabled, String defaultCurrency, List<String> supportedCurrencies,
            String disabledReason) {
    }

    @Transactional
    public MarketSetting updateMarket(UUID actor, UUID countryId, MarketUpdate in) {
        requireModerator(actor, countryId);
        MarketSetting current = jdbc.query("SELECT s.country_id,c.name,c.iso2,s.market_status,s.buyer_checkout_enabled,"
                + "s.seller_onboarding_enabled,s.shipping_enabled,s.tax_enabled,s.default_currency::text,"
                + "s.supported_currencies,s.enabled_at,s.disabled_reason FROM marketplace_country_settings s "
                + "JOIN countries c ON c.id=s.country_id WHERE s.country_id=? FOR UPDATE OF s",
                rs -> rs.next() ? new MarketSetting(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getBoolean(5), rs.getBoolean(6), rs.getBoolean(7), rs.getBoolean(8),
                        rs.getString(9), List.of((String[]) rs.getArray(10).getArray()), instant(rs, "enabled_at"),
                        rs.getString(12)) : null, countryId);
        if (current == null) {
            throw notFound("MARKET_NOT_FOUND");
        }
        String status = in.marketStatus() != null ? in.marketStatus() : current.marketStatus();
        if (!MARKET_STATUSES.contains(status)) {
            throw badRequest("INVALID_MARKET_STATUS");
        }
        boolean checkout = in.buyerCheckoutEnabled() != null ? in.buyerCheckoutEnabled() : current.buyerCheckoutEnabled();
        boolean onboarding = in.sellerOnboardingEnabled() != null ? in.sellerOnboardingEnabled()
                : current.sellerOnboardingEnabled();
        boolean shipping = in.shippingEnabled() != null ? in.shippingEnabled() : current.shippingEnabled();
        boolean tax = in.taxEnabled() != null ? in.taxEnabled() : current.taxEnabled();
        List<String> currencies = in.supportedCurrencies() != null ? in.supportedCurrencies()
                : current.supportedCurrencies();
        String currency = in.defaultCurrency() != null ? in.defaultCurrency() : current.defaultCurrency();
        String reason = in.disabledReason() != null ? in.disabledReason()
                : (status.equals("DISABLED") || status.equals("SUSPENDED") ? current.disabledReason() : null);
        if (jdbc.update("UPDATE marketplace_country_settings SET market_status=?,buyer_checkout_enabled=?,"
                + "seller_onboarding_enabled=?,shipping_enabled=?,tax_enabled=?,default_currency=?,"
                + "supported_currencies=?,disabled_reason=?,enabled_at=CASE WHEN ?='ACTIVE' AND enabled_at IS NULL "
                + "THEN now() ELSE enabled_at END,updated_at=now() WHERE country_id=?",
                status, checkout, onboarding, shipping, tax, currency,
                currencies.toArray(new String[0]), reason, status, countryId) == 0) {
            throw notFound("MARKET_NOT_FOUND");
        }
        audit(actor, "SHOP_MARKET_UPDATED", "SHOP_MARKET", countryId);
        return jdbc.query("SELECT s.country_id,c.name,c.iso2,s.market_status,s.buyer_checkout_enabled,"
                + "s.seller_onboarding_enabled,s.shipping_enabled,s.tax_enabled,s.default_currency::text,"
                + "s.supported_currencies,s.enabled_at,s.disabled_reason FROM marketplace_country_settings s "
                + "JOIN countries c ON c.id=s.country_id WHERE s.country_id=?", rs -> rs.next() ? new MarketSetting(
                        rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getBoolean(5), rs.getBoolean(6), rs.getBoolean(7), rs.getBoolean(8), rs.getString(9),
                        List.of((String[]) rs.getArray(10).getArray()), instant(rs, "enabled_at"), rs.getString(12))
                        : null, countryId);
    }

    public record PendingShop(UUID shopId, String shopName, String slug, UUID sellerId, String sellerDisplayName,
            String sellerType, String status, String marketCountry, Instant submittedAt) {
    }

    public Page<PendingShop> pendingShops(UUID actor, String cursor, Integer size) {
        requireModerator(actor, null);
        int limit = pageSize(size);
        String[] c = ShopSupport.decodeCursor(cursor, "CREATED");
        List<PendingShop> items = new java.util.ArrayList<>(jdbc.query("SELECT s.id,s.name,s.slug,ms.id,"
                + "ms.display_name,ms.seller_type,s.status,c.name,s.created_at FROM shops s "
                + "JOIN marketplace_sellers ms ON ms.id=s.seller_id JOIN countries c ON c.id=s.primary_market_country_id "
                + "WHERE s.status='PENDING_REVIEW' "
                + (c == null ? "" : "AND (s.created_at,s.id)<(?::timestamptz,?) ")
                + "ORDER BY s.created_at DESC,s.id DESC LIMIT ?",
                (rs, i) -> new PendingShop(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getObject(4, UUID.class), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8),
                        rs.getTimestamp(9).toInstant()),
                c == null ? new Object[]{limit + 1} : new Object[]{c[1], UUID.fromString(c[2]), limit + 1}));
        String next = null;
        if (items.size() > limit) {
            items = new java.util.ArrayList<>(items.subList(0, limit));
            PendingShop last = items.getLast();
            next = ShopSupport.cursor("CREATED", last.submittedAt().toString(), last.shopId());
        }
        return new Page<>(items, next);
    }

    @Transactional
    public void moderateShop(UUID actor, UUID shopId, String action, String reason) {
        String normalized = action == null ? "" : action.toUpperCase();
        if (!SHOP_ACTIONS.contains(normalized)) {
            throw badRequest("INVALID_MODERATION_ACTION");
        }
        if (reason == null || reason.isBlank()) {
            throw badRequest("REASON_REQUIRED");
        }
        UUID countryId = jdbc.query("SELECT primary_market_country_id FROM shops WHERE id=?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, shopId);
        if (countryId == null) {
            throw notFound("SHOP_NOT_FOUND");
        }
        requireModerator(actor, countryId);
        String newStatus = switch (normalized) {
            case "APPROVE" -> "ACTIVE";
            case "REJECT" -> "REJECTED";
            case "SUSPEND" -> "SUSPENDED";
            case "RESTRICT" -> "RESTRICTED";
            default -> "ACTIVE";
        };
        int updated = switch (normalized) {
            case "APPROVE" -> jdbc.update("UPDATE shops SET status='ACTIVE',updated_at=now() WHERE id=? "
                    + "AND status='PENDING_REVIEW'", shopId);
            case "REINSTATE" -> jdbc.update("UPDATE shops SET status='ACTIVE',updated_at=now() WHERE id=? "
                    + "AND status IN ('SUSPENDED','RESTRICTED')", shopId);
            default -> jdbc.update("UPDATE shops SET status=?,updated_at=now() WHERE id=? AND status<>'CLOSED'",
                    newStatus, shopId);
        };
        if (updated == 0) {
            throw notFound("SHOP_NOT_FOUND_OR_STATE");
        }
        jdbc.update("INSERT INTO moderation_actions(moderator_id,country_id,target_type,target_id,action_type,reason,"
                + "metadata) VALUES(?,?,'SHOP',?,?::moderation_action_type,?,?::jsonb)", actor, countryId, shopId,
                moderationActionType(normalized), reason.trim(), "{}");
        notifyShopOwner(shopId, "SHOP_" + newStatus, "Shop " + normalized.toLowerCase() + "d");
        audit(actor, "SHOP_MODERATED", "SHOP", shopId);
    }

    public record PendingSeller(UUID sellerId, String displayName, String sellerType, String legalCountry,
            String status, Instant createdAt) {
    }

    public Page<PendingSeller> pendingSellers(UUID actor, String cursor, Integer size) {
        requireModerator(actor, null);
        int limit = pageSize(size);
        String[] c = ShopSupport.decodeCursor(cursor, "CREATED");
        List<PendingSeller> items = new java.util.ArrayList<>(jdbc.query("SELECT ms.id,ms.display_name,ms.seller_type,"
                + "c.name,ms.status,ms.created_at FROM marketplace_sellers ms JOIN countries c ON c.id=ms.legal_country_id "
                + "WHERE ms.status='PENDING_REVIEW' "
                + (c == null ? "" : "AND (ms.created_at,ms.id)<(?::timestamptz,?) ")
                + "ORDER BY ms.created_at DESC,ms.id DESC LIMIT ?",
                (rs, i) -> new PendingSeller(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getString(5), rs.getTimestamp(6).toInstant()),
                c == null ? new Object[]{limit + 1} : new Object[]{c[1], UUID.fromString(c[2]), limit + 1}));
        String next = null;
        if (items.size() > limit) {
            items = new java.util.ArrayList<>(items.subList(0, limit));
            PendingSeller last = items.getLast();
            next = ShopSupport.cursor("CREATED", last.createdAt().toString(), last.sellerId());
        }
        return new Page<>(items, next);
    }

    @Transactional
    public void moderateSeller(UUID actor, UUID sellerId, String action, String reason) {
        String normalized = action == null ? "" : action.toUpperCase();
        if (!SELLER_ACTIONS.contains(normalized)) {
            throw badRequest("INVALID_MODERATION_ACTION");
        }
        if (reason == null || reason.isBlank()) {
            throw badRequest("REASON_REQUIRED");
        }
        UUID countryId = jdbc.query("SELECT legal_country_id FROM marketplace_sellers WHERE id=?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, sellerId);
        if (countryId == null) {
            throw notFound("SELLER_NOT_FOUND");
        }
        requireModerator(actor, countryId);
        int updated = switch (normalized) {
            case "APPROVE" -> jdbc.update("UPDATE marketplace_sellers SET status='ACTIVE',updated_at=now() "
                    + "WHERE id=? AND status='PENDING_REVIEW'", sellerId);
            case "REJECT" -> jdbc.update("UPDATE marketplace_sellers SET status='REJECTED',updated_at=now() "
                    + "WHERE id=? AND status='PENDING_REVIEW'", sellerId);
            case "REINSTATE" -> jdbc.update("UPDATE marketplace_sellers SET status='ACTIVE',updated_at=now() "
                    + "WHERE id=? AND status IN ('SUSPENDED','RESTRICTED')", sellerId);
            default -> jdbc.update("UPDATE marketplace_sellers SET status=?,updated_at=now() WHERE id=? "
                    + "AND status NOT IN ('CLOSED','REJECTED')", normalized.equals("SUSPEND") ? "SUSPENDED"
                            : "RESTRICTED", sellerId);
        };
        if (updated == 0) {
            throw notFound("SELLER_NOT_FOUND_OR_STATE");
        }
        jdbc.update("INSERT INTO moderation_actions(moderator_id,country_id,target_type,target_id,action_type,reason,"
                + "metadata) VALUES(?,?,'SHOP',?,?::moderation_action_type,?,?::jsonb)", actor, countryId, sellerId,
                moderationActionType(normalized), reason.trim(), "{\"seller\":true}");
        audit(actor, "SHOP_SELLER_MODERATED", "SELLER", sellerId);
    }

    public record CommissionRuleView(UUID id, UUID shopId, UUID categoryId, Integer basisPoints, Long fixedFeeMinor,
            String currencyCode, int priority, Instant effectiveFrom, Instant effectiveUntil, String status) {
    }

    public List<CommissionRuleView> commissionRules(UUID actor, UUID shopId, UUID categoryId) {
        requireModerator(actor, null);
        return jdbc.query("SELECT id,shop_id,category_id,commission_basis_points,fixed_fee_minor,currency_code::text,"
                + "priority,effective_from,effective_until,status FROM marketplace_commission_rules "
                + "WHERE (?::uuid IS NULL OR shop_id=?) AND (?::uuid IS NULL OR category_id=?) ORDER BY priority DESC,"
                + "effective_from DESC", (rs, i) -> new CommissionRuleView(rs.getObject(1, UUID.class),
                        rs.getObject(2, UUID.class), rs.getObject(3, UUID.class),
                        rs.getObject(4, Integer.class) == null ? null : rs.getInt(4),
                        rs.getObject(5, Long.class) == null ? null : rs.getLong(5), rs.getString(6), rs.getInt(7),
                        instant(rs, "effective_from"), instant(rs, "effective_until"), rs.getString(10)),
                shopId, shopId, categoryId, categoryId);
    }

    public record CommissionRuleInput(UUID shopId, UUID categoryId, Integer basisPoints, Long fixedFeeMinor,
            String currencyCode, Integer priority, Instant effectiveFrom, Instant effectiveUntil) {
    }

    @Transactional
    public CommissionRuleView createCommissionRule(UUID actor, CommissionRuleInput in) {
        requireModerator(actor, null);
        if ((in.basisPoints() == null) == (in.fixedFeeMinor() == null)) {
            throw badRequest("COMMISSION_RATE_REQUIRED");
        }
        if (in.basisPoints() != null && (in.basisPoints() < 0 || in.basisPoints() > 10000)) {
            throw badRequest("INVALID_BASIS_POINTS");
        }
        if (in.fixedFeeMinor() != null) {
            if (in.fixedFeeMinor() < 0) {
                throw badRequest("INVALID_FIXED_FEE");
            }
            if (in.currencyCode() == null || !in.currencyCode().matches("^[A-Z]{3}$")) {
                throw badRequest("FIXED_FEE_CURRENCY_REQUIRED");
            }
        }
        if (in.shopId() != null && !Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM shops WHERE id=?)", Boolean.class, in.shopId()))) {
            throw notFound("SHOP_NOT_FOUND");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO marketplace_commission_rules(id,shop_id,category_id,commission_basis_points,"
                + "fixed_fee_minor,currency_code,priority,effective_from,effective_until) VALUES(?,?,?,?,?,?,?,?,?)",
                id, in.shopId(), in.categoryId(), in.basisPoints(), in.fixedFeeMinor(), in.currencyCode(),
                in.priority() == null ? 0 : in.priority(), in.effectiveFrom() == null ? Instant.now()
                        : in.effectiveFrom(), in.effectiveUntil());
        audit(actor, "SHOP_COMMISSION_RULE_CREATED", "COMMISSION_RULE", id);
        return commissionRules(actor, null, null).stream().filter(r -> r.id().equals(id)).findFirst().orElseThrow();
    }

    @Transactional
    public void deactivateCommissionRule(UUID actor, UUID ruleId) {
        requireModerator(actor, null);
        if (jdbc.update("UPDATE marketplace_commission_rules SET status='INACTIVE' WHERE id=? AND status='ACTIVE'",
                ruleId) == 0) {
            throw notFound("COMMISSION_RULE_NOT_FOUND");
        }
        audit(actor, "SHOP_COMMISSION_RULE_DEACTIVATED", "COMMISSION_RULE", ruleId);
    }

    private static String moderationActionType(String action) {
        return switch (action) {
            case "APPROVE" -> "APPROVE_CONTENT";
            case "REJECT" -> "REJECT_LISTING";
            case "SUSPEND" -> "SUSPEND";
            case "REINSTATE" -> "RESTORE_CONTENT";
            default -> "WARN";
        };
    }

    private void notifyShopOwner(UUID shopId, String type, String title) {
        // Seller notifications route through ShopSupport's notification helper with the
        // seller-side recipient set already resolved by the shop record.
        UUID ownerUser = jdbc.query("SELECT COALESCE(ms.owner_user_id,(SELECT min(bam.user_id) FROM "
                + "business_account_members bam WHERE bam.business_account_id=ms.business_account_id "
                + "AND bam.accepted_at IS NOT NULL AND bam.revoked_at IS NULL)) "
                + "FROM shops s JOIN marketplace_sellers ms ON ms.id=s.seller_id WHERE s.id=?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, shopId);
        support.notify(ownerUser, type, title, null, "SHOP", shopId, "shop-mod:" + shopId + ":" + type);
    }

    private void audit(UUID actor, String actionKey, String targetType, UUID targetId) {
        jdbc.update("INSERT INTO audit_logs(actor_user_id,actor_type,action_key,target_type,target_id) "
                + "VALUES(?,'ADMIN',?,?,?)", actor, actionKey, targetType, targetId);
    }
}
