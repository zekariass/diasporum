package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.INVENTORY;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.instant;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.trim;

import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.InventoryMovement;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.InventoryRow;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Per-variant, per-location stock. Available = on hand minus ACTIVE unexpired reservations,
 * always computed on the server. Every quantity change writes an immutable movement.
 */
@Service
public class InventoryService {
    static final Set<String> MANUAL_TYPES = Set.of("ADJUSTMENT", "RECEIPT", "DAMAGE", "WRITE_OFF", "RETURN_RESTOCK");
    static final String RESERVED = "COALESCE((SELECT sum(r.quantity) FROM inventory_reservations r WHERE "
            + "r.inventory_item_id=ii.id AND r.status='ACTIVE' AND r.expires_at>now()),0)";

    private final JdbcTemplate jdbc;
    private final SellerAccessPolicy policy;
    private final ShopSupport support;

    public InventoryService(ShopSupport support, SellerAccessPolicy policy) {
        this.jdbc = support.jdbc();
        this.support = support;
        this.policy = policy;
    }

    public List<InventoryRow> list(UUID actor, UUID shopId, boolean lowOnly, String q) {
        policy.requireShop(actor, shopId, null);
        List<Object> args = new ArrayList<>(List.of(shopId));
        String sql = "SELECT ii.id,l.id AS location_id,l.location_name,v.id AS variant_id,p.id AS product_id,p.name,"
                + "v.variant_label,v.seller_sku,ii.quantity_on_hand," + RESERVED + " AS reserved,ii.low_stock_threshold "
                + "FROM inventory_items ii JOIN inventory_locations l ON l.id=ii.inventory_location_id "
                + "JOIN product_variants v ON v.id=ii.variant_id AND v.status<>'ARCHIVED' "
                + "JOIN products p ON p.id=v.product_id AND p.deleted_at IS NULL AND p.status NOT IN ('ARCHIVED','REMOVED') "
                + "WHERE l.shop_id=?";
        if (lowOnly) {
            sql += " AND ii.quantity_on_hand-" + RESERVED + "<=ii.low_stock_threshold";
        }
        if (trim(q) != null) {
            sql += " AND (p.name ILIKE ? OR v.seller_sku ILIKE ?)";
            args.add("%" + q.trim() + "%");
            args.add("%" + q.trim() + "%");
        }
        sql += " ORDER BY p.name,v.variant_label,l.location_name LIMIT 500";
        return jdbc.query(sql, (rs, i) -> {
            int onHand = rs.getInt("quantity_on_hand");
            int reserved = rs.getInt("reserved");
            int threshold = rs.getInt("low_stock_threshold");
            int available = Math.max(onHand - reserved, 0);
            return new InventoryRow(rs.getObject("id", UUID.class), rs.getObject("location_id", UUID.class),
                    rs.getString("location_name"), rs.getObject("variant_id", UUID.class),
                    rs.getObject("product_id", UUID.class), rs.getString("name"), rs.getString("variant_label"),
                    rs.getString("seller_sku"), onHand, reserved, available, threshold, available <= threshold);
        }, args.toArray());
    }

    /** Adds stock for a new variant at the shop's first active location. */
    void receiveInitial(UUID actor, UUID shopId, UUID variantId, int quantity) {
        UUID location = defaultLocation(shopId);
        if (location == null) {
            throw badRequest("INVENTORY_LOCATION_REQUIRED");
        }
        move(actor, ensureItem(location, variantId), "RECEIPT", quantity, "Initial stock", null, null);
    }

    private UUID defaultLocation(UUID shopId) {
        return jdbc.query("SELECT id FROM inventory_locations WHERE shop_id=? AND status='ACTIVE' ORDER BY created_at LIMIT 1",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, shopId);
    }

    private UUID ensureItem(UUID locationId, UUID variantId) {
        return jdbc.queryForObject("INSERT INTO inventory_items(inventory_location_id,variant_id) VALUES(?,?) "
                + "ON CONFLICT(inventory_location_id,variant_id) DO UPDATE SET updated_at=inventory_items.updated_at RETURNING id",
                UUID.class, locationId, variantId);
    }

    /** Writes an immutable movement and applies it atomically to on-hand stock. */
    void move(UUID actor, UUID inventoryItemId, String type, int delta, String reason, String sourceType, UUID sourceId) {
        int updated = jdbc.update("UPDATE inventory_items SET quantity_on_hand=quantity_on_hand+?,updated_at=now() "
                + "WHERE id=? AND quantity_on_hand+?>=0", delta, inventoryItemId, delta);
        if (updated == 0) {
            throw conflict("INSUFFICIENT_STOCK");
        }
        jdbc.update("INSERT INTO inventory_movements(inventory_item_id,movement_type,quantity_delta,reason,source_type,source_id,"
                + "actor_user_id) VALUES(?,?,?,?,?,?,?)", inventoryItemId, type, delta, reason, sourceType, sourceId, actor);
    }

    @Transactional
    public InventoryRow adjust(UUID actor, UUID shopId, UUID variantId, UUID locationId, int delta, String movementType,
            String reason, Integer lowStockThreshold) {
        policy.requireShop(actor, shopId, INVENTORY);
        String type = movementType == null ? "ADJUSTMENT" : movementType.toUpperCase();
        if (!MANUAL_TYPES.contains(type)) {
            throw badRequest("INVALID_MOVEMENT_TYPE");
        }
        if (delta == 0 && lowStockThreshold == null) {
            throw badRequest("QUANTITY_OR_THRESHOLD_REQUIRED");
        }
        if (delta != 0 && (trim(reason) == null || reason.trim().length() > 1000)) {
            throw badRequest("ADJUSTMENT_REASON_REQUIRED");
        }
        if (("DAMAGE".equals(type) || "WRITE_OFF".equals(type)) && delta > 0) {
            throw badRequest("WRITE_OFF_MUST_DECREASE_STOCK");
        }
        UUID productId = jdbc.query("SELECT p.id FROM product_variants v JOIN products p ON p.id=v.product_id "
                + "WHERE v.id=? AND p.shop_id=?", rs -> rs.next() ? rs.getObject(1, UUID.class) : null, variantId, shopId);
        if (productId == null) {
            throw notFound("VARIANT_NOT_FOUND");
        }
        UUID location = locationId == null ? defaultLocation(shopId) : locationId;
        if (location == null || !Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM inventory_locations "
                + "WHERE id=? AND shop_id=?)", Boolean.class, location, shopId))) {
            throw badRequest("INVENTORY_LOCATION_REQUIRED");
        }
        UUID item = ensureItem(location, variantId);
        Integer[] stock = jdbc.query("SELECT ii.quantity_on_hand," + RESERVED + " FROM inventory_items ii WHERE ii.id=? FOR UPDATE",
                rs -> {
                    rs.next();
                    return new Integer[] {rs.getInt(1), rs.getInt(2)};
                }, item);
        if (delta != 0) {
            if (stock[0] + delta < stock[1]) {
                throw conflict("STOCK_BELOW_RESERVED");
            }
            move(actor, item, type, delta, reason.trim(), "MANUAL", null);
        }
        if (lowStockThreshold != null) {
            if (lowStockThreshold < 0) {
                throw badRequest("INVALID_THRESHOLD");
            }
            jdbc.update("UPDATE inventory_items SET low_stock_threshold=?,updated_at=now() WHERE id=?", lowStockThreshold, item);
        }
        refreshProductStock(productId);
        lowStockAlert(shopId, item);
        return list(actor, shopId, false, null).stream().filter(r -> r.inventoryItemId().equals(item)).findFirst().orElseThrow();
    }

    public List<InventoryMovement> movements(UUID actor, UUID shopId, UUID inventoryItemId) {
        policy.requireShop(actor, shopId, null);
        if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM inventory_items ii JOIN inventory_locations l "
                + "ON l.id=ii.inventory_location_id WHERE ii.id=? AND l.shop_id=?)", Boolean.class, inventoryItemId, shopId))) {
            throw notFound("INVENTORY_ITEM_NOT_FOUND");
        }
        return jdbc.query("SELECT id,movement_type,quantity_delta,reason,source_type,source_id,created_at FROM inventory_movements "
                + "WHERE inventory_item_id=? ORDER BY created_at DESC LIMIT 200", (rs, i) -> new InventoryMovement(
                        rs.getObject("id", UUID.class), rs.getString("movement_type"), rs.getInt("quantity_delta"),
                        rs.getString("reason"), rs.getString("source_type"), rs.getObject("source_id", UUID.class),
                        instant(rs, "created_at")), inventoryItemId);
    }

    /** PUBLISHED <-> OUT_OF_STOCK follows server-computed availability. */
    void refreshProductStock(UUID productId) {
        Long available = jdbc.queryForObject("SELECT COALESCE(sum(" + String.format(CatalogQueryService.AVAILABLE_FOR_VARIANT,
                "v.id") + "),0) FROM product_variants v WHERE v.product_id=? AND v.status='ACTIVE'", Long.class, productId);
        if (available != null && available > 0) {
            jdbc.update("UPDATE products SET status='PUBLISHED',updated_at=now() WHERE id=? AND status='OUT_OF_STOCK'", productId);
        } else {
            jdbc.update("UPDATE products SET status='OUT_OF_STOCK',updated_at=now() WHERE id=? AND status='PUBLISHED'", productId);
        }
    }

    void lowStockAlert(UUID shopId, UUID inventoryItemId) {
        Object[] row = jdbc.query("SELECT ii.quantity_on_hand-" + RESERVED + ",ii.low_stock_threshold,p.name,s.seller_id "
                + "FROM inventory_items ii JOIN product_variants v ON v.id=ii.variant_id JOIN products p ON p.id=v.product_id "
                + "JOIN shops s ON s.id=p.shop_id WHERE ii.id=?", rs -> rs.next() ? new Object[] {rs.getInt(1), rs.getInt(2),
                        rs.getString(3), rs.getObject(4, UUID.class)} : null, inventoryItemId);
        if (row == null || (Integer) row[1] <= 0 || (Integer) row[0] > (Integer) row[1]) {
            return;
        }
        String day = java.time.LocalDate.now().toString();
        for (UUID recipient : policy.sellerRecipients((UUID) row[3])) {
            support.notify(recipient, "MARKETPLACE_LOW_STOCK", "Low stock", row[2] + " is running low.", "SHOP", shopId,
                    "shop-low-stock:" + inventoryItemId + ":" + day);
        }
    }
}
