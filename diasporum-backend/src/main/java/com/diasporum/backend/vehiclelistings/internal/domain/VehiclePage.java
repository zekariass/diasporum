package com.diasporum.backend.vehiclelistings.internal.domain;

import java.util.List;

public record VehiclePage(List<VehicleView> items, String nextCursor, Long totalCount) {

    public VehiclePage(List<VehicleView> items, String nextCursor) {
        this(items, nextCursor, null);
    }
}
