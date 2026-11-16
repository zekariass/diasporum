package com.diasporum.backend.shopmarketplace.internal.infrastructure.tax;

import com.diasporum.backend.shopmarketplace.internal.application.TaxProvider;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Records an explicitly approved "no marketplace tax collection" decision for a market
 * (provider key {@code NO_COLLECTION}). It is only ever selected when an administrator has
 * enabled a {@code tax_provider_configurations} row for that country with an approval
 * reference; it is never a silent fallback when a real provider is unavailable.
 */
@Component
public class ApprovedNoCollectionTaxProvider implements TaxProvider {

    @Override
    public String key() {
        return "NO_COLLECTION";
    }

    @Override
    public boolean available() {
        return true;
    }

    @Override
    public TaxResult calculate(TaxRequest request, Map<String, Object> configuration) {
        Object approval = configuration.get("approvalReference");
        if (approval == null || String.valueOf(approval).isBlank()) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY, "TAX_CONFIGURATION_NOT_APPROVED");
        }
        return new TaxResult("no-collection:" + java.util.UUID.randomUUID(), Map.of(), Map.of(), 0,
                "APPROVED_CONFIGURATION", "No marketplace tax collection approved: " + approval);
    }
}
