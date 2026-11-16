package com.diasporum.backend.billing.internal.api.rest;

import com.diasporum.backend.billing.internal.application.BillingCountryAdminService;
import com.diasporum.backend.billing.internal.domain.BillingModels.CountryBillingSettings;
import com.diasporum.backend.billing.internal.domain.BillingModels.PaymentProofView;
import com.diasporum.backend.billing.internal.domain.BillingModels.ProviderCapability;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Audited platform-admin configuration of country billing policy, the provider
 * capability matrix and plan prices, plus the manual payment verification
 * queue. Shares the {@code /api/v1/admin/billing} base with the existing
 * entitlement administration; paths do not overlap.
 */
@RestController
@RequestMapping("/api/v1/admin/billing")
public class BillingCountryAdminController {

    private final BillingCountryAdminService service;

    public BillingCountryAdminController(BillingCountryAdminService service) {
        this.service = service;
    }

    // ---- country policy ----

    @GetMapping("/countries")
    public List<CountryBillingSettings> countries(
            @AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return service.countrySettings(principal.userId());
    }

    @PutMapping("/countries/{countryId}")
    public CountryBillingSettings upsertCountry(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID countryId, @RequestBody Map<String, Object> body) {
        return service.upsertCountrySettings(principal.userId(), countryId,
                flag(body.get("billingEnabled")), flag(body.get("subscriptionsEnabled")),
                string(body.get("defaultCurrency")), strings(body.get("supportedCurrencies")),
                flag(body.get("recurringBillingEnabled")),
                flag(body.get("manualVerificationEnabled")),
                flag(body.get("prepaidTermsEnabled")), !Boolean.FALSE.equals(body.get("active")),
                string(body.get("notes")));
    }

    // ---- provider capability matrix ----

    @GetMapping("/countries/{countryId}/providers")
    public List<ProviderCapability> capabilities(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID countryId) {
        return service.capabilities(principal.userId(), countryId);
    }

    @PutMapping("/countries/{countryId}/providers/{providerKey}")
    public ProviderCapability upsertCapability(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID countryId, @PathVariable String providerKey,
            @RequestBody Map<String, Object> body) {
        return service.upsertCapability(principal.userId(), providerKey, countryId,
                !Boolean.FALSE.equals(body.get("enabled")), flag(body.get("supportsOneTime")),
                flag(body.get("supportsRecurring")), flag(body.get("supportsRefund")),
                flag(body.get("requiresManualVerification")),
                strings(body.get("supportedCurrencies")), strings(body.get("supportedMethods")),
                string(body.get("notes")));
    }

    @PutMapping("/providers/{providerKey}")
    public void updateProvider(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable String providerKey, @RequestBody Map<String, Object> body) {
        service.updateProvider(principal.userId(), providerKey,
                flag(body.get("active")), string(body.get("config")));
    }

    // ---- plan price options ----

    @PostMapping("/plan-prices")
    public Map<String, Object> addPriceOption(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> body) {
        UUID priceId = service.addPriceOption(principal.userId(), string(body.get("planKey")),
                uuid(body.get("countryId")), string(body.get("currencyCode")),
                decimal(body.get("amount")), string(body.get("billingInterval")),
                integer(body.get("intervalCount")), string(body.get("billingArrangement")));
        return Map.of("id", priceId);
    }

    @PostMapping("/plan-prices/{priceId}/retire")
    public void retirePriceOption(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID priceId) {
        service.retirePriceOption(principal.userId(), priceId);
    }

    // ---- manual payment verification queue ----

    @GetMapping("/payment-proofs")
    public List<PaymentProofView> paymentProofs(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(defaultValue = "PENDING") String status,
            @RequestParam(defaultValue = "50") int limit,
            @RequestParam(defaultValue = "0") int offset) {
        return service.paymentProofs(principal.userId(), status, limit, offset);
    }

    @PostMapping("/payment-proofs/{proofId}/verify")
    public PaymentProofView verify(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID proofId) {
        return service.verifyPaymentProof(principal.userId(), proofId);
    }

    @PostMapping("/payment-proofs/{proofId}/reject")
    public PaymentProofView reject(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID proofId, @RequestBody Map<String, Object> body) {
        return service.rejectPaymentProof(principal.userId(), proofId,
                string(body.get("reason")));
    }

    private static boolean flag(Object value) {
        return Boolean.TRUE.equals(value) || "true".equalsIgnoreCase(String.valueOf(value));
    }

    private static String string(Object value) {
        return value == null || value.toString().isBlank() ? null : value.toString().trim();
    }

    @SuppressWarnings("unchecked")
    private static List<String> strings(Object value) {
        return value instanceof List<?> list ? (List<String>) list : List.of();
    }

    private static BigDecimal decimal(Object value) {
        return value == null ? null : new BigDecimal(value.toString());
    }

    private static Integer integer(Object value) {
        return value == null ? null : Integer.valueOf(value.toString());
    }

    private static UUID uuid(Object value) {
        return value == null || value.toString().isBlank() ? null
                : UUID.fromString(value.toString());
    }
}
