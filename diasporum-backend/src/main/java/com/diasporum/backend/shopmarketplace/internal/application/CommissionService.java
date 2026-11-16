package com.diasporum.backend.shopmarketplace.internal.application;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Resolves the platform commission for a seller order from marketplace_commission_rules
 * (shop + category rule wins over shop-only, then category-only, then the global rule;
 * lowest applicable basis points wins). Computed only on the server.
 */
@Service
public class CommissionService {
    private final JdbcTemplate jdbc;

    public CommissionService(ShopSupport support) {
        this.jdbc = support.jdbc();
    }

    /** Commission in minor units for one seller order. */
    public long commission(UUID shopId, long taxableBaseMinor, String currency) {
        Object[] rule = jdbc.query("SELECT commission_basis_points,fixed_fee_minor FROM marketplace_commission_rules "
                + "WHERE status='ACTIVE' AND effective_from<=now() AND (effective_until IS NULL OR effective_until>now()) "
                + "AND (shop_id=? OR shop_id IS NULL) AND (currency_code IS NULL OR currency_code=?) "
                + "ORDER BY (shop_id IS NOT NULL) DESC,(category_id IS NOT NULL) DESC,priority DESC LIMIT 1",
                rs -> rs.next() ? new Object[] {rs.getObject(1, Integer.class), rs.getObject(2, Long.class)} : null,
                shopId, currency);
        if (rule == null) {
            return 0;
        }
        long commission = rule[0] == null ? 0 : taxableBaseMinor * (Integer) rule[0] / 10000;
        commission += rule[1] == null ? 0 : (Long) rule[1];
        return Math.min(commission, taxableBaseMinor);
    }
}
