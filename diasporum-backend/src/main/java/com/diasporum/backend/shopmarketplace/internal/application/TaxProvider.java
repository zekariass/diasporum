package com.diasporum.backend.shopmarketplace.internal.application;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Provider-backed tax calculation port. There is no home-grown tax engine: when no enabled
 * provider configuration exists for the market, checkout fails closed.
 */
public interface TaxProvider {

    String key();

    boolean available();

    TaxResult calculate(TaxRequest request, Map<String, Object> configuration);

    record TaxAddress(String countryIso2, String postalCode, String city, String region, String line1) {
    }

    record TaxLine(String reference, long amountMinor, int quantity, String taxCode) {
    }

    record TaxShipping(String reference, long amountMinor) {
    }

    record TaxRequest(String currency, TaxAddress destination, List<TaxLine> lines, List<TaxShipping> shipping) {
    }

    record LineTax(long taxMinor, BigDecimal rate, String jurisdictionCode, String taxType) {
    }

    record TaxResult(String providerCalculationId, Map<String, LineTax> lineTaxes,
            Map<String, LineTax> shippingTaxes, long totalTaxMinor, String decisionSource, String reason) {
    }
}
