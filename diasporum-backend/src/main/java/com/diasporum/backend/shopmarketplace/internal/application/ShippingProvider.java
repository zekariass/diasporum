package com.diasporum.backend.shopmarketplace.internal.application;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Shipping provider port. {@code SHIPPO} calculates rates, buys and voids labels and receives
 * tracking webhooks; {@code MANUAL} represents seller-managed external carriers and never
 * claims a provider label exists. Additional adapters register as Spring beans.
 */
public interface ShippingProvider {

    String key();

    boolean available();

    List<ProviderRate> rates(ShipAddress from, ShipAddress to, List<Parcel> parcels);

    PurchasedLabel purchaseLabel(String rateId, String idempotencyKey);

    /** Fresh label URL; provider URLs are not assumed to be permanent. */
    String labelUrl(String providerTransactionId);

    boolean voidLabel(String providerTransactionId);

    /** Parses a provider tracking webhook after authenticity has been checked by the caller. */
    TrackingUpdate parseTrackingWebhook(Map<String, Object> payload);

    /** Polls current tracking state. Default: unsupported (webhooks are the primary channel). */
    default TrackingUpdate fetchTracking(String carrier, String trackingNumber) {
        return null;
    }

    record ShipAddress(String name, String street1, String street2, String city, String state,
            String postalCode, String countryIso2, String phone) {
    }

    record Parcel(int weightGrams, int lengthMm, int widthMm, int heightMm) {
    }

    record ProviderRate(String rateId, String carrier, String serviceName, String serviceToken,
            long amountMinor, String currency, Integer estimatedDays) {
    }

    /** status: PURCHASED or FAILED. */
    record PurchasedLabel(String status, String providerTransactionId, String providerLabelId,
            String trackingNumber, String trackingUrl, String carrier, String serviceName,
            Long costMinor, String currency, String failureMessage) {
    }

    record TrackingEvent(String providerEventId, String status, String description, String location,
            Instant occurredAt) {
    }

    record TrackingUpdate(String trackingNumber, String carrier, String status, List<TrackingEvent> events) {
    }
}
