package com.diasporum.backend.servicemarketplace.internal.application;

import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** Service Marketplace capacity and lead-pricing policy. */
@ConfigurationProperties(prefix = "diasporum.service-marketplace")
public record ServiceMarketplaceProperties(int maxProvidersPerRequest,
        BigDecimal leadPrice, String leadCurrency) {
    public ServiceMarketplaceProperties {
        if (maxProvidersPerRequest < 1) {
            throw new IllegalArgumentException("maxProvidersPerRequest must be positive");
        }
        leadPrice = leadPrice == null ? BigDecimal.ZERO : leadPrice;
        if (leadPrice.signum() < 0) {
            throw new IllegalArgumentException("leadPrice cannot be negative");
        }
        leadCurrency = leadCurrency == null || leadCurrency.isBlank()
                ? "USD" : leadCurrency.trim().toUpperCase();
        if (!leadCurrency.matches("[A-Z]{3}")) {
            throw new IllegalArgumentException("leadCurrency must be a three-letter code");
        }
    }

    @Configuration
    @EnableConfigurationProperties(ServiceMarketplaceProperties.class)
    static class ServiceMarketplaceConfiguration {
    }
}
