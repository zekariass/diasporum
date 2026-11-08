package com.diasporum.backend.propertylistings.internal.application;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Idempotent lifecycle expiry for published property listings. */
@Component
public class PropertyExpiryWorker {

    private final JdbcTemplate jdbc;

    public PropertyExpiryWorker(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Scheduled(fixedDelayString = "${diasporum.property-marketplace.expiry-interval:PT15M}")
    @Transactional
    public int expire() {
        return jdbc.update("UPDATE property_listings SET status='EXPIRED',"
                + "updated_at=now() WHERE status='PUBLISHED'"
                + " AND expires_at IS NOT NULL AND expires_at<=now()");
    }
}
