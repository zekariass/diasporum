package com.diasporum.backend.sparebag.internal.api.rest;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.sparebag.internal.application.v2.SenderRequestService;
import com.diasporum.backend.sparebag.internal.application.v2.SpareBagMatchService;
import com.diasporum.backend.sparebag.internal.application.v2.SpareBagReferenceService;
import com.diasporum.backend.sparebag.internal.application.v2.TravellerJourneyService;
import com.diasporum.backend.sparebag.internal.application.v2.TravellerProfileService;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Page;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.CountryConfig;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.JourneyFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.JourneyInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.JourneyView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.MatchInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.MatchView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.RegularRoute;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderItemInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequestFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequestInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequestView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.TravellerProfileInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.TravellerProfileView;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * v10.15 Spare Bag API ("Items to Send" + "Traveller Journeys" tabs, traveller
 * profiles, matching, reference data). Lives under {@code /api/v1/spare-bag/v2}
 * alongside the legacy {@code /api/v1/spare-bag/listings*} and
 * {@code /contact-requests*} endpoints, which are unchanged.
 */
@RestController
@RequestMapping("/api/v1/spare-bag/v2")
public class SpareBagV2Controller {

    private final SpareBagReferenceService reference;
    private final TravellerProfileService travellers;
    private final TravellerJourneyService journeys;
    private final SenderRequestService requests;
    private final SpareBagMatchService matches;

    public SpareBagV2Controller(SpareBagReferenceService reference,
            TravellerProfileService travellers, TravellerJourneyService journeys,
            SenderRequestService requests, SpareBagMatchService matches) {
        this.reference = reference;
        this.travellers = travellers;
        this.journeys = journeys;
        this.requests = requests;
        this.matches = matches;
    }

    // =================== request bodies ===================

    record RouteBody(@NotNull UUID fromCountryId, @NotNull UUID toCountryId) {
    }

    record ProfileBody(String displayName, String bio, List<String> acceptedItemCategories,
            @Valid List<RouteBody> regularRoutes) {

        TravellerProfileInput toInput() {
            return new TravellerProfileInput(displayName, bio, acceptedItemCategories,
                    regularRoutes == null ? null : regularRoutes.stream()
                            .map(r -> new RegularRoute(r.fromCountryId(), r.toCountryId()))
                            .toList());
        }
    }

    record JourneyBody(@NotNull UUID fromCountryId, @NotBlank String fromCity,
            @NotNull UUID toCountryId, @NotBlank String toCity, UUID fromAirportId,
            UUID toAirportId, String pickupLocation, String deliveryLocation,
            @NotNull LocalDate travelDate, LocalDate travelDateEnd,
            BigDecimal availableCapacityKg, BigDecimal maxSingleParcelKg,
            BigDecimal pricePerKg, BigDecimal pricePerPiece, String priceCurrency,
            List<String> acceptedCategories, String notes, Instant closesAt) {

        JourneyInput toInput() {
            return new JourneyInput(fromCountryId, fromCity, toCountryId, toCity,
                    fromAirportId, toAirportId, pickupLocation, deliveryLocation, travelDate,
                    travelDateEnd, availableCapacityKg, maxSingleParcelKg, pricePerKg,
                    pricePerPiece, priceCurrency, acceptedCategories, notes, closesAt);
        }
    }

    record ItemBody(@NotBlank String itemName, String itemDescription, String categoryKey,
            @NotNull BigDecimal quantity, @NotBlank String unitCode,
            BigDecimal perUnitAmount, String perUnitUnit, BigDecimal declaredValueAmount,
            String declaredValueCurrency) {

        SenderItemInput toInput() {
            return new SenderItemInput(itemName, itemDescription, categoryKey, quantity,
                    unitCode, perUnitAmount, perUnitUnit, declaredValueAmount,
                    declaredValueCurrency);
        }
    }

    record SenderRequestBody(@NotNull UUID fromCountryId, @NotBlank String fromCity,
            @NotNull UUID toCountryId, @NotBlank String toCity, String description,
            Instant closesAt, @Valid List<ItemBody> items, List<UUID> mediaIds) {

        SenderRequestInput toInput() {
            return new SenderRequestInput(fromCountryId, fromCity, toCountryId, toCity,
                    description, closesAt,
                    items == null ? List.of() : items.stream().map(ItemBody::toInput).toList(),
                    mediaIds);
        }
    }

    record MatchBody(@NotNull UUID senderRequestId, @NotNull UUID journeyId,
            @Size(max = 3000) String message, @NotBlank @Size(max = 120) String idempotencyKey) {
    }

    record NoteBody(@Size(max = 3000) String responseNote) {
    }

    record ReportBody(@NotBlank String reason, @Size(max = 4000) String details) {
    }

    // =================== reference data ===================

    @GetMapping("/measurement-units")
    public Map<String, Object> units(@AuthenticationPrincipal DiasporumUserPrincipal p) {
        p.userId();
        return Map.of("items", reference.units());
    }

    @GetMapping("/categories")
    public Map<String, Object> categories(@AuthenticationPrincipal DiasporumUserPrincipal p) {
        p.userId();
        return Map.of("items", reference.categories());
    }

    @GetMapping("/country-config/{countryId}")
    public CountryConfig countryConfig(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID countryId) {
        p.userId();
        return reference.countryConfig(countryId);
    }

    // =================== traveller profile ===================

    @GetMapping("/me/traveller-profile")
    public TravellerProfileView myProfile(@AuthenticationPrincipal DiasporumUserPrincipal p) {
        return travellers.mine(p.userId());
    }

    @PutMapping("/me/traveller-profile")
    public TravellerProfileView upsertProfile(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody ProfileBody body) {
        return travellers.upsert(p.userId(), body.toInput());
    }

    @PostMapping("/me/traveller-profile/pause")
    public TravellerProfileView pauseProfile(@AuthenticationPrincipal DiasporumUserPrincipal p) {
        return travellers.pause(p.userId());
    }

    @PostMapping("/me/traveller-profile/activate")
    public TravellerProfileView activateProfile(
            @AuthenticationPrincipal DiasporumUserPrincipal p) {
        return travellers.activate(p.userId());
    }

    @PostMapping("/me/traveller-profile/close")
    public TravellerProfileView closeProfile(@AuthenticationPrincipal DiasporumUserPrincipal p) {
        return travellers.close(p.userId());
    }

    @PostMapping("/me/traveller-profile/verification")
    public TravellerProfileView submitVerification(
            @AuthenticationPrincipal DiasporumUserPrincipal p) {
        return travellers.submitVerification(p.userId());
    }

    @GetMapping("/travellers/{profileId}")
    public TravellerProfileView traveller(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID profileId) {
        return travellers.detail(p.userId(), profileId);
    }

    // =================== journeys ===================

    @PostMapping("/journeys")
    public ResponseEntity<JourneyView> createJourney(
            @AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody JourneyBody body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(journeys.create(p.userId(), body.toInput()));
    }

    @GetMapping("/journeys")
    public Page<JourneyView> searchJourneys(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) UUID fromCountryId,
            @RequestParam(required = false) UUID toCountryId,
            @RequestParam(required = false) LocalDate dateFrom,
            @RequestParam(required = false) LocalDate dateTo,
            @RequestParam(required = false) String category,
            @RequestParam(defaultValue = "false") boolean verifiedOnly,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return journeys.search(p.userId(), new JourneyFilters(fromCountryId, toCountryId,
                dateFrom, dateTo, category, verifiedOnly), cursor, size);
    }

    @GetMapping("/me/journeys")
    public Page<JourneyView> myJourneys(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return journeys.mine(p.userId(), status, cursor, size);
    }

    @GetMapping("/journeys/{id}")
    public JourneyView journey(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return journeys.detail(p.userId(), id);
    }

    @PutMapping("/journeys/{id}")
    public JourneyView updateJourney(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id, @Valid @RequestBody JourneyBody body) {
        return journeys.update(p.userId(), id, body.toInput());
    }

    @DeleteMapping("/journeys/{id}")
    public ResponseEntity<Void> deleteJourney(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        journeys.delete(p.userId(), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/journeys/{id}/publish")
    public JourneyView publishJourney(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return journeys.publish(p.userId(), id);
    }

    @PostMapping("/journeys/{id}/pause")
    public JourneyView pauseJourney(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return journeys.pause(p.userId(), id);
    }

    @PostMapping("/journeys/{id}/close")
    public JourneyView closeJourney(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return journeys.close(p.userId(), id);
    }

    @PostMapping("/journeys/{id}/report")
    public ResponseEntity<Map<String, UUID>> reportJourney(
            @AuthenticationPrincipal DiasporumUserPrincipal p, @PathVariable UUID id,
            @Valid @RequestBody ReportBody body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id",
                journeys.report(p.userId(), id, body.reason(), body.details())));
    }

    // =================== sender requests ===================

    @PostMapping("/sender-requests")
    public ResponseEntity<SenderRequestView> createRequest(
            @AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody SenderRequestBody body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(requests.create(p.userId(), body.toInput()));
    }

    @GetMapping("/sender-requests")
    public Page<SenderRequestView> searchRequests(
            @AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) UUID fromCountryId,
            @RequestParam(required = false) UUID toCountryId,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return requests.search(p.userId(),
                new SenderRequestFilters(fromCountryId, toCountryId, category), cursor, size);
    }

    @GetMapping("/me/sender-requests")
    public Page<SenderRequestView> myRequests(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return requests.mine(p.userId(), status, cursor, size);
    }

    @GetMapping("/sender-requests/{id}")
    public SenderRequestView request(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return requests.detail(p.userId(), id);
    }

    @PutMapping("/sender-requests/{id}")
    public SenderRequestView updateRequest(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id, @Valid @RequestBody SenderRequestBody body) {
        return requests.update(p.userId(), id, body.toInput());
    }

    @DeleteMapping("/sender-requests/{id}")
    public ResponseEntity<Void> deleteRequest(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        requests.delete(p.userId(), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/sender-requests/{id}/publish")
    public SenderRequestView publishRequest(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return requests.publish(p.userId(), id);
    }

    @PostMapping("/sender-requests/{id}/pause")
    public SenderRequestView pauseRequest(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return requests.pause(p.userId(), id);
    }

    @PostMapping("/sender-requests/{id}/close")
    public SenderRequestView closeRequest(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return requests.close(p.userId(), id);
    }

    @PostMapping("/sender-requests/{id}/reopen")
    public SenderRequestView reopenRequest(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return requests.reopen(p.userId(), id);
    }

    @PostMapping("/sender-requests/{id}/report")
    public ResponseEntity<Map<String, UUID>> reportRequest(
            @AuthenticationPrincipal DiasporumUserPrincipal p, @PathVariable UUID id,
            @Valid @RequestBody ReportBody body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id",
                requests.report(p.userId(), id, body.reason(), body.details())));
    }

    @GetMapping("/sender-requests/{id}/media/{mediaId}/download-url")
    public Map<String, String> requestMedia(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id, @PathVariable UUID mediaId) {
        return Map.of("downloadUrl", requests.mediaDownloadUrl(p.userId(), id, mediaId));
    }

    // =================== matching ===================

    @PostMapping("/match-requests")
    public ResponseEntity<MatchView> createMatch(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody MatchBody body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(matches.create(p.userId(),
                new MatchInput(body.senderRequestId(), body.journeyId(), body.message(),
                        body.idempotencyKey())));
    }

    @GetMapping("/match-requests")
    public Page<MatchView> listMatches(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String direction,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return matches.list(p.userId(), direction, status, cursor, size);
    }

    @GetMapping("/match-requests/{id}")
    public MatchView match(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return matches.detail(p.userId(), id);
    }

    @PostMapping("/match-requests/{id}/accept")
    public MatchView acceptMatch(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id, @Valid @RequestBody(required = false) NoteBody body) {
        return matches.accept(p.userId(), id, body == null ? null : body.responseNote());
    }

    @PostMapping("/match-requests/{id}/decline")
    public MatchView declineMatch(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id, @Valid @RequestBody(required = false) NoteBody body) {
        return matches.decline(p.userId(), id, body == null ? null : body.responseNote());
    }

    @PostMapping("/match-requests/{id}/cancel")
    public MatchView cancelMatch(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return matches.cancel(p.userId(), id);
    }

    @PostMapping("/match-requests/{id}/close")
    public MatchView closeMatch(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return matches.close(p.userId(), id);
    }

    @PostMapping("/match-requests/{id}/conversation")
    public MatchView matchConversation(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id) {
        return matches.openConversation(p.userId(), id);
    }
}
