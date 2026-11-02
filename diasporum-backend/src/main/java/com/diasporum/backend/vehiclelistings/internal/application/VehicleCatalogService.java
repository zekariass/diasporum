package com.diasporum.backend.vehiclelistings.internal.application;

import com.diasporum.backend.vehiclelistings.internal.domain.VehicleCatalogItem;
import com.diasporum.backend.vehiclelistings.internal.infrastructure.persistence.VehicleRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Active vehicle catalogue plus approved category metadata. */
@Service
public class VehicleCatalogService {

    public static final List<String> DEFAULT_CORE_FIELDS = List.of("listingPurpose", "title",
            "description", "modelYear", "registrationYear", "mileage", "mileageUnit",
            "fuelType", "transmission", "driveType", "bodyType", "engineSizeCc", "colour",
            "doors", "seats", "condition", "previousOwners", "motExpiry", "serviceHistory",
            "priceAmount", "currencyCode", "pricePeriod", "rentalDeposit", "mileageAllowance",
            "rentalConditions");

    private final VehicleRepository repository;
    private final VehiclePolicies policies;

    public VehicleCatalogService(VehicleRepository repository, VehiclePolicies policies) {
        this.repository = repository;
        this.policies = policies;
    }

    public record CategoryView(VehicleCatalogItem category, List<String> coreFields,
            List<String> requiredCoreFields, List<String> allowedFeatures,
            Map<String, VehiclePolicies.Attribute> attributes) {
    }

    public List<CategoryView> categories() {
        return repository.categories().stream().map(category -> {
            var policy = policies.forCategory(category.key());
            return new CategoryView(category, policy == null || policy.coreFields().isEmpty()
                    ? DEFAULT_CORE_FIELDS : policy.coreFields(),
                    policy == null ? List.of() : policy.requiredCoreFields(),
                    policy == null ? List.of() : policy.allowedFeatures(),
                    policy == null ? Map.of() : policy.attributes());
        }).toList();
    }

    public List<VehicleCatalogItem> makes() {
        return repository.makes();
    }

    public List<VehicleCatalogItem> models(UUID makeId) {
        return repository.models(makeId);
    }

    public List<VehicleCatalogItem> variants(UUID modelId) {
        return repository.variants(modelId);
    }

    public List<VehicleCatalogItem> features() {
        return repository.features();
    }
}
