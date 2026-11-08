package com.diasporum.backend.vehiclelistings.internal.application;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Idempotent lifecycle expiry for published vehicle listings. */
@Component
public class VehicleExpiryWorker {

    private final JdbcTemplate jdbc;

    public VehicleExpiryWorker(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Scheduled(fixedDelayString = "${diasporum.vehicles.expiry-interval:PT15M}")
    @Transactional
    public int expire() {
        return jdbc.update("UPDATE vehicle_listings SET status='EXPIRED',"
                + "updated_at=now() WHERE status='PUBLISHED'"
                + " AND expires_at IS NOT NULL AND expires_at<=now()");
    }
}
