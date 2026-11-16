package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.FINANCE;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.instant;

import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Earnings;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.EarningsTotals;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Money;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PaymentAccount;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PayoutView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.TransferView;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Seller financial views. Figures come only from stored orders, transfers, refunds and
 * payout records — the mobile app never computes commissions or earnings.
 */
@Service
public class EarningsService {
    private final JdbcTemplate jdbc;
    private final SellerAccessPolicy policy;
    private final SellerService sellers;

    public EarningsService(ShopSupport support, SellerAccessPolicy policy, SellerService sellers) {
        this.jdbc = support.jdbc();
        this.policy = policy;
        this.sellers = sellers;
    }

    public Earnings earnings(UUID actor, UUID shopId) {
        SellerAccessPolicy.Access access = policy.requireShop(actor, shopId, FINANCE);
        UUID sellerId = access.sellerId();
        Map<String, EarningsTotals> totals = new LinkedHashMap<>();
        jdbc.query("SELECT so.currency_code::text AS cur,"
                + "sum(so.subtotal_amount_minor+so.shipping_amount_minor-so.discount_amount_minor) AS gross,"
                + "sum(so.commission_amount_minor) AS commission,sum(so.seller_net_amount_minor) AS net,"
                + "COALESCE(sum((SELECT sum(r.amount_minor) FROM marketplace_refunds r WHERE r.seller_order_id=so.id "
                + "AND r.status='SUCCEEDED')),0) AS refunds FROM seller_orders so WHERE so.shop_id=? "
                + "AND so.status NOT IN ('PAYMENT_PENDING','CANCELLED') GROUP BY so.currency_code", rs -> {
                    String cur = rs.getString(1).trim();
                    totals.put(cur, new EarningsTotals(cur, Money.of(rs.getLong(2), cur),
                            Money.of(rs.getLong(3), cur), Money.of(rs.getLong(4), cur), Money.of(rs.getLong(5), cur),
                            Money.of(0, cur), Money.of(0, cur), Money.of(0, cur), Money.of(0, cur)));
                }, shopId);
        Map<String, long[]> transferSums = new LinkedHashMap<>();
        jdbc.query("SELECT st.currency_code::text,st.status,sum(st.transfer_amount_minor),sum(st.reversed_amount_minor) "
                + "FROM seller_transfers st JOIN seller_orders so ON so.id=st.seller_order_id WHERE so.shop_id=? "
                + "GROUP BY st.currency_code,st.status", rs -> {
                    String cur = rs.getString(1).trim();
                    long[] sums = transferSums.computeIfAbsent(cur, k -> new long[3]);
                    String status = rs.getString(2);
                    if ("PENDING".equals(status) || "PROCESSING".equals(status)) {
                        sums[0] += rs.getLong(3);
                    } else {
                        sums[1] += rs.getLong(3);
                    }
                    sums[2] += rs.getLong(4);
                }, shopId);
        Map<String, Long> paidOut = new LinkedHashMap<>();
        jdbc.query("SELECT spr.currency_code::text,sum(spr.amount_minor) FROM seller_payout_records spr "
                + "JOIN seller_payment_accounts pa ON pa.id=spr.seller_payment_account_id WHERE pa.seller_id=? "
                + "AND spr.status='PAID' GROUP BY spr.currency_code", rs -> {
                    paidOut.put(rs.getString(1).trim(), rs.getLong(2));
                }, sellerId);
        List<EarningsTotals> merged = totals.values().stream().map(t -> {
            long[] s = transferSums.getOrDefault(t.currencyCode(), new long[3]);
            return new EarningsTotals(t.currencyCode(), t.grossSales(), t.commission(), t.refunds(), t.sellerNet(),
                    Money.of(s[0], t.currencyCode()), Money.of(s[1], t.currencyCode()),
                    Money.of(s[2], t.currencyCode()), Money.of(paidOut.getOrDefault(t.currencyCode(), 0L),
                            t.currencyCode()));
        }).toList();
        List<TransferView> transfers = jdbc.query("SELECT st.id,st.seller_order_id,so.seller_order_number,"
                + "st.currency_code::text,st.gross_amount_minor,st.commission_amount_minor,st.transfer_amount_minor,"
                + "st.reversed_amount_minor,st.status,st.failure_code,st.transferred_at,st.created_at "
                + "FROM seller_transfers st JOIN seller_orders so ON so.id=st.seller_order_id WHERE so.shop_id=? "
                + "ORDER BY st.created_at DESC LIMIT 50", (rs, i) -> {
                    String cur = rs.getString(4).trim();
                    return new TransferView(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getString(3),
                            Money.of(rs.getLong(5), cur), Money.of(rs.getLong(6), cur), Money.of(rs.getLong(7), cur),
                            Money.of(rs.getLong(8), cur), rs.getString(9), rs.getString(10),
                            instant(rs, "transferred_at"), instant(rs, "created_at"));
                }, shopId);
        List<PayoutView> payouts = jdbc.query("SELECT spr.id,spr.currency_code::text,spr.amount_minor,spr.status,"
                + "spr.arrival_date,spr.paid_at,spr.failed_at,spr.failure_code,spr.created_at FROM seller_payout_records spr "
                + "JOIN seller_payment_accounts pa ON pa.id=spr.seller_payment_account_id WHERE pa.seller_id=? "
                + "ORDER BY spr.created_at DESC LIMIT 50", (rs, i) -> new PayoutView(rs.getObject(1, UUID.class),
                        Money.of(rs.getLong(3), rs.getString(2).trim()), rs.getString(4),
                        rs.getDate(5) == null ? null : rs.getDate(5).toLocalDate(), instant(rs, "paid_at"),
                        instant(rs, "failed_at"), rs.getString(8), instant(rs, "created_at")), sellerId);
        PaymentAccount account = sellers.paymentAccount(sellerId);
        return new Earnings(shopId, sellerId, merged, transfers, payouts, account);
    }
}
