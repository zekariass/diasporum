package com.diasporum.backend.vehiclelistings.internal.application;

import java.util.List;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Approved per-category form, attribute and feature policy. Empty by default. */
@ConfigurationProperties(prefix = "diasporum.vehicles")
public record VehiclePolicies(Map<String, Category> categories) {

    public VehiclePolicies {
        categories = categories == null ? Map.of() : Map.copyOf(categories);
    }

    public Category forCategory(String categoryKey) {
        return categoryKey == null ? null : categories.get(categoryKey);
    }

    public record Category(List<String> coreFields, List<String> requiredCoreFields,
            List<String> allowedFeatures, Map<String, Attribute> attributes) {
        public Category {
            coreFields = coreFields == null ? List.of() : List.copyOf(coreFields);
            requiredCoreFields = requiredCoreFields == null
                    ? List.of() : List.copyOf(requiredCoreFields);
            allowedFeatures = allowedFeatures == null
                    ? List.of() : List.copyOf(allowedFeatures);
            attributes = attributes == null ? Map.of() : Map.copyOf(attributes);
        }
    }

    public record Attribute(String type, boolean required, Double minimum,
            Double maximum, List<String> options, boolean filterable) {
        public Attribute {
            options = options == null ? List.of() : List.copyOf(options);
        }
    }
}
