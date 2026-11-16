package com.diasporum.backend.shopmarketplace.internal.application;

import static com.diasporum.backend.shopmarketplace.internal.application.ShopSupport.conflict;

import com.diasporum.backend.shopmarketplace.internal.application.TaxProvider.TaxAddress;
import com.diasporum.backend.shopmarketplace.internal.application.TaxProvider.TaxLine;
import com.diasporum.backend.shopmarketplace.internal.application.TaxProvider.TaxRequest;
import com.diasporum.backend.shopmarketplace.internal.application.TaxProvider.TaxResult;
import com.diasporum.backend.shopmarketplace.internal.application.TaxProvider.TaxShipping;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.AddressView;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Provider-backed tax only. The enabled provider configuration for the market decides which
 * adapter runs; when tax is required but no provider is configured or reachable the checkout
 * fails closed instead of silently applying zero tax.
 */
@Service
public class TaxService {
    private final JdbcTemplate jdbc;
    private final ShopProperties properties;
    private final List<TaxProvider> providers;

    public TaxService(ShopSupport support, ShopProperties properties, List<TaxProvider> providers) {
        this.jdbc = support.jdbc();
        this.properties = properties;
        this.providers = providers;
    }

    public boolean taxRequired(UUID marketCountryId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT tax_enabled FROM marketplace_country_settings WHERE country_id=?",
                Boolean.class, marketCountryId));
    }

    private record Config(String providerKey, Map<String, Object> configuration) {
    }

    private Config config(UUID marketCountryId) {
        List<Object[]> rows = jdbc.query("SELECT provider_key,non_secret_configuration::text FROM tax_provider_configurations "
                + "WHERE is_enabled AND environment=? AND (country_id=? OR country_id IS NULL) "
                + "ORDER BY (country_id IS NOT NULL) DESC LIMIT 2", rs -> {
                    List<Object[]> list = new java.util.ArrayList<>();
                    while (rs.next()) {
                        list.add(new Object[] {rs.getString(1), ShopSupport.map(rs.getString(2))});
                    }
                    return list;
                }, properties.taxEnvironment(), marketCountryId);
        if (rows == null || rows.isEmpty()) {
            return null;
        }
        return new Config((String) rows.getFirst()[0], cast(rows.getFirst()[1]));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> cast(Object o) {
        return (Map<String, Object>) o;
    }

    /** Calculates tax or throws TAX_UNAVAILABLE — never silently zero. */
    public TaxResult calculate(UUID marketCountryId, String currency, AddressView destination, List<TaxLine> lines,
            List<TaxShipping> shipping) {
        Config config = config(marketCountryId);
        if (config == null) {
            throw conflict("TAX_PROVIDER_NOT_CONFIGURED");
        }
        TaxProvider provider = providers.stream().filter(p -> p.key().equals(config.providerKey())).findFirst()
                .orElseThrow(() -> conflict("TAX_PROVIDER_NOT_CONFIGURED"));
        if (!provider.available()) {
            throw conflict("TAX_PROVIDER_UNAVAILABLE");
        }
        TaxAddress address = new TaxAddress(destination.countryCode(), destination.postalCode(), destination.city(),
                destination.region(), destination.line1());
        try {
            return provider.calculate(new TaxRequest(currency, address, lines, shipping), config.configuration());
        } catch (org.springframework.web.server.ResponseStatusException e) {
            throw e;
        } catch (RuntimeException e) {
            throw conflict("TAX_CALCULATION_FAILED");
        }
    }

    /** Persists one calculation snapshot; individual lines are linked at order creation. */
    public UUID persist(UUID checkoutSessionId, UUID orderId, String providerKey, TaxResult result, String currency,
            long taxableSubtotalMinor, long shippingTaxableMinor) {
        jdbc.update("INSERT INTO tax_calculations(id,checkout_session_id,order_id,provider_key,provider_calculation_id,"
                + "currency_code,taxable_subtotal_minor,shipping_taxable_minor,total_tax_minor,status) "
                + "VALUES(?,?,?,?,?,?,?,?,?,'CALCULATED') ON CONFLICT(provider_key,provider_calculation_id) DO NOTHING",
                UUID.randomUUID(), checkoutSessionId, orderId, providerKey, result.providerCalculationId(), currency,
                taxableSubtotalMinor, shippingTaxableMinor, result.totalTaxMinor());
        return jdbc.queryForObject("SELECT id FROM tax_calculations WHERE provider_key=? AND provider_calculation_id=?",
                UUID.class, providerKey, result.providerCalculationId());
    }

    /** Commits the stored calculation once the order exists and links per-item tax lines. */
    public void commit(UUID taxCalculationId, UUID orderId, Map<UUID, TaxProvider.LineTax> itemTaxes,
            Map<UUID, TaxProvider.LineTax> sellerOrderShippingTaxes, Map<UUID, UUID> itemToSellerOrder,
            Map<UUID, UUID> sellerOrderSeller, String currency) {
        jdbc.update("UPDATE tax_calculations SET order_id=?,status='COMMITTED',committed_at=now() WHERE id=?", orderId,
                taxCalculationId);
        itemTaxes.forEach((orderItemId, tax) -> insertLine(taxCalculationId, orderItemId,
                itemToSellerOrder.get(orderItemId), "ITEM", tax, currency, sellerOrderSeller.get(itemToSellerOrder.get(orderItemId))));
        sellerOrderShippingTaxes.forEach((sellerOrderId, tax) -> insertLine(taxCalculationId, null, sellerOrderId, "SHIPPING",
                tax, currency, sellerOrderSeller.get(sellerOrderId)));
    }

    private void insertLine(UUID calculationId, UUID orderItemId, UUID sellerOrderId, String chargeType,
            TaxProvider.LineTax tax, String currency, UUID sellerId) {
        jdbc.update("INSERT INTO tax_calculation_lines(tax_calculation_id,order_item_id,seller_order_id,charge_type,tax_type,"
                + "jurisdiction_code,tax_rate,taxable_amount_minor,tax_amount_minor,currency_code) VALUES(?,?,?,?,?,?,?,?,?,?)",
                calculationId, orderItemId, sellerOrderId, chargeType, tax.taxType() == null ? "OTHER" : tax.taxType(),
                tax.jurisdictionCode() == null ? "UNKNOWN" : tax.jurisdictionCode(), tax.rate(), 0, tax.taxMinor(), currency);
        jdbc.update("INSERT INTO tax_liability_records(tax_calculation_id,seller_order_id,liable_party,liable_seller_id,"
                + "jurisdiction_code,tax_type,decision_source,reason_snapshot) "
                + "SELECT ?,?, CASE WHEN ? IS NULL THEN 'MARKETPLACE' ELSE 'SELLER' END, ?,?,?, 'PROVIDER', ?",
                calculationId, sellerOrderId, sellerId, sellerId,
                tax.jurisdictionCode() == null ? "UNKNOWN" : tax.jurisdictionCode(),
                tax.taxType() == null ? "OTHER" : tax.taxType(), "Provider-calculated tax for checkout line");
    }
}
