package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.SellerAccessPolicy.SHOP_ADMIN;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.map;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.trim;

import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingConfig;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingMethodInput;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingMethodView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingProfile;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingRules;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingZoneView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ZoneCountry;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seller shipping configuration: zones (destination countries) and methods with their
 * pricing rules. SHIPPO_CALCULATED methods are only configurable when the provider is
 * configured — the checkout quote does the real per-seller availability check.
 */
@Service
public class ShippingConfigService {
    private static final Set<String> METHOD_TYPES = Set.of("FLAT_RATE", "WEIGHT_BASED", "FREE",
            "FREE_ABOVE_THRESHOLD", "SHIPPO_CALCULATED", "EXTERNAL_CARRIER");

    private final JdbcTemplate jdbc;
    private final SellerAccessPolicy policy;
    private final SellerService sellers;
    private final ShippingQuoteService quotes;

    public ShippingConfigService(ShopSupport support, SellerAccessPolicy policy, SellerService sellers,
            ShippingQuoteService quotes) {
        this.jdbc = support.jdbc();
        this.policy = policy;
        this.sellers = sellers;
        this.quotes = quotes;
    }

    public ShippingConfig config(UUID actor, UUID shopId) {
        policy.requireShop(actor, shopId, null);
        ShippingProfile profile = sellers.shippingProfile(shopId);
        List<ShippingZoneView> zones = jdbc.query("SELECT id,zone_name FROM shipping_zones WHERE shop_id=? "
                + "AND status='ACTIVE' ORDER BY zone_name", (rs, i) -> new ShippingZoneView(rs.getObject(1, UUID.class),
                        rs.getString(2), "ACTIVE", List.of(), List.of()), shopId);
        Map<UUID, List<ZoneCountry>> zoneCountries = new LinkedHashMap<>();
        jdbc.query("SELECT zc.shipping_zone_id,c.id,c.name,c.iso2 FROM shipping_zone_countries zc JOIN countries c "
                + "ON c.id=zc.country_id WHERE zc.shipping_zone_id IN (SELECT id FROM shipping_zones WHERE shop_id=? "
                + "AND status='ACTIVE') ORDER BY c.name", rs -> {
                    zoneCountries.computeIfAbsent(rs.getObject(1, UUID.class), k -> new java.util.ArrayList<>())
                            .add(new ZoneCountry(rs.getObject(2, UUID.class), rs.getString(3), rs.getString(4)));
                }, shopId);
        Map<UUID, List<ShippingMethodView>> methods = new LinkedHashMap<>();
        jdbc.query("SELECT m.id,m.shipping_zone_id,m.method_name,m.method_type,m.currency_code::text,m.status "
                + "FROM shipping_methods m WHERE m.shop_id=? AND m.status='ACTIVE' ORDER BY m.method_name", rs -> {
                    UUID zoneId = rs.getObject(2, UUID.class);
                    methods.computeIfAbsent(zoneId, k -> new java.util.ArrayList<>())
                            .add(new ShippingMethodView(rs.getObject(1, UUID.class), zoneId, rs.getString(3),
                                    rs.getString(4), rs.getString(5), rs.getString(6), rules(rs.getObject(1, UUID.class))));
                }, shopId);
        List<ShippingZoneView> filled = zones.stream().map(z -> new ShippingZoneView(z.id(), z.name(), z.status(),
                zoneCountries.getOrDefault(z.id(), List.of()), methods.getOrDefault(z.id(), List.of()))).toList();
        return new ShippingConfig(profile, filled, quotes.shippoAvailable());
    }

    private ShippingRules rules(UUID methodId) {
        Map<String, Object> r = new LinkedHashMap<>();
        Integer[] transit = {null, null};
        jdbc.query("SELECT rule_type,minimum_order_amount_minor,maximum_weight_grams,rate_amount_minor,conditions::text "
                + "FROM shipping_method_rules WHERE shipping_method_id=? ORDER BY priority DESC", rs -> {
                    switch (rs.getString(1)) {
                        case "BASE_RATE" -> {
                            r.put("base", rs.getObject(4, Long.class));
                            Map<String, Object> c = map(rs.getString(5));
                            if (c.get("transitMinDays") instanceof Number n) {
                                transit[0] = n.intValue();
                            }
                            if (c.get("transitMaxDays") instanceof Number n) {
                                transit[1] = n.intValue();
                            }
                        }
                        case "PER_WEIGHT" -> r.put("perKg", rs.getObject(4, Long.class));
                        case "FREE_ABOVE_AMOUNT" -> r.put("freeAbove", rs.getObject(2, Long.class));
                        case "MAX_WEIGHT" -> r.put("maxWeight", rs.getObject(3, Integer.class));
                        default -> {
                        }
                    }
                }, methodId);
        return new ShippingRules((Long) r.get("base"), (Long) r.get("perKg"), (Long) r.get("freeAbove"),
                (Integer) r.get("maxWeight"), transit[0], transit[1]);
    }

    @Transactional
    public ShippingZoneView saveZone(UUID actor, UUID shopId, UUID zoneId, String name, List<UUID> countryIds) {
        policy.requireShop(actor, shopId, SHOP_ADMIN);
        String zoneName = trim(name);
        if (zoneName == null || zoneName.length() > 120) {
            throw badRequest("ZONE_NAME_REQUIRED");
        }
        if (countryIds == null || countryIds.isEmpty()) {
            throw badRequest("ZONE_COUNTRIES_REQUIRED");
        }
        for (UUID countryId : countryIds.stream().distinct().toList()) {
            if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM countries WHERE id=?)",
                    Boolean.class, countryId))) {
                throw badRequest("COUNTRY_NOT_FOUND");
            }
        }
        final UUID id = zoneId == null ? UUID.randomUUID() : zoneId;
        try {
            if (zoneId == null) {
                jdbc.update("INSERT INTO shipping_zones(id,shop_id,zone_name) VALUES(?,?,?)", id, shopId, zoneName);
            } else {
                if (jdbc.update("UPDATE shipping_zones SET zone_name=?,status='ACTIVE',updated_at=now() WHERE id=? "
                        + "AND shop_id=?", zoneName, id, shopId) == 0) {
                    throw notFound("ZONE_NOT_FOUND");
                }
            }
        } catch (DuplicateKeyException e) {
            throw conflict("ZONE_NAME_EXISTS");
        }
        jdbc.update("DELETE FROM shipping_zone_countries WHERE shipping_zone_id=?", id);
        for (UUID countryId : countryIds.stream().distinct().toList()) {
            jdbc.update("INSERT INTO shipping_zone_countries(shipping_zone_id,country_id) VALUES(?,?)", id, countryId);
        }
        return config(actor, shopId).zones().stream().filter(z -> z.id().equals(id)).findFirst().orElseThrow();
    }

    @Transactional
    public void deleteZone(UUID actor, UUID shopId, UUID zoneId) {
        policy.requireShop(actor, shopId, SHOP_ADMIN);
        jdbc.update("UPDATE shipping_methods SET status='INACTIVE',updated_at=now() WHERE shipping_zone_id=? AND shop_id=?",
                zoneId, shopId);
        if (jdbc.update("UPDATE shipping_zones SET status='INACTIVE',updated_at=now() WHERE id=? AND shop_id=?",
                zoneId, shopId) == 0) {
            throw notFound("ZONE_NOT_FOUND");
        }
    }

    @Transactional
    public ShippingMethodView saveMethod(UUID actor, UUID shopId, UUID zoneId, UUID methodId, ShippingMethodInput in) {
        policy.requireShop(actor, shopId, SHOP_ADMIN);
        if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM shipping_zones WHERE id=? AND shop_id=? "
                + "AND status='ACTIVE')", Boolean.class, zoneId, shopId))) {
            throw notFound("ZONE_NOT_FOUND");
        }
        if (in == null || trim(in.name()) == null || in.name().trim().length() > 120) {
            throw badRequest("METHOD_NAME_REQUIRED");
        }
        String type = in.methodType() == null ? "" : in.methodType().toUpperCase();
        if (!METHOD_TYPES.contains(type)) {
            throw badRequest("INVALID_METHOD_TYPE");
        }
        ShippingRules rules = in.rules() == null ? new ShippingRules(null, null, null, null, null, null) : in.rules();
        switch (type) {
            case "FLAT_RATE" -> {
                if (rules.baseRateMinor() == null || rules.baseRateMinor() < 0) {
                    throw badRequest("BASE_RATE_REQUIRED");
                }
            }
            case "WEIGHT_BASED" -> {
                if (rules.baseRateMinor() == null || rules.perKgRateMinor() == null) {
                    throw badRequest("WEIGHT_RATES_REQUIRED");
                }
            }
            case "FREE_ABOVE_THRESHOLD" -> {
                if (rules.freeAboveMinor() == null || rules.freeAboveMinor() <= 0) {
                    throw badRequest("FREE_THRESHOLD_REQUIRED");
                }
            }
            case "SHIPPO_CALCULATED" -> {
                if (!quotes.shippoAvailable()) {
                    throw conflict("SHIPPING_PROVIDER_UNAVAILABLE");
                }
                if (!Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM shop_shipping_profiles "
                        + "WHERE shop_id=? AND status='ACTIVE')", Boolean.class, shopId))) {
                    throw badRequest("SHOP_SHIPPING_PROFILE_REQUIRED");
                }
            }
            default -> {
            }
        }
        String currency = in.currencyCode() == null ? null : in.currencyCode().toUpperCase();
        if (Set.of("FLAT_RATE", "WEIGHT_BASED", "FREE_ABOVE_THRESHOLD").contains(type)
                && (currency == null || !currency.matches("^[A-Z]{3}$"))) {
            throw badRequest("METHOD_CURRENCY_REQUIRED");
        }
        final UUID id = methodId == null ? UUID.randomUUID() : methodId;
        try {
            if (methodId == null) {
                jdbc.update("INSERT INTO shipping_methods(id,shop_id,shipping_zone_id,method_name,method_type,"
                        + "currency_code) VALUES(?,?,?,?,?,?)", id, shopId, zoneId, in.name().trim(), type, currency);
            } else {
                if (jdbc.update("UPDATE shipping_methods SET shipping_zone_id=?,method_name=?,method_type=?,"
                        + "currency_code=?,status='ACTIVE',updated_at=now() WHERE id=? AND shop_id=?",
                        zoneId, in.name().trim(), type, currency, id, shopId) == 0) {
                    throw notFound("METHOD_NOT_FOUND");
                }
            }
        } catch (DuplicateKeyException e) {
            throw conflict("METHOD_NAME_EXISTS");
        }
        jdbc.update("DELETE FROM shipping_method_rules WHERE shipping_method_id=?", id);
        Map<String, Object> conditions = new LinkedHashMap<>();
        if (rules.transitMinDays() != null) {
            conditions.put("transitMinDays", rules.transitMinDays());
        }
        if (rules.transitMaxDays() != null) {
            conditions.put("transitMaxDays", rules.transitMaxDays());
        }
        if (rules.baseRateMinor() != null) {
            jdbc.update("INSERT INTO shipping_method_rules(shipping_method_id,rule_type,rate_amount_minor,conditions,"
                    + "priority) VALUES(?,'BASE_RATE',?,?::jsonb,0)", id, rules.baseRateMinor(), ShopSupport.json(conditions));
        }
        if (rules.perKgRateMinor() != null) {
            jdbc.update("INSERT INTO shipping_method_rules(shipping_method_id,rule_type,rate_amount_minor,priority) "
                    + "VALUES(?,'PER_WEIGHT',?,1)", id, rules.perKgRateMinor());
        }
        if (rules.freeAboveMinor() != null) {
            jdbc.update("INSERT INTO shipping_method_rules(shipping_method_id,rule_type,minimum_order_amount_minor,"
                    + "priority) VALUES(?,'FREE_ABOVE_AMOUNT',?,2)", id, rules.freeAboveMinor());
        }
        if (rules.maxWeightGrams() != null) {
            jdbc.update("INSERT INTO shipping_method_rules(shipping_method_id,rule_type,maximum_weight_grams,priority) "
                    + "VALUES(?,'MAX_WEIGHT',?,3)", id, rules.maxWeightGrams());
        }
        return config(actor, shopId).zones().stream().flatMap(z -> z.methods().stream())
                .filter(m -> m.id().equals(id)).findFirst().orElseThrow();
    }

    @Transactional
    public void deleteMethod(UUID actor, UUID shopId, UUID methodId) {
        policy.requireShop(actor, shopId, SHOP_ADMIN);
        if (jdbc.update("UPDATE shipping_methods SET status='INACTIVE',updated_at=now() WHERE id=? AND shop_id=?",
                methodId, shopId) == 0) {
            throw notFound("METHOD_NOT_FOUND");
        }
    }
}
