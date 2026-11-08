package com.diasporum.backend.vehiclelistings.internal.domain;

import java.util.List;

public record VehicleView(VehicleListing listing, VehicleLocation location,
        List<VehicleMedia> media, List<VehicleFeature> features,
        List<java.util.UUID> selectedCommunityIds, VehicleSeller seller,
        VehicleListedBy listedBy, VehicleContact contact, boolean canManage) {
}
