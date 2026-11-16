package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.map;

import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider.Parcel;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider.ProviderRate;
import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider.ShipAddress;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressView;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Money;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.ShippingOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Per-seller shipping options at checkout. Rule-based methods (flat, weight, free,
 * free-above-threshold) are priced from shipping_method_rules; SHIPPO_CALCULATED methods are
 * priced live through the backend-only provider adapter and each provider rate is persisted
 * as an immutable shipping_rate_quotes row so the later label purchase references it.
 * Free-shipping thresholds always apply to one seller's eligible subtotal, never the
 * mixed-cart total.
 */
@Service
public class ShippingQuoteService {
    private final JdbcTemplate jdbc;
    private final SellerService sellers;
    private final List<ShippingProvider> providers;
    private final ShopProperties properties;

    public ShippingQuoteService(ShopSupport support, SellerService sellers, List<ShippingProvider> providers,
            ShopProperties properties) {
        this.jdbc = support.jdbc();
        this.sellers = sellers;
        this.providers = providers;
        this.properties = properties;
    }

    ShippingProvider provider(String key) {
        return providers.stream().filter(p -> p.key().equals(key)).findFirst().orElse(null);
    }

    public boolean shippoAvailable() {
        ShippingProvider shippo = provider("SHIPPO");
        return shippo != null && shippo.available();
    }

    record ShipContext(UUID sessionId, UUID destinationCountryId, AddressView destination, String currency) {
    }

    /** All purchasable options for one seller group; persists quote rows for provider rates. */
    public List<ShippingOption> optionsForShop(ShipContext ctx, UUID shopId, long eligibleSubtotalMinor,
            int totalWeightGrams, List<Parcel> parcels, boolean freeShippingCodeApplied) {
        List<UUID> zones = jdbc.queryForList("SELECT DISTINCT z.id FROM shipping_zones z JOIN shipping_zone_countries zc "
                + "ON zc.shipping_zone_id=z.id WHERE z.shop_id=? AND z.status='ACTIVE' AND zc.country_id=?", UUID.class,
                shopId, ctx.destinationCountryId());
        if (zones.isEmpty()) {
            return List.of();
        }
        List<ShippingOption> options = new ArrayList<>();
        Object[] args = new Object[1 + zones.size()];
        args[0] = shopId;
        for (int i = 0; i < zones.size(); i++) {
            args[1 + i] = zones.get(i);
        }
        for (Object[] method : jdbc.query("SELECT m.id,m.method_name,m.method_type,m.currency_code::text FROM shipping_methods m "
                + "WHERE m.shop_id=? AND m.status='ACTIVE' AND m.shipping_zone_id IN (" + ShopSupport.placeholders(zones.size())
                + ") ORDER BY m.method_name", (rs, i) -> new Object[] {rs.getObject(1, UUID.class), rs.getString(2),
                        rs.getString(3), rs.getString(4)}, args)) {
            UUID methodId = (UUID) method[0];
            String type = (String) method[2];
            String methodCurrency = method[3] == null ? null : ((String) method[3]).trim();
            switch (type) {
                case "FREE" -> options.add(option(ctx, shopId, methodId, (String) method[1], type, null, 0, null, null, null));
                case "FREE_ABOVE_THRESHOLD" -> {
                    Long threshold = ruleNumber(methodId, "FREE_ABOVE_AMOUNT", "minimum_order_amount_minor");
                    if (threshold == null) {
                        break;
                    }
                    if (eligibleSubtotalMinor >= threshold) {
                        options.add(option(ctx, shopId, methodId, (String) method[1], type, null, 0, null, null, null));
                    } else {
                        Long base = ruleNumber(methodId, "BASE_RATE", "rate_amount_minor");
                        if (base != null && currencyOk(methodCurrency, ctx.currency())) {
                            options.add(option(ctx, shopId, methodId, (String) method[1], type, null, base, null, null, null));
                        }
                    }
                }
                case "FLAT_RATE", "EXTERNAL_CARRIER" -> {
                    Long base = ruleNumber(methodId, "BASE_RATE", "rate_amount_minor");
                    if ("FLAT_RATE".equals(type) && base == null) {
                        break;
                    }
                    if (currencyOk(methodCurrency, ctx.currency())) {
                        Integer[] transit = transit(methodId);
                        options.add(option(ctx, shopId, methodId, (String) method[1], type, null, base == null ? 0 : base,
                                transit[0], transit[1], null));
                    }
                }
                case "WEIGHT_BASED" -> {
                    Long base = ruleNumber(methodId, "BASE_RATE", "rate_amount_minor");
                    Long perKg = ruleNumber(methodId, "PER_WEIGHT", "rate_amount_minor");
                    Long maxWeight = ruleNumber(methodId, "MAX_WEIGHT", "maximum_weight_grams");
                    if (base == null || perKg == null || (maxWeight != null && totalWeightGrams > maxWeight)
                            || !currencyOk(methodCurrency, ctx.currency())) {
                        break;
                    }
                    long price = base + (long) Math.ceil(totalWeightGrams / 1000.0) * perKg;
                    Integer[] transit = transit(methodId);
                    options.add(option(ctx, shopId, methodId, (String) method[1], type, null, price, transit[0], transit[1], null));
                }
                case "SHIPPO_CALCULATED" -> options.addAll(shippoRates(ctx, shopId, methodId, (String) method[1], parcels));
                default -> {
                }
            }
        }
        if (freeShippingCodeApplied && !options.isEmpty()) {
            options = options.stream().map(o -> new ShippingOption(o.optionKey(), o.methodId(), o.name(), o.methodType(),
                    o.providerKey(), Money.of(0, ctx.currency()), o.estimatedMinDays(), o.estimatedMaxDays()))
                    .sorted(Comparator.comparing(ShippingOption::optionKey)).toList();
        } else {
            options.sort(Comparator.comparing((ShippingOption o) -> o.amount().amountMinor())
                    .thenComparing(ShippingOption::optionKey));
        }
        return options;
    }

    private boolean currencyOk(String methodCurrency, String currency) {
        return methodCurrency == null || methodCurrency.equals(currency);
    }

    private Long ruleNumber(UUID methodId, String ruleType, String column) {
        return jdbc.query("SELECT " + column + " FROM shipping_method_rules WHERE shipping_method_id=? AND rule_type=? "
                + "ORDER BY priority DESC LIMIT 1", rs -> rs.next() ? rs.getObject(1, Long.class) : null, methodId, ruleType);
    }

    private Integer[] transit(UUID methodId) {
        Map<String, Object> conditions = jdbc.query("SELECT conditions::text FROM shipping_method_rules WHERE shipping_method_id=? "
                + "AND rule_type='BASE_RATE' ORDER BY priority DESC LIMIT 1", rs -> rs.next() ? map(rs.getString(1)) : null,
                methodId);
        if (conditions == null) {
            return new Integer[] {null, null};
        }
        return new Integer[] {conditions.get("transitMinDays") instanceof Number n ? n.intValue() : null,
                conditions.get("transitMaxDays") instanceof Number n ? n.intValue() : null};
    }

    private ShippingOption option(ShipContext ctx, UUID shopId, UUID methodId, String name, String type, String providerKey,
            long amount, Integer minDays, Integer maxDays, String providerRateId) {
        String optionKey = providerRateId == null ? "METHOD:" + methodId : "SHIPPO:" + providerRateId;
        persistQuote(ctx.sessionId(), shopId, methodId, providerKey, providerRateId, name, amount, ctx.currency(), minDays,
                maxDays, optionKey);
        return new ShippingOption(optionKey, methodId, name, type, providerKey, Money.of(amount, ctx.currency()), minDays,
                maxDays);
    }

    private List<ShippingOption> shippoRates(ShipContext ctx, UUID shopId, UUID methodId, String methodName,
            List<Parcel> parcels) {
        ShippingProvider shippo = provider("SHIPPO");
        if (shippo == null || !shippo.available()) {
            throw conflict("SHIPPING_PROVIDER_UNAVAILABLE");
        }
        Object[] origin = jdbc.query("SELECT " + ShopSupport.ADDRESS_COLS + " FROM shop_shipping_profiles sp JOIN addresses a "
                + "ON a.id=sp.origin_address_id JOIN countries c ON c.id=a.country_id WHERE sp.shop_id=? AND sp.status='ACTIVE' "
                + "ORDER BY sp.is_default DESC,sp.created_at LIMIT 1", (rs, i) -> new Object[] {ShopSupport.address(rs)}, shopId)
                .stream().findFirst().orElse(null);
        if (origin == null) {
            throw conflict("SHOP_SHIPPING_PROFILE_REQUIRED");
        }
        AddressView from = (AddressView) origin[0];
        String shopName = jdbc.queryForObject("SELECT name FROM shops WHERE id=?", String.class, shopId);
        List<ProviderRate> rates;
        try {
            rates = shippo.rates(new ShipAddress(shopName, from.line1(), from.line2(), from.city(), from.region(),
                    from.postalCode(), from.countryCode(), null), new ShipAddress(null, ctx.destination().line1(),
                    ctx.destination().line2(), ctx.destination().city(), ctx.destination().region(),
                    ctx.destination().postalCode(), ctx.destination().countryCode(), null), parcels);
        } catch (RuntimeException e) {
            throw conflict("SHIPPING_RATES_UNAVAILABLE");
        }
        List<ShippingOption> options = new ArrayList<>();
        for (ProviderRate rate : rates) {
            if (!rate.currency().equalsIgnoreCase(ctx.currency())) {
                continue; // checkout currency is fixed; provider rates in other currencies are not offered
            }
            String name = methodName + " · " + rate.carrier() + " " + rate.serviceName();
            options.add(option(ctx, shopId, methodId, name, "SHIPPO_CALCULATED", "SHIPPO", rate.amountMinor(),
                    rate.estimatedDays(), rate.estimatedDays(), rate.rateId()));
        }
        return options;
    }

    private void persistQuote(UUID sessionId, UUID shopId, UUID methodId, String providerKey, String providerRateId,
            String serviceName, long amount, String currency, Integer minDays, Integer maxDays, String optionKey) {
        jdbc.update("INSERT INTO shipping_rate_quotes(id,checkout_session_id,seller_id,shop_id,shipping_method_id,provider_key,"
                + "provider_rate_id,service_name,amount_minor,currency_code,estimated_min_days,estimated_max_days,quote_payload,"
                + "expires_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,now()+? * interval '1 second'",
                UUID.randomUUID(), sessionId,
                jdbc.queryForObject("SELECT seller_id FROM shops WHERE id=?", UUID.class, shopId), shopId, methodId,
                providerKey, providerRateId,
                serviceName, amount, currency, minDays, maxDays, ShopSupport.json(Map.of("optionKey", optionKey)),
                properties.quoteTtl().toSeconds() + 86400);
    }
}
