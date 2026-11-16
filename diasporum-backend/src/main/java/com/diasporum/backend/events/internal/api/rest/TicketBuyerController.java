package com.diasporum.backend.events.internal.api.rest;

import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService;
import com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.TicketTypeView;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderService;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderService.OrderPage;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderService.OrderView;
import com.diasporum.backend.events.internal.application.ticketing.TicketOrderService.TicketView;
import com.diasporum.backend.events.internal.application.ticketing.TicketRefundService;
import com.diasporum.backend.events.internal.application.ticketing.TicketRefundService.RefundView;
import com.diasporum.backend.events.internal.application.ticketing.TicketReservationService;
import com.diasporum.backend.events.internal.application.ticketing.TicketReservationService.ReservationView;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Buyer ticketing: browse types, hold inventory, check out, view orders and tickets. */
@RestController
@RequestMapping("/api/v1")
public class TicketBuyerController {

    private final EventTicketingSetupService setup;
    private final TicketReservationService reservations;
    private final TicketOrderService orders;
    private final TicketRefundService refunds;

    public TicketBuyerController(EventTicketingSetupService setup,
            TicketReservationService reservations, TicketOrderService orders,
            TicketRefundService refunds) {
        this.setup = setup;
        this.reservations = reservations;
        this.orders = orders;
        this.refunds = refunds;
    }

    public record ReserveRequest(@NotNull UUID ticketTypeId, @NotNull @Min(1) Integer quantity) {
    }

    public record OrderRequest(@NotNull UUID reservationId, @Size(max = 50) String promoCode,
            @NotBlank @Size(max = 120) String idempotencyKey) {
    }

    public record RefundRequest(List<UUID> ticketIds, @NotBlank @Size(max = 2000) String reason) {
    }

    @GetMapping("/events/{eventId}/ticket-types")
    public Map<String, List<TicketTypeView>> ticketTypes(@PathVariable UUID eventId) {
        return Map.of("items", setup.publicTicketTypes(eventId));
    }

    @PostMapping("/events/{eventId}/tickets/reserve")
    public ResponseEntity<ReservationView> reserve(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID eventId, @Valid @RequestBody ReserveRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(reservations.reserve(p.userId(),
                eventId, body.ticketTypeId(), body.quantity()));
    }

    @DeleteMapping("/ticket-reservations/{reservationId}")
    public ResponseEntity<Void> release(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID reservationId) {
        reservations.release(p.userId(), reservationId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/ticket-orders")
    public ResponseEntity<OrderView> createOrder(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody OrderRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(orders.create(p.userId(),
                body.reservationId(), body.promoCode(), body.idempotencyKey()));
    }

    @GetMapping("/ticket-orders/{orderId}")
    public OrderView order(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID orderId) {
        return orders.order(p.userId(), orderId);
    }

    @PostMapping("/ticket-orders/{orderId}/cancel")
    public OrderView cancel(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID orderId) {
        return orders.cancel(p.userId(), orderId);
    }

    @PostMapping("/ticket-orders/{orderId}/refund-requests")
    public ResponseEntity<Map<String, List<RefundView>>> requestRefund(
            @AuthenticationPrincipal DiasporumUserPrincipal p, @PathVariable UUID orderId,
            @Valid @RequestBody RefundRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("items",
                refunds.requestByBuyer(p.userId(), orderId, body.ticketIds(), body.reason())));
    }

    @GetMapping("/me/ticket-orders")
    public OrderPage myOrders(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        return orders.myOrders(p.userId(), cursor, limit);
    }

    @GetMapping("/me/tickets")
    public Map<String, List<TicketView>> myTickets(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) UUID eventId,
            @RequestParam(required = false) String status) {
        return Map.of("items", orders.myTickets(p.userId(), eventId, status));
    }
}
