package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.FINANCE;
import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.PAYMENTS;
import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.SHOP_ADMIN;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.ADDRESS_COLS;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.forbidden;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.instant;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.trim;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.unavailable;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.Access;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ActivityItem;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Dashboard;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.EligibleBusiness;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.InventoryLocation;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Market;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.MediaItem;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Money;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.OnboardingLink;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.OnboardingStep;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PaymentAccount;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.PolicyView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ReadinessCheck;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Seller;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerAccess;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerOnboarding;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerShop;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.SellerShopDetail;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingProfile;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingProfileInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Shop;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Seller registration, shop management, shop readiness, dashboard and payment onboarding. */
@Service
public class SellerService {
    static final Set<String> POLICY_TYPES = Set.of("SHIPPING", "RETURNS", "CANCELLATION", "REFUNDS", "TERMS", "PRIVACY");
    private static final String SELLER_COLS = "ms.id,ms.seller_type,ms.owner_user_id,ms.business_account_id,"
            + "ms.legal_country_id,c.name AS country_name,ms.legal_name,ms.display_name,ms.status,"
            + "ms.verification_status,ms.created_at";
    private static final String SHOP_COLS = "s.id,s.seller_id,s.primary_market_country_id,s.name,s.slug,s.description,"
            + "s.status,s.published_at,s.created_at,s.updated_at";

    private final JdbcTemplate jdbc;
    private final ShopSupport support;
    private final SellerAccessPolicy policy;
    private final MarketService markets;
    private final BusinessAccountsApi businesses;
    private final PaymentProvider payments;
    private final ShopProperties properties;

    public SellerService(ShopSupport support, SellerAccessPolicy policy, MarketService markets,
            BusinessAccountsApi businesses, PaymentProvider payments, ShopProperties properties) {
        this.jdbc = support.jdbc();
        this.support = support;
        this.policy = policy;
        this.markets = markets;
        this.businesses = businesses;
        this.payments = payments;
        this.properties = properties;
    }

    // ------------------------------------------------------------------ sellers

    public Seller seller(UUID sellerId) {
        return jdbc.query("SELECT " + SELLER_COLS + " FROM marketplace_sellers ms JOIN countries c ON c.id=ms.legal_country_id "
                + "WHERE ms.id=?", (rs, i) -> seller(rs), sellerId).stream().findFirst()
                .orElseThrow(() -> notFound("SELLER_NOT_FOUND"));
    }

    private static Seller seller(ResultSet rs) throws SQLException {
        return new Seller(rs.getObject("id", UUID.class), rs.getString("seller_type"),
                rs.getObject("owner_user_id", UUID.class), rs.getObject("business_account_id", UUID.class),
                rs.getObject("legal_country_id", UUID.class), rs.getString("country_name"), rs.getString("legal_name"),
                rs.getString("display_name"), rs.getString("status"), rs.getString("verification_status"),
                instant(rs, "created_at"));
    }

    public SellerOnboarding onboarding(UUID actor) {
        List<SellerAccess> sellers = policy.accessibleSellers(actor).stream()
                .map(a -> new SellerAccess(seller(a.sellerId()), a.role(), a.capabilities())).toList();
        Set<UUID> sellerBusinesses = new java.util.HashSet<>();
        sellers.forEach(s -> {
            if (s.seller().businessAccountId() != null) {
                sellerBusinesses.add(s.seller().businessAccountId());
            }
        });
        List<EligibleBusiness> eligible = businesses.membershipsOf(actor).stream()
                .filter(m -> "ACTIVE".equals(m.status()) && SellerAccessPolicy.SELLER_REGISTRATION_ROLES.contains(m.role())
                        && !sellerBusinesses.contains(m.accountId()))
                .map(m -> new EligibleBusiness(m.accountId(), m.accountName(), m.role())).toList();
        List<SellerShop> shops = shops(actor);
        List<Market> onboardingMarkets = markets.markets().stream().filter(Market::sellerOnboardingEnabled).toList();
        List<OnboardingStep> steps = new ArrayList<>();
        SellerAccess primary = sellers.isEmpty() ? null : sellers.getFirst();
        steps.add(new OnboardingStep("SELLER", "Seller details", primary == null ? "PENDING" : "DONE",
                primary == null ? "Register as an individual or Business Account seller"
                        : primary.seller().displayName()));
        steps.add(new OnboardingStep("VERIFICATION", "Seller review", primary == null ? "BLOCKED"
                : "ACTIVE".equals(primary.seller().status()) ? "DONE"
                : "PENDING_REVIEW".equals(primary.seller().status()) ? "PENDING" : "ACTION_REQUIRED",
                primary == null ? null : primary.seller().status()));
        SellerShop firstShop = primary == null ? null : shops.stream()
                .filter(s -> s.sellerId().equals(primary.seller().id())).findFirst().orElse(null);
        steps.add(new OnboardingStep("SHOP", "Create your shop", firstShop == null ? (primary == null ? "BLOCKED" : "PENDING")
                : "DONE", firstShop == null ? null : firstShop.name()));
        boolean shipping = firstShop != null && Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM "
                + "shop_shipping_profiles WHERE shop_id=? AND status='ACTIVE') AND EXISTS(SELECT 1 FROM shipping_methods "
                + "WHERE shop_id=? AND status='ACTIVE')", Boolean.class, firstShop.id(), firstShop.id()));
        steps.add(new OnboardingStep("SHIPPING", "Shipping & dispatch", firstShop == null ? "BLOCKED" : shipping ? "DONE" : "PENDING", null));
        PaymentAccount account = primary == null ? null : paymentAccount(primary.seller().id());
        boolean paymentReady = account != null && account.chargesEnabled() && account.payoutsEnabled();
        steps.add(new OnboardingStep("PAYMENTS", "Payment account", primary == null ? "BLOCKED"
                : !payments.available() ? "BLOCKED" : paymentReady ? "DONE" : account == null ? "PENDING" : "ACTION_REQUIRED",
                !payments.available() ? "Payment provider is not configured for this environment"
                        : account == null ? null : account.onboardingStatus()));
        steps.add(new OnboardingStep("PUBLISH", "Shop review & publish", firstShop == null ? "BLOCKED"
                : "ACTIVE".equals(firstShop.status()) ? "DONE" : "PENDING_REVIEW".equals(firstShop.status()) ? "PENDING"
                : "ACTION_REQUIRED", firstShop == null ? null : firstShop.status()));
        return new SellerOnboarding(sellers, eligible, shops, onboardingMarkets, steps);
    }

    @Transactional
    public Seller createSeller(UUID actor, String sellerType, UUID businessAccountId, UUID legalCountryId,
            String legalName, String displayName) {
        support.requireActive(actor);
        Market market = markets.market(legalCountryId);
        if (!market.sellerOnboardingEnabled()) {
            throw forbidden("SELLER_ONBOARDING_UNAVAILABLE_IN_COUNTRY");
        }
        String type = sellerType == null ? "" : sellerType.toUpperCase();
        UUID owner = null;
        if ("INDIVIDUAL".equals(type)) {
            owner = actor;
            businessAccountId = null;
        } else if ("BUSINESS".equals(type)) {
            if (businessAccountId == null) {
                throw badRequest("BUSINESS_ACCOUNT_REQUIRED");
            }
            var membership = businesses.membership(actor, businessAccountId)
                    .orElseThrow(() -> forbidden("BUSINESS_ROLE_REQUIRED"));
            if (!"ACTIVE".equals(membership.status())
                    || !SellerAccessPolicy.SELLER_REGISTRATION_ROLES.contains(membership.role())) {
                throw forbidden("BUSINESS_ROLE_REQUIRED");
            }
        } else {
            throw badRequest("INVALID_SELLER_TYPE");
        }
        if (trim(legalName) == null || trim(displayName) == null) {
            throw badRequest("SELLER_NAME_REQUIRED");
        }
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("INSERT INTO marketplace_sellers(id,seller_type,owner_user_id,business_account_id,legal_country_id,"
                    + "legal_name,display_name,status) VALUES(?,?,?,?,?,?,?,?)", id, type, owner, businessAccountId,
                    legalCountryId, legalName.trim(), displayName.trim(), properties.autoApprove() ? "ACTIVE" : "PENDING_REVIEW");
        } catch (DuplicateKeyException e) {
            throw conflict("SELLER_ALREADY_EXISTS");
        }
        return seller(id);
    }

    // ------------------------------------------------------------------ shops

    public List<SellerShop> shops(UUID actor) {
        List<SellerShop> result = new ArrayList<>();
        for (Access access : policy.accessibleSellers(actor)) {
            result.addAll(jdbc.query("SELECT s.id,s.seller_id,ms.display_name,ms.seller_type,ms.status AS seller_status,s.name,"
                    + "s.slug,s.status,s.primary_market_country_id,(SELECT media_id FROM shop_media WHERE shop_id=s.id "
                    + "AND media_role='LOGO') AS logo FROM shops s JOIN marketplace_sellers ms ON ms.id=s.seller_id "
                    + "WHERE s.seller_id=? AND s.status<>'CLOSED' ORDER BY s.created_at", (rs, i) -> new SellerShop(
                            rs.getObject("id", UUID.class), rs.getObject("seller_id", UUID.class), rs.getString("display_name"),
                            rs.getString("seller_type"), rs.getString("seller_status"), rs.getString("name"), rs.getString("slug"),
                            rs.getString("status"), rs.getObject("logo", UUID.class), null,
                            rs.getObject("primary_market_country_id", UUID.class), access.role(), access.capabilities()),
                    access.sellerId()));
        }
        Map<UUID, String> urls = support.urls(result.stream().map(SellerShop::logoMediaId).toList());
        return result.stream().map(s -> new SellerShop(s.id(), s.sellerId(), s.sellerDisplayName(), s.sellerType(),
                s.sellerStatus(), s.name(), s.slug(), s.status(), s.logoMediaId(), urls.get(s.logoMediaId()),
                s.primaryMarketCountryId(), s.role(), s.capabilities())).toList();
    }

    public Shop shopRow(UUID shopId) {
        return jdbc.query("SELECT " + SHOP_COLS + " FROM shops s WHERE s.id=?", (rs, i) -> shop(rs), shopId)
                .stream().findFirst().orElseThrow(() -> notFound("SHOP_NOT_FOUND"));
    }

    private static Shop shop(ResultSet rs) throws SQLException {
        return new Shop(rs.getObject("id", UUID.class), rs.getObject("seller_id", UUID.class),
                rs.getObject("primary_market_country_id", UUID.class), rs.getString("name"), rs.getString("slug"),
                rs.getString("description"), rs.getString("status"), instant(rs, "published_at"),
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    @Transactional
    public SellerShopDetail createShop(UUID actor, UUID sellerId, String name, String description, UUID marketCountryId) {
        support.requireActive(actor);
        policy.requireSeller(actor, sellerId, SHOP_ADMIN);
        Seller seller = seller(sellerId);
        if (Set.of("SUSPENDED", "CLOSED", "REJECTED").contains(seller.status())) {
            throw forbidden("SELLER_NOT_ALLOWED_TO_OPEN_SHOPS");
        }
        Market market = markets.market(marketCountryId == null ? seller.legalCountryId() : marketCountryId);
        if (!"ACTIVE".equals(market.marketStatus())) {
            throw forbidden("MARKET_NOT_ACTIVE_FOR_SHOPS");
        }
        String shopName = trim(name);
        if (shopName == null || shopName.length() > 160) {
            throw badRequest("SHOP_NAME_REQUIRED");
        }
        String base = ShopSupport.slug(shopName);
        String slug = base;
        for (int n = 2; Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM shops WHERE "
                + "primary_market_country_id=? AND slug=?)", Boolean.class, market.countryId(), slug)); n++) {
            slug = base + "-" + n;
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO shops(id,seller_id,primary_market_country_id,name,slug,description) VALUES(?,?,?,?,?,?)",
                id, sellerId, market.countryId(), shopName, slug, trim(description));
        return shopDetail(actor, id);
    }

    public SellerShopDetail shopDetail(UUID actor, UUID shopId) {
        Access access = policy.requireShop(actor, shopId, null);
        Shop shop = shopRow(shopId);
        Seller seller = seller(shop.sellerId());
        Map<String, UUID> single = new HashMap<>();
        List<MediaItem> gallery = new ArrayList<>();
        jdbc.query("SELECT media_id,media_role,display_order FROM shop_media WHERE shop_id=? ORDER BY display_order", rs -> {
            String role = rs.getString(2);
            if ("GALLERY".equals(role)) {
                gallery.add(new MediaItem(rs.getObject(1, UUID.class), null, role, rs.getInt(3), null));
            } else {
                single.put(role, rs.getObject(1, UUID.class));
            }
        }, shopId);
        List<UUID> ids = new ArrayList<>(single.values());
        gallery.forEach(g -> ids.add(g.mediaId()));
        Map<UUID, String> urls = support.urls(ids);
        List<PolicyView> policies = jdbc.query("SELECT DISTINCT ON (policy_type) policy_type,version_number,policy_text,"
                + "effective_from FROM shop_policies WHERE shop_id=? AND (effective_until IS NULL OR effective_until>now()) "
                + "ORDER BY policy_type,version_number DESC", (rs, i) -> new PolicyView(rs.getString(1), rs.getInt(2),
                        rs.getString(3), instant(rs, "effective_from")), shopId);
        ShippingProfile profile = shippingProfile(shopId);
        UUID logoId = single.get("LOGO");
        UUID coverId = single.get("COVER");
        return new SellerShopDetail(shop, seller, logoId, logoId == null ? null : urls.get(logoId), coverId,
                coverId == null ? null : urls.get(coverId), gallery.stream().map(g -> new MediaItem(g.mediaId(), urls.get(g.mediaId()),
                        g.role(), g.displayOrder(), null)).toList(), policies, profile, access.role(), access.capabilities(),
                readiness(shop, seller, profile, policies));
    }

    List<ReadinessCheck> readiness(Shop shop, Seller seller, ShippingProfile profile, List<PolicyView> policies) {
        List<ReadinessCheck> checks = new ArrayList<>();
        checks.add(new ReadinessCheck("SELLER_ACTIVE", "ACTIVE".equals(seller.status()),
                "ACTIVE".equals(seller.status()) ? "Seller approved" : "Seller status: " + seller.status()));
        checks.add(new ReadinessCheck("SHIPPING_PROFILE", profile != null,
                profile != null ? "Dispatch address set" : "Add a dispatch address and handling time"));
        boolean methods = Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM shipping_methods "
                + "WHERE shop_id=? AND status='ACTIVE')", Boolean.class, shop.id()));
        checks.add(new ReadinessCheck("SHIPPING_METHODS", methods, methods ? "Shipping methods configured"
                : "Add at least one shipping zone and method"));
        boolean returns = policies.stream().anyMatch(p -> "RETURNS".equals(p.policyType()));
        checks.add(new ReadinessCheck("RETURNS_POLICY", returns, returns ? "Return policy published" : "Publish a return policy"));
        PaymentAccount account = paymentAccount(seller.id());
        boolean paymentReady = account != null && account.chargesEnabled() && account.payoutsEnabled();
        checks.add(new ReadinessCheck("PAYMENT_ACCOUNT", paymentReady, paymentReady ? "Payments and payouts enabled"
                : account == null ? "Complete payment onboarding" : "Payment account: " + account.onboardingStatus()));
        Market market = markets.market(shop.primaryMarketCountryId());
        checks.add(new ReadinessCheck("MARKET_CHECKOUT", market.buyerCheckoutEnabled(), market.buyerCheckoutEnabled()
                ? "Checkout enabled in " + market.countryName() : "Checkout is not yet enabled in " + market.countryName()));
        checks.add(new ReadinessCheck("SHOP_ACTIVE", "ACTIVE".equals(shop.status()), "Shop status: " + shop.status()));
        return checks;
    }

    @Transactional
    public SellerShopDetail updateShop(UUID actor, UUID shopId, String name, String description) {
        policy.requireShop(actor, shopId, SHOP_ADMIN);
        String shopName = trim(name);
        if (shopName == null || shopName.length() > 160) {
            throw badRequest("SHOP_NAME_REQUIRED");
        }
        if (description != null && description.length() > 5000) {
            throw badRequest("SHOP_DESCRIPTION_TOO_LONG");
        }
        jdbc.update("UPDATE shops SET name=?,description=?,updated_at=now() WHERE id=?", shopName, trim(description), shopId);
        return shopDetail(actor, shopId);
    }

    @Transactional
    public SellerShopDetail updateMedia(UUID actor, UUID shopId, UUID logo, UUID cover, List<UUID> gallery) {
        policy.requireShop(actor, shopId, SHOP_ADMIN);
        List<UUID> galleryIds = gallery == null ? List.of() : gallery.stream().distinct().toList();
        if (galleryIds.size() > 10) {
            throw badRequest("SHOP_GALLERY_LIMIT");
        }
        Set<UUID> existing = new java.util.HashSet<>(jdbc.queryForList("SELECT media_id FROM shop_media WHERE shop_id=?",
                UUID.class, shopId));
        List<UUID> all = new ArrayList<>(galleryIds);
        if (logo != null) {
            all.add(logo);
        }
        if (cover != null) {
            all.add(cover);
        }
        for (UUID mediaId : all) {
            if (!existing.contains(mediaId)) {
                support.requireMedia(mediaId, actor, "SHOP");
            }
        }
        jdbc.update("DELETE FROM shop_media WHERE shop_id=?", shopId);
        if (logo != null) {
            jdbc.update("INSERT INTO shop_media(shop_id,media_id,media_role,display_order) VALUES(?,?,'LOGO',0)", shopId, logo);
        }
        if (cover != null && !cover.equals(logo)) {
            jdbc.update("INSERT INTO shop_media(shop_id,media_id,media_role,display_order) VALUES(?,?,'COVER',0)", shopId, cover);
        }
        int order = 0;
        for (UUID mediaId : galleryIds) {
            if (!mediaId.equals(logo) && !mediaId.equals(cover)) {
                jdbc.update("INSERT INTO shop_media(shop_id,media_id,media_role,display_order) VALUES(?,?,'GALLERY',?)",
                        shopId, mediaId, order++);
            }
        }
        return shopDetail(actor, shopId);
    }

    @Transactional
    public SellerShopDetail updatePolicy(UUID actor, UUID shopId, String policyType, String text) {
        policy.requireShop(actor, shopId, SHOP_ADMIN);
        String type = policyType == null ? "" : policyType.toUpperCase();
        if (!POLICY_TYPES.contains(type)) {
            throw badRequest("INVALID_POLICY_TYPE");
        }
        String body = trim(text);
        if (body == null || body.length() > 20000) {
            throw badRequest("POLICY_TEXT_REQUIRED");
        }
        jdbc.queryForList("SELECT id FROM shops WHERE id=? FOR UPDATE", UUID.class, shopId);
        Integer version = jdbc.queryForObject("SELECT COALESCE(max(version_number),0)+1 FROM shop_policies "
                + "WHERE shop_id=? AND policy_type=?", Integer.class, shopId, type);
        jdbc.update("UPDATE shop_policies SET effective_until=clock_timestamp() WHERE shop_id=? AND policy_type=? "
                + "AND effective_until IS NULL", shopId, type);
        jdbc.update("INSERT INTO shop_policies(shop_id,policy_type,version_number,policy_text,effective_from,created_by_user_id) "
                + "VALUES(?,?,?,?,clock_timestamp(),?)", shopId, type, version, body, actor);
        return shopDetail(actor, shopId);
    }

    public ShippingProfile shippingProfile(UUID shopId) {
        return jdbc.query("SELECT p.id,p.handling_time_min_days,p.handling_time_max_days,p.default_package_weight_grams,"
                + "p.default_package_length_mm,p.default_package_width_mm,p.default_package_height_mm," + ADDRESS_COLS
                + " FROM shop_shipping_profiles p JOIN addresses a ON a.id=p.origin_address_id JOIN countries c "
                + "ON c.id=a.country_id WHERE p.shop_id=? AND p.status='ACTIVE' ORDER BY p.is_default DESC LIMIT 1",
                (rs, i) -> new ShippingProfile(rs.getObject("id", UUID.class), ShopSupport.address(rs),
                        rs.getInt("handling_time_min_days"), rs.getInt("handling_time_max_days"),
                        rs.getObject("default_package_weight_grams", Integer.class),
                        rs.getObject("default_package_length_mm", Integer.class),
                        rs.getObject("default_package_width_mm", Integer.class),
                        rs.getObject("default_package_height_mm", Integer.class)), shopId).stream().findFirst().orElse(null);
    }

    UUID insertAddress(UUID owner, AddressInput in) {
        if (in == null || in.countryId() == null || trim(in.line1()) == null || trim(in.city()) == null) {
            throw badRequest("ADDRESS_INCOMPLETE");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO addresses(id,country_id,address_line_1,address_line_2,city,region,postal_code,"
                + "formatted_address,visibility,owner_user_id) VALUES(?,?,?,?,?,?,?,?,'PRIVATE',?)", id, in.countryId(),
                trim(in.line1()), trim(in.line2()), trim(in.city()), trim(in.region()), trim(in.postalCode()),
                String.join(", ", java.util.stream.Stream.of(trim(in.line1()), trim(in.line2()), trim(in.city()),
                        trim(in.region()), trim(in.postalCode())).filter(java.util.Objects::nonNull).toList()), owner);
        return id;
    }

    @Transactional
    public ShippingProfile updateShippingProfile(UUID actor, UUID shopId, ShippingProfileInput in) {
        policy.requireShop(actor, shopId, SHOP_ADMIN);
        if (in.handlingMinDays() < 0 || in.handlingMaxDays() < in.handlingMinDays() || in.handlingMaxDays() > 60) {
            throw badRequest("INVALID_HANDLING_TIME");
        }
        UUID addressId = insertAddress(actor, in.origin());
        ShippingProfile existing = shippingProfile(shopId);
        if (existing == null) {
            jdbc.update("INSERT INTO shop_shipping_profiles(shop_id,profile_name,origin_address_id,handling_time_min_days,"
                    + "handling_time_max_days,default_package_weight_grams,default_package_length_mm,default_package_width_mm,"
                    + "default_package_height_mm,is_default) VALUES(?,'Default',?,?,?,?,?,?,?,true)", shopId, addressId,
                    in.handlingMinDays(), in.handlingMaxDays(), in.defaultWeightGrams(), in.defaultLengthMm(),
                    in.defaultWidthMm(), in.defaultHeightMm());
        } else {
            jdbc.update("UPDATE shop_shipping_profiles SET origin_address_id=?,handling_time_min_days=?,handling_time_max_days=?,"
                    + "default_package_weight_grams=?,default_package_length_mm=?,default_package_width_mm=?,"
                    + "default_package_height_mm=?,updated_at=now() WHERE id=?", addressId, in.handlingMinDays(),
                    in.handlingMaxDays(), in.defaultWeightGrams(), in.defaultLengthMm(), in.defaultWidthMm(),
                    in.defaultHeightMm(), existing.id());
        }
        Integer locations = jdbc.queryForObject("SELECT count(*) FROM inventory_locations WHERE shop_id=?", Integer.class, shopId);
        if (locations == 0) {
            jdbc.update("INSERT INTO inventory_locations(shop_id,address_id,location_name,location_type) "
                    + "VALUES(?,?,'Main location','BOTH')", shopId, addressId);
        }
        return shippingProfile(shopId);
    }

    @Transactional
    public SellerShopDetail submitShop(UUID actor, UUID shopId) {
        policy.requireShop(actor, shopId, SHOP_ADMIN);
        Shop shop = shopRow(shopId);
        if (!Set.of("DRAFT", "REJECTED", "PAUSED").contains(shop.status())) {
            throw conflict("SHOP_NOT_SUBMITTABLE");
        }
        Seller seller = seller(shop.sellerId());
        SellerShopDetail detail = shopDetail(actor, shopId);
        List<String> missing = detail.readiness().stream()
                .filter(c -> !c.ok() && Set.of("SHIPPING_PROFILE", "SHIPPING_METHODS", "RETURNS_POLICY").contains(c.key()))
                .map(ReadinessCheck::message).toList();
        if (!missing.isEmpty()) {
            throw badRequest("SHOP_NOT_READY");
        }
        boolean activate = "PAUSED".equals(shop.status()) || (properties.autoApprove() && "ACTIVE".equals(seller.status()));
        jdbc.update("UPDATE shops SET status=?,published_at=COALESCE(published_at,CASE WHEN ?='ACTIVE' THEN now() END),"
                + "updated_at=now() WHERE id=?", activate ? "ACTIVE" : "PENDING_REVIEW", activate ? "ACTIVE" : "PENDING_REVIEW",
                shopId);
        return shopDetail(actor, shopId);
    }

    @Transactional
    public SellerShopDetail pauseShop(UUID actor, UUID shopId) {
        policy.requireShop(actor, shopId, SHOP_ADMIN);
        if (jdbc.update("UPDATE shops SET status='PAUSED',updated_at=now() WHERE id=? AND status='ACTIVE'", shopId) == 0) {
            throw conflict("SHOP_NOT_ACTIVE");
        }
        return shopDetail(actor, shopId);
    }

    // ------------------------------------------------------------------ inventory locations

    public List<InventoryLocation> locations(UUID actor, UUID shopId) {
        policy.requireShop(actor, shopId, null);
        return jdbc.query("SELECT l.id,l.location_name,l.location_type,l.status," + ADDRESS_COLS + " FROM inventory_locations l "
                + "JOIN addresses a ON a.id=l.address_id JOIN countries c ON c.id=a.country_id WHERE l.shop_id=? "
                + "ORDER BY l.created_at", (rs, i) -> new InventoryLocation(rs.getObject("id", UUID.class),
                        rs.getString("location_name"), rs.getString("location_type"), rs.getString("status"),
                        ShopSupport.address(rs)), shopId);
    }

    @Transactional
    public InventoryLocation createLocation(UUID actor, UUID shopId, String name, AddressInput address) {
        policy.requireShop(actor, shopId, SellerAccessPolicy.INVENTORY);
        if (trim(name) == null) {
            throw badRequest("LOCATION_NAME_REQUIRED");
        }
        UUID addressId = insertAddress(actor, address);
        try {
            jdbc.update("INSERT INTO inventory_locations(shop_id,address_id,location_name,location_type) VALUES(?,?,?,'BOTH')",
                    shopId, addressId, name.trim());
        } catch (DuplicateKeyException e) {
            throw conflict("LOCATION_NAME_EXISTS");
        }
        return locations(actor, shopId).stream().filter(l -> l.name().equals(name.trim())).findFirst().orElseThrow();
    }

    // ------------------------------------------------------------------ dashboard

    public Dashboard dashboard(UUID actor, UUID shopId) {
        Access access = policy.requireShop(actor, shopId, null);
        Shop shop = shopRow(shopId);
        Seller seller = seller(shop.sellerId());
        boolean finance = access.has(FINANCE);
        List<Money> gross = new ArrayList<>();
        Long orders = null;
        if (finance) {
            jdbc.query("SELECT currency_code,sum(subtotal_amount_minor-discount_amount_minor+shipping_amount_minor) FROM seller_orders "
                    + "WHERE shop_id=? AND status NOT IN ('PAYMENT_PENDING','CANCELLED') AND created_at>now()-interval '30 days' "
                    + "GROUP BY currency_code", rs -> {
                        gross.add(Money.of(rs.getLong(2), rs.getString(1).trim()));
                    }, shopId);
            orders = jdbc.queryForObject("SELECT count(*) FROM seller_orders WHERE shop_id=? AND status NOT IN "
                    + "('PAYMENT_PENDING','CANCELLED') AND created_at>now()-interval '30 days'", Long.class, shopId);
        }
        long newOrders = count("SELECT count(*) FROM seller_orders WHERE shop_id=? AND status='PLACED'", shopId);
        long awaiting = count("SELECT count(*) FROM seller_orders WHERE shop_id=? AND status IN ('ACCEPTED','PROCESSING',"
                + "'PARTIALLY_DISPATCHED')", shopId);
        long lowStock = count("SELECT count(*) FROM inventory_items ii JOIN inventory_locations l ON l.id=ii.inventory_location_id "
                + "JOIN product_variants v ON v.id=ii.variant_id AND v.status='ACTIVE' WHERE l.shop_id=? "
                + "AND ii.quantity_on_hand<=ii.low_stock_threshold", shopId);
        long returns = count("SELECT count(*) FROM return_requests r JOIN seller_orders so ON so.id=r.seller_order_id "
                + "WHERE so.shop_id=? AND r.status IN ('REQUESTED','UNDER_REVIEW','RECEIVED','INSPECTED')", shopId);
        List<ActivityItem> activity = jdbc.query("SELECT * FROM (SELECT 'ORDER' AS type,'Order ' || seller_order_number AS title,"
                + "created_at AS at,id FROM seller_orders WHERE shop_id=? AND status<>'PAYMENT_PENDING' UNION ALL "
                + "SELECT 'RETURN','Return requested',r.created_at,r.id FROM return_requests r JOIN seller_orders so "
                + "ON so.id=r.seller_order_id WHERE so.shop_id=? UNION ALL SELECT 'REVIEW','New shop review (' || rating || '★)',"
                + "created_at,id FROM shop_reviews WHERE shop_id=?) x ORDER BY at DESC LIMIT 10", (rs, i) -> new ActivityItem(
                        rs.getString("type"), rs.getString("title"), instant(rs, "at"), rs.getObject("id", UUID.class)),
                shopId, shopId, shopId);
        return new Dashboard(shopId, shop.status(), gross, orders, newOrders, awaiting, lowStock, returns, seller.status(),
                seller.verificationStatus(), access.has(PAYMENTS) || finance ? paymentAccount(seller.id()) : null, activity, finance);
    }

    private long count(String sql, UUID id) {
        Long value = jdbc.queryForObject(sql, Long.class, id);
        return value == null ? 0 : value;
    }

    // ------------------------------------------------------------------ payment onboarding

    public PaymentAccount paymentAccount(UUID sellerId) {
        return jdbc.query("SELECT id,seller_id,provider_key,account_type,onboarding_status,charges_enabled,payouts_enabled,"
                + "details_submitted,requirements_due::text AS due,last_synced_at FROM seller_payment_accounts "
                + "WHERE seller_id=? AND provider_key=?", (rs, i) -> new PaymentAccount(rs.getObject("id", UUID.class),
                        rs.getObject("seller_id", UUID.class), rs.getString("provider_key"), rs.getString("account_type"),
                        rs.getString("onboarding_status"), rs.getBoolean("charges_enabled"), rs.getBoolean("payouts_enabled"),
                        rs.getBoolean("details_submitted"), ShopSupport.list(rs.getString("due")).stream().map(String::valueOf)
                                .toList(), instant(rs, "last_synced_at")), sellerId, payments.key())
                .stream().findFirst().orElse(null);
    }

    public PaymentAccount paymentStatus(UUID actor, UUID shopId) {
        Access access = policy.requireShop(actor, shopId, null);
        if (!access.has(PAYMENTS) && !access.has(FINANCE)) {
            throw forbidden("SELLER_PERMISSION_REQUIRED");
        }
        PaymentAccount account = paymentAccount(access.sellerId());
        if (account != null && payments.available()) {
            String accountId = jdbc.queryForObject("SELECT connected_account_id FROM seller_payment_accounts WHERE id=?",
                    String.class, account.id());
            syncAccount(payments.retrieveConnectedAccount(accountId));
            account = paymentAccount(access.sellerId());
        }
        return account;
    }

    @Transactional
    public OnboardingLink onboardingLink(UUID actor, UUID shopId) {
        Access access = policy.requireShop(actor, shopId, PAYMENTS);
        if (!payments.available()) {
            throw unavailable("PAYMENT_PROVIDER_UNAVAILABLE");
        }
        Seller seller = seller(access.sellerId());
        if (Set.of("SUSPENDED", "CLOSED", "REJECTED").contains(seller.status())) {
            throw forbidden("SELLER_NOT_ALLOWED");
        }
        jdbc.queryForList("SELECT id FROM marketplace_sellers WHERE id=? FOR UPDATE", UUID.class, seller.id());
        String accountId = jdbc.query("SELECT connected_account_id FROM seller_payment_accounts WHERE seller_id=? "
                + "AND provider_key=?", rs -> rs.next() ? rs.getString(1) : null, seller.id(), payments.key());
        if (accountId == null) {
            String iso2 = jdbc.queryForObject("SELECT iso2 FROM countries WHERE id=?", String.class, seller.legalCountryId());
            // We already know individual vs business from onboarding — pre-fill Stripe's
            // business_type so the hosted link doesn't ask the seller a question we can answer.
            String businessType = "BUSINESS".equals(seller.sellerType()) ? "company" : "individual";
            accountId = payments.createConnectedAccount("connect-account-" + seller.id(), iso2.trim(),
                    businessType, seller.legalName(), Map.of("seller_id", seller.id().toString()));
            jdbc.update("INSERT INTO seller_payment_accounts(seller_id,provider_key,connected_account_id,account_country_id,"
                    + "account_type,onboarding_status) VALUES(?,?,?,?,?,'PENDING')", seller.id(), payments.key(), accountId,
                    seller.legalCountryId(), "express".equals(properties.stripe().accountType()) ? "EXPRESS"
                            : "standard".equals(properties.stripe().accountType()) ? "STANDARD" : "OTHER");
            jdbc.update("UPDATE marketplace_sellers SET verification_status='PENDING',updated_at=now() WHERE id=? "
                    + "AND verification_status='NOT_STARTED'", seller.id());
        }
        if (properties.connectReturnUrl() == null || properties.connectRefreshUrl() == null) {
            throw unavailable("PAYMENT_ONBOARDING_RETURN_URL_NOT_CONFIGURED");
        }
        var link = payments.accountLink(accountId, properties.connectReturnUrl(), properties.connectRefreshUrl());
        return new OnboardingLink(link.url(), link.expiresAt());
    }

    /** Applies verified provider account state; called from status refresh and signed webhooks. */
    @Transactional
    public void syncAccount(PaymentProvider.ConnectedAccountStatus status) {
        String onboarding = status.disabled() && status.detailsSubmitted() ? "RESTRICTED"
                : status.chargesEnabled() && status.payoutsEnabled() ? "COMPLETE"
                : status.detailsSubmitted() ? "RESTRICTED" : "PENDING";
        UUID sellerId = jdbc.query("UPDATE seller_payment_accounts SET onboarding_status=?,charges_enabled=?,payouts_enabled=?,"
                + "details_submitted=?,requirements_due=?::jsonb,last_synced_at=now(),updated_at=now() "
                + "WHERE provider_key=? AND connected_account_id=? RETURNING seller_id", rs -> rs.next()
                        ? rs.getObject(1, UUID.class) : null, onboarding, status.chargesEnabled(), status.payoutsEnabled(),
                status.detailsSubmitted(), ShopSupport.json(status.requirementsDue()), payments.key(), status.accountId());
        if (sellerId != null) {
            String verification = "COMPLETE".equals(onboarding) ? "VERIFIED" : "RESTRICTED".equals(onboarding) ? "RESTRICTED" : "PENDING";
            jdbc.update("UPDATE marketplace_sellers SET verification_status=?,updated_at=now() WHERE id=?", verification, sellerId);
        }
    }

    public AddressView addressView(UUID addressId) {
        return jdbc.query("SELECT " + ADDRESS_COLS + " FROM addresses a JOIN countries c ON c.id=a.country_id WHERE a.id=?",
                (rs, i) -> ShopSupport.address(rs), addressId).stream().findFirst().orElse(null);
    }
}
