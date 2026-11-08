package com.diasporum.backend.vehiclelistings.internal.domain;

import java.util.List;

/** Raw authorized SQL page before batch block filtering and DTO enrichment. */
public record VehicleQueryResult(List<VehicleListing> items, String nextSortKey, Long totalCount) {

    public VehicleQueryResult(List<VehicleListing> items, String nextSortKey) {
        this(items, nextSortKey, null);
    }
}
