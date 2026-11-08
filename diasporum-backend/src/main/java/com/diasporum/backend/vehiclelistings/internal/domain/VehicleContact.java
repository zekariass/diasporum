package com.diasporum.backend.vehiclelistings.internal.domain;

/**
 * Seller contact channels after visibility-flag filtering; null fields stay private.
 * The show* flags are only populated for listing managers so edit forms can round-trip them.
 */
public record VehicleContact(String phone, String whatsapp, String email,
        String preferredMethod, Boolean showPhone, Boolean showWhatsapp, Boolean showEmail) {
}
