package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.CATALOG_EDIT;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.instant;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.trim;

import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.DiscountCode;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.DiscountCodeInput;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seller-managed discount codes. Codes are scoped to one shop; funding is always SELLER,
 * so a code can never reduce the platform's commission. Redemption is recorded once per
 * order (discount_redemptions unique key).
 */
@Service
public class DiscountService {
    private final JdbcTemplate jdbc;
    private final SellerAccessPolicy policy;

    public DiscountService(ShopSupport support, SellerAccessPolicy policy) {
        this.jdbc = support.jdbc();
        this.policy = policy;
    }

    public List<DiscountCode> list(UUID actor, UUID shopId) {
        policy.requireShop(actor, shopId, null);
        return jdbc.query("SELECT d.*,(SELECT count(*) FROM discount_redemptions r WHERE r.discount_code_id=d.id) AS redemptions "
                + "FROM discount_codes d WHERE d.shop_id=? ORDER BY d.created_at DESC LIMIT 200", (rs, i) -> map(rs), shopId);
    }

    private static DiscountCode map(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new DiscountCode(rs.getObject("id", UUID.class), rs.getObject("shop_id", UUID.class), rs.getString("code"),
                rs.getString("discount_type"), rs.getBigDecimal("discount_value"), rs.getString("currency_code") == null ? null
                        : rs.getString("currency_code").trim(),
                rs.getObject("minimum_order_amount_minor", Long.class), rs.getObject("total_usage_limit", Integer.class),
                rs.getObject("per_user_usage_limit", Integer.class), instant(rs, "starts_at"), instant(rs, "ends_at"),
                rs.getString("status"), rs.getLong("redemptions"));
    }

    @Transactional
    public DiscountCode create(UUID actor, UUID shopId, DiscountCodeInput in) {
        policy.requireShop(actor, shopId, CATALOG_EDIT);
        String code = validate(in);
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("INSERT INTO discount_codes(id,shop_id,code,discount_type,discount_value,currency_code,"
                    + "minimum_order_amount_minor,total_usage_limit,per_user_usage_limit,starts_at,ends_at) "
                    + "VALUES(?,?,?,?,?,?,?,?,?,?,?)", id, shopId, code, in.discountType().toUpperCase(), in.discountValue(),
                    in.currencyCode() == null ? null : in.currencyCode().toUpperCase(), in.minimumOrderAmountMinor(),
                    in.totalUsageLimit(), in.perUserUsageLimit(), java.sql.Timestamp.from(in.startsAt()),
                    java.sql.Timestamp.from(in.endsAt()));
        } catch (DuplicateKeyException e) {
            throw conflict("DISCOUNT_CODE_EXISTS");
        }
        return list(actor, shopId).stream().filter(c -> c.id().equals(id)).findFirst().orElseThrow();
    }

    @Transactional
    public DiscountCode setStatus(UUID actor, UUID shopId, UUID codeId, String status) {
        policy.requireShop(actor, shopId, CATALOG_EDIT);
        String target = status == null ? "" : status.toUpperCase();
        if (!List.of("ACTIVE", "PAUSED", "CANCELLED").contains(target)) {
            throw badRequest("INVALID_DISCOUNT_STATUS");
        }
        if (jdbc.update("UPDATE discount_codes SET status=? WHERE id=? AND shop_id=?", target, codeId, shopId) == 0) {
            throw notFound("DISCOUNT_CODE_NOT_FOUND");
        }
        return list(actor, shopId).stream().filter(c -> c.id().equals(codeId)).findFirst().orElseThrow();
    }

    private static String validate(DiscountCodeInput in) {
        if (in == null || trim(in.code()) == null) {
            throw badRequest("DISCOUNT_CODE_REQUIRED");
        }
        String code = in.code().trim().toUpperCase(Locale.ROOT);
        if (code.length() < 3 || code.length() > 64 || !code.matches("^[A-Z0-9_-]+$")) {
            throw badRequest("INVALID_DISCOUNT_CODE");
        }
        String type = in.discountType() == null ? "" : in.discountType().toUpperCase();
        if ("FREE_SHIPPING".equals(type)) {
            if (in.discountValue() != null) {
                throw badRequest("FREE_SHIPPING_HAS_NO_VALUE");
            }
        } else if (!List.of("PERCENTAGE", "FIXED_AMOUNT").contains(type)) {
            throw badRequest("INVALID_DISCOUNT_TYPE");
        } else if (in.discountValue() == null || in.discountValue().signum() <= 0) {
            throw badRequest("DISCOUNT_VALUE_REQUIRED");
        }
        if ("PERCENTAGE".equals(type) && in.discountValue().compareTo(BigDecimal.valueOf(100)) > 0) {
            throw badRequest("PERCENTAGE_OVER_100");
        }
        if ("FIXED_AMOUNT".equals(type) && (in.currencyCode() == null || !in.currencyCode().matches("^[A-Za-z]{3}$"))) {
            throw badRequest("FIXED_AMOUNT_REQUIRES_CURRENCY");
        }
        if (in.startsAt() == null || in.endsAt() == null || !in.endsAt().isAfter(in.startsAt())) {
            throw badRequest("INVALID_DISCOUNT_WINDOW");
        }
        return code;
    }

    /** Resolved, validated code for a shop or null when the code does not apply to this shop. */
    record ApplicableCode(UUID id, String code, String discountType, BigDecimal discountValue, String currencyCode,
            Long minimumOrderAmountMinor) {
    }

    /**
     * Returns the discount in minor units applied to one shop's pre-shipping subtotal.
     * Throws when the code is invalid for this checkout so the customer sees a precise reason.
     */
    public long apply(UUID actor, UUID shopId, String rawCode, long shopSubtotalMinor, String currency) {
        String code = rawCode.trim().toUpperCase(Locale.ROOT);
        Object[] row = jdbc.query("SELECT id,discount_type,discount_value,currency_code,minimum_order_amount_minor,"
                + "total_usage_limit,per_user_usage_limit FROM discount_codes WHERE shop_id=? AND code=? AND status='ACTIVE' "
                + "AND starts_at<=now() AND ends_at>now()", rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class),
                        rs.getString(2), rs.getBigDecimal(3), rs.getString(4), rs.getObject(5, Long.class),
                        rs.getObject(6, Integer.class), rs.getObject(7, Integer.class)} : null, shopId, code);
        if (row == null) {
            throw badRequest("DISCOUNT_CODE_INVALID");
        }
        Long minimum = (Long) row[4];
        if (minimum != null && shopSubtotalMinor < minimum) {
            throw badRequest("DISCOUNT_MINIMUM_NOT_MET");
        }
        if (row[5] != null) {
            Integer used = jdbc.queryForObject("SELECT count(*) FROM discount_redemptions WHERE discount_code_id=?",
                    Integer.class, row[0]);
            if (used != null && used >= (Integer) row[5]) {
                throw badRequest("DISCOUNT_EXHAUSTED");
            }
        }
        if (row[6] != null) {
            Integer used = jdbc.queryForObject("SELECT count(*) FROM discount_redemptions WHERE discount_code_id=? AND user_id=?",
                    Integer.class, row[0], actor);
            if (used != null && used >= (Integer) row[6]) {
                throw badRequest("DISCOUNT_ALREADY_USED");
            }
        }
        String type = (String) row[1];
        if ("FREE_SHIPPING".equals(type)) {
            return 0; // handled by the shipping step: selected option becomes free
        }
        long discount;
        if ("PERCENTAGE".equals(type)) {
            discount = BigDecimal.valueOf(shopSubtotalMinor).multiply((BigDecimal) row[2])
                    .divide(BigDecimal.valueOf(100), 0, RoundingMode.HALF_UP).longValueExact();
        } else {
            String codeCurrency = row[3] == null ? null : ((String) row[3]).trim();
            if (!currency.equals(codeCurrency)) {
                throw badRequest("DISCOUNT_CURRENCY_MISMATCH");
            }
            discount = ((BigDecimal) row[2]).longValueExact();
        }
        return Math.min(discount, shopSubtotalMinor);
    }

    /** True when the code is a FREE_SHIPPING code valid for this shop/checkout. */
    public boolean freeShippingCode(UUID actor, UUID shopId, String rawCode, long shopSubtotalMinor, String currency) {
        try {
            String code = rawCode.trim().toUpperCase(Locale.ROOT);
            String type = jdbc.query("SELECT discount_type FROM discount_codes WHERE shop_id=? AND code=? AND status='ACTIVE' "
                    + "AND starts_at<=now() AND ends_at>now()", rs -> rs.next() ? rs.getString(1) : null, shopId, code);
            if (!"FREE_SHIPPING".equals(type)) {
                return false;
            }
            apply(actor, shopId, rawCode, shopSubtotalMinor, currency); // enforces limits/minimums
            return true;
        } catch (org.springframework.web.server.ResponseStatusException e) {
            throw e;
        }
    }

    void redeem(UUID orderId, UUID codeId, UUID userId, long amountMinor, String currency) {
        jdbc.update("INSERT INTO discount_redemptions(discount_code_id,user_id,order_id,amount_minor,currency_code,funding_party) "
                + "VALUES(?,?,?,?,?,'SELLER') ON CONFLICT(discount_code_id,order_id) DO NOTHING", codeId, userId, orderId,
                amountMinor, currency);
    }
}
