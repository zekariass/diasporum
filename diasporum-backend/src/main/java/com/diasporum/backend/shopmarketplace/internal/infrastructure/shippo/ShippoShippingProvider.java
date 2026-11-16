package com.diasporum.backend.shopmarketplace.internal.infrastructure.shippo;

import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.arr;
import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.lng;
import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.obj;
import static com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.str;

import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider;
import com.diasporum.backend.shopmarketplace.internal.application.ShopProperties;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Money;
import com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp;
import com.diasporum.backend.shopmarketplace.internal.infrastructure.ProviderHttp.ProviderException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Shippo REST adapter (rates, label purchase, label URL refresh, void, tracking webhooks).
 * Only rates actually returned by Shippo for the route are exposed; coverage is never assumed.
 */
@Component
public class ShippoShippingProvider implements ShippingProvider {
    private final ShopProperties.Shippo config;

    public ShippoShippingProvider(ShopProperties properties) {
        this.config = properties.shippo();
    }

    @Override
    public String key() {
        return "SHIPPO";
    }

    @Override
    public boolean available() {
        return config.configured();
    }

    private Map<String, Object> call(String method, String path, Object body) {
        if (!available()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "SHIPPING_PROVIDER_UNAVAILABLE");
        }
        return ProviderHttp.send(method, config.base() + path,
                Map.of("Authorization", "ShippoToken " + config.apiToken()), "application/json",
                body == null ? null : ProviderHttp.json(body));
    }

    private static Map<String, Object> address(ShipAddress a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", a.name());
        m.put("street1", a.street1());
        if (a.street2() != null) {
            m.put("street2", a.street2());
        }
        m.put("city", a.city());
        if (a.state() != null) {
            m.put("state", a.state());
        }
        if (a.postalCode() != null) {
            m.put("zip", a.postalCode());
        }
        m.put("country", a.countryIso2());
        if (a.phone() != null) {
            m.put("phone", a.phone());
        }
        return m;
    }

    private static String cm(int mm) {
        return BigDecimal.valueOf(mm).movePointLeft(1).setScale(1, RoundingMode.HALF_UP).toPlainString();
    }

    @Override
    public List<ProviderRate> rates(ShipAddress from, ShipAddress to, List<Parcel> parcels) {
        List<Map<String, Object>> parcelBodies = new ArrayList<>();
        for (Parcel p : parcels) {
            parcelBodies.add(Map.of("length", cm(p.lengthMm()), "width", cm(p.widthMm()), "height", cm(p.heightMm()),
                    "distance_unit", "cm", "weight", String.valueOf(p.weightGrams()), "mass_unit", "g"));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("address_from", address(from));
        body.put("address_to", address(to));
        body.put("parcels", parcelBodies);
        body.put("async", false);
        Map<String, Object> shipment;
        try {
            shipment = call("POST", "/shipments/", body);
        } catch (ProviderException e) {
            return List.of();
        }
        List<ProviderRate> rates = new ArrayList<>();
        for (Object item : arr(shipment.get("rates"))) {
            Map<String, Object> rate = obj(item);
            String currency = str(rate.get("currency"));
            String amount = str(rate.get("amount"));
            if (currency == null || amount == null) {
                continue;
            }
            Map<String, Object> level = obj(rate.get("servicelevel"));
            long minor = new BigDecimal(amount).movePointRight(Money.exponent(currency))
                    .setScale(0, RoundingMode.HALF_UP).longValueExact();
            Long days = lng(rate.get("estimated_days"));
            rates.add(new ProviderRate(str(rate.get("object_id")), str(rate.get("provider")), str(level.get("name")),
                    str(level.get("token")), minor, currency.toUpperCase(), days == null ? null : days.intValue()));
        }
        return rates;
    }

    @Override
    public PurchasedLabel purchaseLabel(String rateId, String idempotencyKey) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("rate", rateId);
        body.put("label_file_type", "PDF");
        body.put("async", false);
        body.put("metadata", idempotencyKey);
        try {
            Map<String, Object> tx = call("POST", "/transactions/", body);
            if (!"SUCCESS".equals(tx.get("status"))) {
                String message = arr(tx.get("messages")).stream().map(m -> str(obj(m).get("text")))
                        .filter(java.util.Objects::nonNull).findFirst().orElse("Label purchase failed");
                return new PurchasedLabel("FAILED", str(tx.get("object_id")), null, null, null, null, null, null, null, message);
            }
            Map<String, Object> rate = obj(tx.get("rate"));
            return new PurchasedLabel("PURCHASED", str(tx.get("object_id")), str(tx.get("object_id")),
                    str(tx.get("tracking_number")), str(tx.get("tracking_url_provider")), str(rate.get("provider")),
                    str(obj(rate.get("servicelevel")).get("name")), null, null, null);
        } catch (ProviderException e) {
            return new PurchasedLabel("FAILED", null, null, null, null, null, null, null, null,
                    "Shippo rejected the label purchase (" + e.status() + ")");
        }
    }

    @Override
    public String labelUrl(String providerTransactionId) {
        return str(call("GET", "/transactions/" + providerTransactionId, null).get("label_url"));
    }

    @Override
    public boolean voidLabel(String providerTransactionId) {
        try {
            String status = str(call("POST", "/refunds/", Map.of("transaction", providerTransactionId, "async", false))
                    .get("status"));
            return !"ERROR".equals(status);
        } catch (ProviderException e) {
            return false;
        }
    }

    @Override
    public TrackingUpdate parseTrackingWebhook(Map<String, Object> payload) {
        Map<String, Object> data = obj(payload.get("data"));
        List<TrackingEvent> events = new ArrayList<>();
        List<Object> history = new ArrayList<>(arr(data.get("tracking_history")));
        Map<String, Object> current = obj(data.get("tracking_status"));
        if (!current.isEmpty()) {
            history.add(current);
        }
        for (Object item : history) {
            Map<String, Object> e = obj(item);
            Map<String, Object> loc = obj(e.get("location"));
            String location = loc.isEmpty() ? null : String.join(", ", java.util.stream.Stream.of(
                    str(loc.get("city")), str(loc.get("state")), str(loc.get("country")))
                    .filter(s -> s != null && !s.isBlank()).toList());
            Instant at;
            try {
                at = OffsetDateTime.parse(str(e.get("status_date"))).toInstant();
            } catch (Exception ex) {
                at = Instant.now();
            }
            String id = str(e.get("object_id"));
            events.add(new TrackingEvent(id == null ? str(e.get("status")) + ":" + at : id, str(e.get("status")),
                    str(e.get("status_details")) == null ? str(e.get("status")) : str(e.get("status_details")),
                    location, at));
        }
        return new TrackingUpdate(str(data.get("tracking_number")), str(data.get("carrier")),
                str(current.get("status")), events);
    }

    @Override
    public TrackingUpdate fetchTracking(String carrier, String trackingNumber) {
        try {
            return parseTrackingWebhook(Map.of("data", call("GET", "/tracks/" + carrier + "/" + trackingNumber, null)));
        } catch (ProviderException e) {
            return null;
        }
    }
}
