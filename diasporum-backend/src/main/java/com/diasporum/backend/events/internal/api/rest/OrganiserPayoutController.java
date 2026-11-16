package com.diasporum.backend.events.internal.api.rest;

import com.diasporum.backend.events.internal.application.ticketing.OrganiserPayoutService;
import com.diasporum.backend.events.internal.application.ticketing.OrganiserPayoutService.PayoutView;
import com.diasporum.backend.events.internal.application.ticketing.PayoutAccountService;
import com.diasporum.backend.events.internal.application.ticketing.PayoutAccountService.AccountCommand;
import com.diasporum.backend.events.internal.application.ticketing.PayoutAccountService.AccountView;
import com.diasporum.backend.events.internal.application.ticketing.PayoutAccountService.FieldRequirement;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Organiser payout destinations (masked) and payout requests (MANUAL disbursement only). */
@RestController
@RequestMapping("/api/v1")
public class OrganiserPayoutController {

    private final PayoutAccountService accounts;
    private final OrganiserPayoutService payouts;

    public OrganiserPayoutController(PayoutAccountService accounts, OrganiserPayoutService payouts) {
        this.accounts = accounts;
        this.payouts = payouts;
    }

    public record PayoutRequest(@NotNull UUID eventId, @NotNull UUID payoutAccountId,
            @NotBlank @Size(max = 120) String idempotencyKey) {
    }

    @GetMapping("/payout-account-requirements")
    public Map<String, List<FieldRequirement>> requirements(@RequestParam UUID countryId) {
        return Map.of("items", accounts.requirements(countryId));
    }

    @GetMapping("/me/payout-accounts")
    public Map<String, List<AccountView>> list(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) UUID businessAccountId) {
        return Map.of("items", accounts.list(p.userId(), businessAccountId));
    }

    @PostMapping("/me/payout-accounts")
    public ResponseEntity<AccountView> create(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestBody AccountCommand body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(accounts.create(p.userId(), body));
    }

    @PatchMapping("/me/payout-accounts/{accountId}")
    public AccountView update(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID accountId, @RequestBody AccountCommand body) {
        return accounts.update(p.userId(), accountId, body);
    }

    @DeleteMapping("/me/payout-accounts/{accountId}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID accountId) {
        accounts.delete(p.userId(), accountId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/organiser-payouts")
    public ResponseEntity<PayoutView> request(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody PayoutRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(payouts.request(p.userId(),
                body.eventId(), body.payoutAccountId(), body.idempotencyKey()));
    }
}
