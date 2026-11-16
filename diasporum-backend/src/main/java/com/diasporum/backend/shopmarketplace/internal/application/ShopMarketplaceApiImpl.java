package com.diasporum.backend.shopmarketplace.internal.application;

import com.diasporum.backend.shopmarketplace.ShopMarketplaceApi;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Public API implementation. Messaging resolves marketplace counterparties through this —
 * never marketplace tables — and the database trigger independently enforces the same
 * participant rules on direct_conversations writes.
 */
@Service
public class ShopMarketplaceApiImpl implements ShopMarketplaceApi {
    private final JdbcTemplate jdbc;
    private final SellerAccessPolicy policy;

    public ShopMarketplaceApiImpl(ShopSupport support, SellerAccessPolicy policy) {
        this.jdbc = support.jdbc();
        this.policy = policy;
    }

    @Override
    public Optional<ConversationEndpoint> conversationCounterparty(UUID actorUserId,
            UUID actingBusinessAccountId, String contextType, UUID contextId) {
        if (!isShopContext(contextType) || contextId == null) {
            return Optional.empty();
        }
        return switch (contextType) {
            case "SHOP" -> sellerEndpointOfShop(contextId);
            case "SHOP_PRODUCT" -> sellerEndpointOfProduct(contextId);
            case "SHOP_ORDER" -> orderCounterparty(actorUserId, actingBusinessAccountId, contextId);
            default -> Optional.empty();
        };
    }

    private static boolean isShopContext(String contextType) {
        return "SHOP".equals(contextType) || "SHOP_PRODUCT".equals(contextType)
                || "SHOP_ORDER".equals(contextType);
    }

    private Optional<ConversationEndpoint> sellerEndpointOfShop(UUID shopId) {
        return jdbc.query("SELECT ms.owner_user_id,ms.business_account_id FROM shops s "
                + "JOIN marketplace_sellers ms ON ms.id=s.seller_id WHERE s.id=? AND s.status='ACTIVE' "
                + "AND ms.status='ACTIVE'", rs -> rs.next() ? Optional.of(new ConversationEndpoint(
                        rs.getObject(1, UUID.class), rs.getObject(2, UUID.class))) : Optional.empty(), shopId);
    }

    private Optional<ConversationEndpoint> sellerEndpointOfProduct(UUID productId) {
        return jdbc.query("SELECT ms.owner_user_id,ms.business_account_id FROM products p JOIN shops s "
                + "ON s.id=p.shop_id JOIN marketplace_sellers ms ON ms.id=s.seller_id WHERE p.id=? "
                + "AND p.deleted_at IS NULL AND s.status='ACTIVE' AND ms.status='ACTIVE'",
                rs -> rs.next() ? Optional.of(new ConversationEndpoint(rs.getObject(1, UUID.class),
                        rs.getObject(2, UUID.class))) : Optional.empty(), productId);
    }

    /** For SHOP_ORDER the counterparty depends on which side the actor is on. */
    private Optional<ConversationEndpoint> orderCounterparty(UUID actorUserId,
            UUID actingBusinessAccountId, UUID sellerOrderId) {
        Object[] row = jdbc.query("SELECT so.seller_id,o.customer_user_id FROM seller_orders so JOIN orders o "
                + "ON o.id=so.order_id WHERE so.id=? AND so.status NOT IN ('PAYMENT_PENDING','CANCELLED')",
                rs -> rs.next() ? new Object[] {rs.getObject(1, UUID.class), rs.getObject(2, UUID.class)} : null,
                sellerOrderId);
        if (row == null) {
            return Optional.empty();
        }
        UUID sellerId = (UUID) row[0];
        UUID customer = (UUID) row[1];
        if (actorUserId.equals(customer)) {
            return jdbc.query("SELECT owner_user_id,business_account_id FROM marketplace_sellers WHERE id=?",
                    rs -> rs.next() ? Optional.of(new ConversationEndpoint(rs.getObject(1, UUID.class),
                            rs.getObject(2, UUID.class))) : Optional.empty(), sellerId);
        }
        boolean sellerSide = policy.sellerAccess(actorUserId, sellerId)
                .filter(a -> actingBusinessAccountId == null || actingBusinessAccountId.equals(a.businessAccountId()))
                .isPresent();
        return sellerSide ? Optional.of(new ConversationEndpoint(customer, null)) : Optional.empty();
    }

    @Override
    public boolean canAccessShopConversation(UUID actorUserId, String contextType, UUID contextId) {
        if (!isShopContext(contextType) || contextId == null) {
            return false;
        }
        if ("SHOP_ORDER".equals(contextType)) {
            Object[] row = jdbc.query("SELECT so.seller_id,o.customer_user_id FROM seller_orders so JOIN orders o "
                    + "ON o.id=so.order_id WHERE so.id=?", rs -> rs.next() ? new Object[] {
                            rs.getObject(1, UUID.class), rs.getObject(2, UUID.class)} : null, contextId);
            if (row == null) {
                return false;
            }
            return actorUserId.equals(row[1]) || policy.sellerAccess(actorUserId, (UUID) row[0]).isPresent();
        }
        // SHOP / SHOP_PRODUCT contexts are public contact surfaces: any active user may hold
        // the buyer side; the seller side is guarded by participant checks in Messaging.
        return true;
    }
}
