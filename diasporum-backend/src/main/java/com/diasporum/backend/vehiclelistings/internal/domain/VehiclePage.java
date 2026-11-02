package com.diasporum.backend.vehiclelistings.internal.domain;

import java.util.List;

public record VehiclePage(List<VehicleView> items, String nextCursor) {
}
