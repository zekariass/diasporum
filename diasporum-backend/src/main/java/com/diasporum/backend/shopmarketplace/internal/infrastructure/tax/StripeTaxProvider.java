package com.diasporum.backend.shopmarketplace.internal.infrastructure.tax;

import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.arr;
import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.lng;
import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.obj;
import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.str;

import com.diasporum.backend.shopmarketplace.internal.application.ShopProperties;
import com.diasporum.backend.shopmarketplace.internal.application.TaxProvider;
import com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stripe Tax calculation adapter (provider key {@code STRIPE_TAX}). Shipping is sent as
 * separate line items so each seller's shipping tax is attributable to that seller order.
 */
@Component
public class StripeTaxProvider implements TaxProvider {
    private static final String SHIPPING_TAX_CODE = "txcd_92010001";
    private final ShopProperties.Stripe config;

    public StripeTaxProvider(ShopProperties properties) {
        this.config = properties.stripe();
    }

    @Override
    public String key() {
        return "STRIPE_TAX";
    }

    @Override
    public boolean available() {
        return config.configured();
    }

    @Override
    public TaxResult calculate(TaxRequest request, Map<String, Object> configuration) {
        if (!available()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "TAX_PROVIDER_UNAVAILABLE");
        }
        List<String[]> form = ProviderHttp.pairs();
        form.add(new String[] {"currency", request.currency().toLowerCase()});
        form.add(new String[] {"customer_details[address_source]", "shipping"});
        put(form, "customer_details[address][country]", request.destination().countryIso2());
        put(form, "customer_details[address][postal_code]", request.destination().postalCode());
        put(form, "customer_details[address][city]", request.destination().city());
        put(form, "customer_details[address][state]", request.destination().region());
        put(form, "customer_details[address][line1]", request.destination().line1());
        int i = 0;
        for (TaxLine line : request.lines()) {
            String p = "line_items[" + i++ + "]";
            put(form, p + "[amount]", String.valueOf(line.amountMinor()));
            put(form, p + "[quantity]", String.valueOf(line.quantity()));
            put(form, p + "[reference]", line.reference());
            put(form, p + "[tax_behavior]", "exclusive");
            put(form, p + "[tax_code]", line.taxCode());
        }
        for (TaxShipping shipping : request.shipping()) {
            String p = "line_items[" + i++ + "]";
            put(form, p + "[amount]", String.valueOf(shipping.amountMinor()));
            put(form, p + "[reference]", shipping.reference());
            put(form, p + "[tax_behavior]", "exclusive");
            put(form, p + "[tax_code]", SHIPPING_TAX_CODE);
        }
        Map<String, String> headers = Map.of("Authorization", "Bearer " + config.secretKey());
        Map<String, Object> calculation;
        try {
            calculation = ProviderHttp.send("POST", config.base() + "/v1/tax/calculations", headers,
                    "application/x-www-form-urlencoded", ProviderHttp.form(form));
        } catch (ProviderHttp.ProviderException e) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "TAX_CALCULATION_FAILED");
        }
        String id = str(calculation.get("id"));
        Map<String, Object> lineItems = ProviderHttp.send("GET", config.base() + "/v1/tax/calculations/" + id
                + "/line_items?limit=100", headers, null, null);
        Map<String, LineTax> lines = new HashMap<>();
        Map<String, LineTax> shipping = new HashMap<>();
        for (Object item : arr(lineItems.get("data"))) {
            Map<String, Object> line = obj(item);
            String reference = str(line.get("reference"));
            long amount = lng(line.get("amount_tax")) == null ? 0 : lng(line.get("amount_tax"));
            Map<String, Object> breakdown = obj(arr(line.get("tax_breakdown")).stream().findFirst().orElse(null));
            Map<String, Object> jurisdiction = obj(breakdown.get("jurisdiction"));
            Map<String, Object> rate = obj(breakdown.get("tax_rate_details"));
            String pct = str(rate.get("percentage_decimal"));
            LineTax tax = new LineTax(amount, pct == null ? BigDecimal.ZERO : new BigDecimal(pct).movePointLeft(2),
                    str(jurisdiction.get("country")) == null ? request.destination().countryIso2()
                            : str(jurisdiction.get("country")) + (str(jurisdiction.get("state")) == null ? ""
                                    : "-" + str(jurisdiction.get("state"))),
                    mapType(str(rate.get("tax_type"))));
            (reference != null && reference.startsWith("ship:") ? shipping : lines).put(reference, tax);
        }
        Long total = lng(calculation.get("tax_amount_exclusive"));
        return new TaxResult(id, lines, shipping, total == null ? 0 : total, "PROVIDER", "Stripe Tax calculation " + id);
    }

    private static void put(List<String[]> form, String key, String value) {
        if (value != null && !value.isBlank()) {
            form.add(new String[] {key, value});
        }
    }

    private static String mapType(String stripeType) {
        if (stripeType == null) {
            return "OTHER";
        }
        return switch (stripeType) {
            case "vat" -> "VAT";
            case "gst" -> "GST";
            case "sales_tax" -> "SALES_TAX";
            default -> "OTHER";
        };
    }
}
