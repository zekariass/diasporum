package com.diasporum.backend.billing.internal.infrastructure.integration;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Resolves the adapter for a {@code provider_key} taken from
 * {@code payment_provider_country_capabilities}. Adapters register themselves
 * as Spring beans, so a provider becomes usable by shipping an adapter plus
 * flipping {@code payment_providers.is_active} — never by a schema change.
 */
@Component
public class PaymentProviderRegistry {

    private final Map<String, PaymentProvider> providers;

    public PaymentProviderRegistry(List<PaymentProvider> providers) {
        this.providers = providers.stream().collect(java.util.stream.Collectors
                .toUnmodifiableMap(PaymentProvider::providerKey, p -> p));
    }

    public Optional<PaymentProvider> find(String providerKey) {
        return Optional.ofNullable(providers.get(providerKey));
    }

    /** True when an adapter exists for this provider at all. */
    public boolean implemented(String providerKey) {
        return providers.containsKey(providerKey);
    }

    /**
     * The adapter for a provider the caller has already checked is active and
     * country-enabled. A missing adapter is a configuration error rather than
     * a client error: the capability row promises a provider the build cannot
     * service, so fail closed instead of silently accepting money.
     */
    public PaymentProvider require(String providerKey, Map<String, Object> providerConfig) {
        PaymentProvider provider = providers.get(providerKey);
        if (provider == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "PAYMENT_PROVIDER_NOT_IMPLEMENTED");
        }
        if (!provider.available(providerConfig)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "PAYMENT_PROVIDER_NOT_CONFIGURED");
        }
        return provider;
    }
}
