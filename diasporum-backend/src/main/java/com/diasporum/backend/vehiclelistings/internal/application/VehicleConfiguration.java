package com.diasporum.backend.vehiclelistings.internal.application;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(VehiclePolicies.class)
class VehicleConfiguration {
}
