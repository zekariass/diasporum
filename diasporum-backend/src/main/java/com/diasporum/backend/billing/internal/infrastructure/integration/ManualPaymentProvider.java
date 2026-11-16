package com.diasporum.backend.billing.internal.infrastructure.integration;

import com.diasporum.backend.billing.internal.domain.BillingModels.BillingPaymentView;
import com.diasporum.backend.billing.internal.domain.BillingModels.CheckoutCommand;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Out-of-band payment with staff verification: the customer transfers to a
 * platform account and submits a reference, which a platform admin verifies
 * against {@code billing_payment_proofs}. This is how prepaid subscriptions are
 * bought where no payment API is integrated.
 *
 * <p>Bank details are read from {@code payment_providers.config} keyed by
 * country ISO2, so adding a country means configuring an account rather than
 * changing code. A country without configured details fails closed: a customer
 * is never told to transfer money to an unspecified account.
 */
@Component
public class ManualPaymentProvider implements PaymentProvider {

    public static final String PROVIDER_KEY = "BANK_TRANSFER";

    @Override
    public String providerKey() {
        return PROVIDER_KEY;
    }

    @Override
    public boolean available(Map<String, Object> providerConfig) {
        return !accounts(providerConfig).isEmpty();
    }

    @Override
    public PaymentInitiation initiate(CheckoutCommand command) {
        Map<String, Object> account = accountFor(command.providerConfig(), command.countryIso2());
        var details = new LinkedHashMap<String, Object>(account);
        // The reference the customer must quote, and that staff match the proof against.
        details.put("paymentReference", reference(command));
        details.put("amount", command.amount().toPlainString());
        details.put("currency", command.currencyCode());
        String instructions = String.valueOf(account.getOrDefault("instructions",
                "Transfer the exact amount quoting the payment reference, then submit"
                        + " the transfer reference for verification."));
        return new PaymentInitiation(PROVIDER_KEY, "PENDING", instructions, Map.copyOf(details));
    }

    @Override
    public PaymentConfirmation confirm(WebhookContext event) {
        // Manual payments are confirmed by an admin verifying a payment proof.
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "MANUAL_PAYMENT_REQUIRES_VERIFICATION");
    }

    @Override
    public RefundResult refund(BillingPaymentView payment, BigDecimal amount) {
        // The platform cannot reverse a bank transfer; finance refunds out of band.
        return new RefundResult(false, null, "UNSUPPORTED",
                "Bank transfers are refunded out of band and recorded manually.");
    }

    /** Stable per-payment reference, short enough for a bank narrative field. */
    private static String reference(CheckoutCommand command) {
        return "DSP-" + command.paymentId().toString().substring(0, 8).toUpperCase();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> accounts(Map<String, Object> providerConfig) {
        if (providerConfig == null) {
            return Map.of();
        }
        Object accounts = providerConfig.get("accounts");
        return accounts instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> accountFor(Map<String, Object> providerConfig,
            String countryIso2) {
        Object account = accounts(providerConfig).get(countryIso2);
        if (!(account instanceof Map<?, ?> map) || map.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "PAYMENT_PROVIDER_NOT_CONFIGURED");
        }
        return (Map<String, Object>) map;
    }
}
