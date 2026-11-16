package com.diasporum.backend.shopmarketplace.internal.infrastructure.shipping;

import com.diasporum.backend.shopmarketplace.internal.application.ShippingProvider;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Seller-managed external carrier shipping. It never quotes provider rates and never claims a
 * label exists; sellers enter the carrier, tracking number and tracking URL themselves.
 */
@Component
public class ManualShippingProvider implements ShippingProvider {

    @Override
    public String key() {
        return "MANUAL";
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public List<ProviderRate> rates(ShipAddress from, ShipAddress to, List<Parcel> parcels) {
        return List.of();
    }

    @Override
    public PurchasedLabel purchaseLabel(String rateId, String idempotencyKey) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MANUAL_SHIPPING_HAS_NO_LABELS");
    }

    @Override
    public String labelUrl(String providerTransactionId) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MANUAL_SHIPPING_HAS_NO_LABELS");
    }

    @Override
    public boolean voidLabel(String providerTransactionId) {
        return false;
    }

    @Override
    public TrackingUpdate parseTrackingWebhook(Map<String, Object> payload) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MANUAL_SHIPPING_HAS_NO_WEBHOOKS");
    }
}
