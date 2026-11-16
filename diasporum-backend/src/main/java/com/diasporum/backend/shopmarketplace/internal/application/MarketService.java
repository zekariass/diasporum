package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.badRequest;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.forbidden;
import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.notFound;

import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Market;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Country-aware market readiness. A countries row alone never enables the marketplace:
 * {@code marketplace_country_settings} decides browsing, checkout and seller onboarding.
 * The active Diasporum community is deliberately NOT consulted.
 */
@Service
public class MarketService {
    private static final String COLS = "m.country_id,c.name,c.iso2,c.flag_emoji,m.market_status,"
            + "m.buyer_checkout_enabled,m.seller_onboarding_enabled,m.shipping_enabled,m.tax_enabled,"
            + "m.default_currency,m.supported_currencies,m.disabled_reason";

    private final JdbcTemplate jdbc;

    public MarketService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Markets that are at least browsable, plus suspended ones so clients can explain state. */
    public List<Market> markets() {
        return jdbc.query("SELECT " + COLS + " FROM marketplace_country_settings m "
                + "JOIN countries c ON c.id=m.country_id WHERE m.market_status<>'DISABLED' "
                + "ORDER BY c.name", MarketService::market);
    }

    public Market market(UUID countryId) {
        return jdbc.query("SELECT " + COLS + " FROM marketplace_country_settings m "
                + "JOIN countries c ON c.id=m.country_id WHERE m.country_id=?", MarketService::market, countryId)
                .stream().findFirst().orElseThrow(() -> notFound("MARKET_NOT_FOUND"));
    }

    /** Browsing requires BROWSING_ONLY or ACTIVE. */
    public Market requireBrowsable(UUID countryId) {
        if (countryId == null) {
            throw badRequest("MARKET_REQUIRED");
        }
        Market market = market(countryId);
        if (!"ACTIVE".equals(market.marketStatus()) && !"BROWSING_ONLY".equals(market.marketStatus())) {
            throw forbidden("SUSPENDED".equals(market.marketStatus()) ? "MARKET_SUSPENDED" : "MARKET_UNAVAILABLE");
        }
        return market;
    }

    public Market requireCheckout(UUID countryId) {
        Market market = requireBrowsable(countryId);
        if (!market.buyerCheckoutEnabled()) {
            throw forbidden("CHECKOUT_UNAVAILABLE_IN_MARKET");
        }
        return market;
    }

    /** Resolves the browsing currency: requested (if supported) or the market default. */
    public String currency(Market market, String requested) {
        if (requested != null && !requested.isBlank()) {
            String code = requested.trim().toUpperCase();
            if (!market.supportedCurrencies().contains(code)) {
                throw badRequest("CURRENCY_NOT_SUPPORTED_IN_MARKET");
            }
            return code;
        }
        if (market.defaultCurrency() == null) {
            throw badRequest("MARKET_CURRENCY_NOT_CONFIGURED");
        }
        return market.defaultCurrency();
    }

    static Market market(ResultSet rs, int row) throws SQLException {
        Array currencies = rs.getArray("supported_currencies");
        List<String> codes = currencies == null ? List.of()
                : Arrays.stream((Object[]) currencies.getArray()).map(String::valueOf).toList();
        String defaultCurrency = rs.getString("default_currency");
        return new Market(rs.getObject("country_id", UUID.class), rs.getString("name"), rs.getString("iso2"),
                rs.getString("flag_emoji"), rs.getString("market_status"), rs.getBoolean("buyer_checkout_enabled"),
                rs.getBoolean("seller_onboarding_enabled"), rs.getBoolean("shipping_enabled"),
                rs.getBoolean("tax_enabled"), defaultCurrency == null ? null : defaultCurrency.trim(), codes,
                rs.getString("disabled_reason"));
    }
}
