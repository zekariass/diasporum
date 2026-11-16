package com.diasporum.backend.events.internal.api.rest;

import com.diasporum.backend.events.internal.application.ticketing.OrganiserPayoutService;
import com.diasporum.backend.events.internal.application.ticketing.OrganiserPayoutService.PayoutView;
import com.diasporum.backend.events.internal.application.ticketing.PayoutAccountService;
import com.diasporum.backend.events.internal.application.ticketing.PayoutAccountService.AccountView;
import com.diasporum.backend.events.internal.application.ticketing.TicketRefundService;
import com.diasporum.backend.events.internal.application.ticketing.TicketRefundService.RefundView;
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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Platform-admin ticketing operations: payout queue, payout account verification, override refunds. */
@RestController
@RequestMapping("/api/v1/admin/ticketing")
public class TicketingAdminController {

    private final OrganiserPayoutService payouts;
    private final PayoutAccountService accounts;
    private final TicketRefundService refunds;

    public TicketingAdminController(OrganiserPayoutService payouts, PayoutAccountService accounts,
            TicketRefundService refunds) {
        this.payouts = payouts;
        this.accounts = accounts;
        this.refunds = refunds;
    }

    public record CompleteRequest(@NotBlank @Size(max = 200) String transferReference) {
    }

    public record ReasonRequest(@NotBlank @Size(max = 2000) String reason) {
    }

    public record VerifyRequest(@Size(max = 2000) String notes) {
    }

    public record OverrideRefundRequest(@NotNull UUID orderId, List<UUID> ticketIds,
            @NotBlank @Size(max = 2000) String reason) {
    }

    // payouts
    @GetMapping("/payouts")
    public Map<String, List<PayoutView>> queue(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String status) {
        return Map.of("items", payouts.adminQueue(p.userId(), status));
    }

    @PostMapping("/payouts/{payoutId}/approve")
    public PayoutView approve(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID payoutId) {
        return payouts.approve(p.userId(), payoutId);
    }

    @PostMapping("/payouts/{payoutId}/hold")
    public PayoutView hold(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID payoutId) {
        return payouts.hold(p.userId(), payoutId, true);
    }

    @PostMapping("/payouts/{payoutId}/release")
    public PayoutView release(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID payoutId) {
        return payouts.hold(p.userId(), payoutId, false);
    }

    @PostMapping("/payouts/{payoutId}/complete")
    public PayoutView complete(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID payoutId, @Valid @RequestBody CompleteRequest body) {
        return payouts.complete(p.userId(), payoutId, body.transferReference());
    }

    @PostMapping("/payouts/{payoutId}/reject")
    public PayoutView reject(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID payoutId, @Valid @RequestBody ReasonRequest body) {
        return payouts.reject(p.userId(), payoutId, body.reason(), false);
    }

    @PostMapping("/payouts/{payoutId}/fail")
    public PayoutView fail(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID payoutId, @Valid @RequestBody ReasonRequest body) {
        return payouts.reject(p.userId(), payoutId, body.reason(), true);
    }

    // payout accounts
    @GetMapping("/payout-accounts")
    public Map<String, List<AccountView>> accounts(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String status) {
        return Map.of("items", accounts.adminList(p.userId(), status));
    }

    @GetMapping("/payout-accounts/{accountId}")
    public AccountView account(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID accountId) {
        return accounts.adminView(p.userId(), accountId);
    }

    @PostMapping("/payout-accounts/{accountId}/verify")
    public AccountView verify(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID accountId, @Valid @RequestBody(required = false) VerifyRequest body) {
        return accounts.adminVerify(p.userId(), accountId, true, body == null ? null : body.notes());
    }

    @PostMapping("/payout-accounts/{accountId}/reject")
    public AccountView rejectAccount(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID accountId, @Valid @RequestBody(required = false) VerifyRequest body) {
        return accounts.adminVerify(p.userId(), accountId, false, body == null ? null : body.notes());
    }

    // refunds
    @PostMapping("/ticket-refunds")
    public ResponseEntity<Map<String, List<RefundView>>> overrideRefund(
            @AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody OverrideRefundRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("items",
                refunds.createByAdmin(p.userId(), body.orderId(), body.ticketIds(), body.reason())));
    }
}
