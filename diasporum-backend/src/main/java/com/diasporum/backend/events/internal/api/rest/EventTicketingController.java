package com.diasporum.backend.events.internal.api.rest;

import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService;
import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.PromoCodeCommand;
import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.PromoCodeView;
import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.SettingsCommand;
import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.TicketTypeCommand;
import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.TicketTypeView;
import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.TicketingSettings;
import com.diasporum.backend.events.internal.application.ticketing.OrganiserPayoutService;
import com.diasporum.backend.events.internal.application.ticketing.OrganiserPayoutService.PayoutView;
import com.diasporum.backend.events.internal.application.ticketing.OrganiserPayoutService.SalesSummary;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderService;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderService.OrderPage;
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
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Organiser ticketing: settings, ticket types, promo codes, sales dashboard, refunds. */
@RestController
@RequestMapping("/api/v1")
public class EventTicketingController {

    private final EventTicketingSetupService setup;
    private final TicketOrderService orders;
    private final OrganiserPayoutService payouts;
    private final TicketRefundService refunds;

    public EventTicketingController(EventTicketingSetupService setup, TicketOrderService orders,
            OrganiserPayoutService payouts, TicketRefundService refunds) {
        this.setup = setup;
        this.orders = orders;
        this.payouts = payouts;
        this.refunds = refunds;
    }

    public record RefundCreateRequest(@NotNull UUID orderId, List<UUID> ticketIds,
            @NotBlank String refundType, @NotBlank @Size(max = 2000) String reason) {
    }

    public record RejectRequest(@Size(max = 2000) String note) {
    }

    // settings
    @GetMapping("/events/{eventId}/ticketing")
    public TicketingSettings settings(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID eventId) {
        return setup.settings(p.userId(), eventId);
    }

    @PutMapping("/events/{eventId}/ticketing")
    public TicketingSettings updateSettings(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID eventId, @RequestBody SettingsCommand body) {
        return setup.updateSettings(p.userId(), eventId, body);
    }

    // ticket types
    @GetMapping("/events/{eventId}/ticketing/ticket-types")
    public Map<String, List<TicketTypeView>> ticketTypes(
            @AuthenticationPrincipal DiasporumUserPrincipal p, @PathVariable UUID eventId) {
        return Map.of("items", setup.ticketTypes(p.userId(), eventId));
    }

    @PostMapping("/events/{eventId}/ticketing/ticket-types")
    public ResponseEntity<TicketTypeView> createTicketType(
            @AuthenticationPrincipal DiasporumUserPrincipal p, @PathVariable UUID eventId,
            @RequestBody TicketTypeCommand body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(setup.createTicketType(p.userId(), eventId, body));
    }

    @PatchMapping("/events/{eventId}/ticketing/ticket-types/{typeId}")
    public TicketTypeView updateTicketType(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID eventId, @PathVariable UUID typeId, @RequestBody TicketTypeCommand body) {
        return setup.updateTicketType(p.userId(), eventId, typeId, body);
    }

    @DeleteMapping("/events/{eventId}/ticketing/ticket-types/{typeId}")
    public Map<String, Boolean> deleteTicketType(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID eventId, @PathVariable UUID typeId) {
        return Map.of("deleted", setup.deleteTicketType(p.userId(), eventId, typeId));
    }

    // promo codes
    @GetMapping("/events/{eventId}/ticketing/promo-codes")
    public Map<String, List<PromoCodeView>> promoCodes(
            @AuthenticationPrincipal DiasporumUserPrincipal p, @PathVariable UUID eventId) {
        return Map.of("items", setup.promoCodes(p.userId(), eventId));
    }

    @PostMapping("/events/{eventId}/ticketing/promo-codes")
    public ResponseEntity<PromoCodeView> createPromo(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID eventId, @RequestBody PromoCodeCommand body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(setup.createPromoCode(p.userId(), eventId, body));
    }

    @PatchMapping("/events/{eventId}/ticketing/promo-codes/{promoId}")
    public PromoCodeView updatePromo(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID eventId, @PathVariable UUID promoId, @RequestBody PromoCodeCommand body) {
        return setup.updatePromoCode(p.userId(), eventId, promoId, body);
    }

    @DeleteMapping("/events/{eventId}/ticketing/promo-codes/{promoId}")
    public Map<String, Boolean> deletePromo(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID eventId, @PathVariable UUID promoId) {
        return Map.of("deleted", setup.deletePromoCode(p.userId(), eventId, promoId));
    }

    // dashboard
    @GetMapping("/events/{eventId}/ticketing/orders")
    public OrderPage orders(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID eventId, @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        return orders.eventOrders(p.userId(), eventId, cursor, limit);
    }

    @GetMapping("/events/{eventId}/ticketing/summary")
    public SalesSummary summary(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID eventId) {
        return payouts.summary(p.userId(), eventId);
    }

    @GetMapping("/events/{eventId}/ticketing/payouts")
    public Map<String, List<PayoutView>> payoutHistory(
            @AuthenticationPrincipal DiasporumUserPrincipal p, @PathVariable UUID eventId) {
        return Map.of("items", payouts.eventPayouts(p.userId(), eventId));
    }

    // refunds
    @GetMapping("/events/{eventId}/ticketing/refunds")
    public Map<String, List<RefundView>> refunds(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID eventId, @RequestParam(required = false) String status) {
        return Map.of("items", refunds.eventRefunds(p.userId(), eventId, status));
    }

    @PostMapping("/events/{eventId}/ticketing/refunds")
    public ResponseEntity<Map<String, List<RefundView>>> createRefunds(
            @AuthenticationPrincipal DiasporumUserPrincipal p, @PathVariable UUID eventId,
            @Valid @RequestBody RefundCreateRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("items",
                refunds.createByOrganiser(p.userId(), eventId, body.orderId(), body.ticketIds(),
                        body.refundType(), body.reason())));
    }

    @PostMapping("/ticket-refunds/{refundId}/approve")
    public RefundView approveRefund(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID refundId) {
        return refunds.approve(p.userId(), refundId);
    }

    @PostMapping("/ticket-refunds/{refundId}/reject")
    public RefundView rejectRefund(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID refundId, @Valid @RequestBody(required = false) RejectRequest body) {
        return refunds.reject(p.userId(), refundId, body == null ? null : body.note());
    }
}
