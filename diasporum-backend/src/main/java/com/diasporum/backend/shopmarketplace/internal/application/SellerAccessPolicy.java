package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.forbidden;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.businessaccounts.BusinessAccountsApi.AccountMembershipView;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Fixed Java capability policy for seller access. Individual sellers own every capability;
 * Business Account sellers reuse live {@code business_account_members} roles through the
 * Business Accounts public API. Client-supplied roles/seller ids are never trusted.
 */
@Component
public class SellerAccessPolicy {
    public static final String SHOP_ADMIN = "SHOP_ADMIN";
    public static final String CATALOG_EDIT = "CATALOG_EDIT";
    public static final String LISTING_LIFECYCLE = "LISTING_LIFECYCLE";
    public static final String INVENTORY = "INVENTORY";
    public static final String ORDERS = "ORDERS";
    public static final String FINANCE = "FINANCE";
    public static final String PAYMENTS = "PAYMENTS";

    private static final List<String> ALL = List.of(SHOP_ADMIN, CATALOG_EDIT, LISTING_LIFECYCLE,
            INVENTORY, ORDERS, FINANCE, PAYMENTS);
    private static final Map<String, List<String>> BUSINESS_ROLES = Map.of(
            "OWNER", ALL,
            "ADMINISTRATOR", ALL,
            "EDITOR", List.of(CATALOG_EDIT),
            "LISTING_MANAGER", List.of(CATALOG_EDIT, LISTING_LIFECYCLE, INVENTORY, ORDERS),
            "BILLING_MANAGER", List.of(FINANCE, PAYMENTS));
    /** Roles that may register a Business Account as a marketplace seller. */
    public static final Set<String> SELLER_REGISTRATION_ROLES = Set.of("OWNER", "ADMINISTRATOR");

    private final JdbcTemplate jdbc;
    private final BusinessAccountsApi businesses;

    public SellerAccessPolicy(JdbcTemplate jdbc, BusinessAccountsApi businesses) {
        this.jdbc = jdbc;
        this.businesses = businesses;
    }

    /** Resolved actor access to one seller entity. */
    public record Access(UUID sellerId, String sellerType, UUID ownerUserId, UUID businessAccountId,
            String role, List<String> capabilities) {
        public boolean has(String capability) {
            return capabilities.contains(capability);
        }
    }

    public List<String> businessCapabilities(String role) {
        return BUSINESS_ROLES.getOrDefault(role, List.of());
    }

    public Optional<Access> sellerAccess(UUID actorUserId, UUID sellerId) {
        return jdbc.query("SELECT id,seller_type,owner_user_id,business_account_id FROM marketplace_sellers "
                + "WHERE id=?", rs -> {
                    if (!rs.next()) {
                        return Optional.<Access>empty();
                    }
                    return resolve(actorUserId, rs.getObject("id", UUID.class), rs.getString("seller_type"),
                            rs.getObject("owner_user_id", UUID.class),
                            rs.getObject("business_account_id", UUID.class));
                }, sellerId);
    }

    private Optional<Access> resolve(UUID actor, UUID sellerId, String type, UUID owner, UUID business) {
        if (owner != null) {
            return owner.equals(actor)
                    ? Optional.of(new Access(sellerId, type, owner, null, "OWNER", ALL)) : Optional.empty();
        }
        return businesses.membership(actor, business)
                .filter(m -> "ACTIVE".equals(m.status()))
                .map(m -> new Access(sellerId, type, null, business, m.role(), businessCapabilities(m.role())))
                .filter(a -> !a.capabilities().isEmpty());
    }

    /** Every seller entity the actor can currently act for. */
    public List<Access> accessibleSellers(UUID actorUserId) {
        List<Access> result = new ArrayList<>();
        jdbc.query("SELECT id,seller_type FROM marketplace_sellers WHERE owner_user_id=?", rs -> {
            result.add(new Access(rs.getObject("id", UUID.class), rs.getString("seller_type"),
                    actorUserId, null, "OWNER", ALL));
        }, actorUserId);
        for (AccountMembershipView m : businesses.membershipsOf(actorUserId)) {
            if (!"ACTIVE".equals(m.status()) || businessCapabilities(m.role()).isEmpty()) {
                continue;
            }
            jdbc.query("SELECT id,seller_type FROM marketplace_sellers WHERE business_account_id=?", rs -> {
                result.add(new Access(rs.getObject("id", UUID.class), rs.getString("seller_type"), null,
                        m.accountId(), m.role(), businessCapabilities(m.role())));
            }, m.accountId());
        }
        return result;
    }

    /** Access to the seller owning {@code shopId}; 404 hides shops the actor cannot manage. */
    public Access requireShop(UUID actorUserId, UUID shopId, String capability) {
        UUID sellerId = jdbc.query("SELECT seller_id FROM shops WHERE id=?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, shopId);
        if (sellerId == null) {
            throw notFound("SHOP_NOT_FOUND");
        }
        Access access = sellerAccess(actorUserId, sellerId).orElseThrow(() -> notFound("SHOP_NOT_FOUND"));
        if (capability != null && !access.has(capability)) {
            throw forbidden("SELLER_PERMISSION_REQUIRED");
        }
        return access;
    }

    public Access requireSeller(UUID actorUserId, UUID sellerId, String capability) {
        Access access = sellerAccess(actorUserId, sellerId).orElseThrow(() -> notFound("SELLER_NOT_FOUND"));
        if (capability != null && !access.has(capability)) {
            throw forbidden("SELLER_PERMISSION_REQUIRED");
        }
        return access;
    }

    /** Users who should receive seller-side notifications (owner, or ORDERS-capable members). */
    public List<UUID> sellerRecipients(UUID sellerId) {
        return jdbc.query("SELECT owner_user_id,business_account_id FROM marketplace_sellers WHERE id=?", rs -> {
            if (!rs.next()) {
                return List.<UUID>of();
            }
            UUID owner = rs.getObject(1, UUID.class);
            if (owner != null) {
                return List.of(owner);
            }
            UUID business = rs.getObject(2, UUID.class);
            return businesses.activeMemberIds(business).stream()
                    .filter(member -> businesses.membership(member, business)
                            .map(m -> businessCapabilities(m.role()).contains(ORDERS)).orElse(false))
                    .toList();
        }, sellerId);
    }

    public boolean isPlatformAdmin(UUID actorUserId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM global_user_roles "
                + "WHERE user_id=? AND role_key IN('PLATFORM_ADMIN','PLATFORM_MODERATOR') "
                + "AND revoked_at IS NULL)", Boolean.class, actorUserId));
    }

    public void requirePlatformAdmin(UUID actorUserId) {
        if (!isPlatformAdmin(actorUserId)) {
            throw forbidden("PLATFORM_ADMIN_REQUIRED");
        }
    }
}
