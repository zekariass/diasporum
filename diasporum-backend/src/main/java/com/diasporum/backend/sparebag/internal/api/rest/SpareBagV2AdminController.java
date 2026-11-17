package com.diasporum.backend.sparebag.internal.api.rest;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.sparebag.internal.application.v2.SenderRequestService;
import com.diasporum.backend.sparebag.internal.application.v2.SpareBagReferenceService;
import com.diasporum.backend.sparebag.internal.application.v2.TravellerJourneyService;
import com.diasporum.backend.sparebag.internal.application.v2.TravellerProfileService;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Page;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.CountryConfig;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.CountryConfigInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.JourneyView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequestView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.TravellerProfileView;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Admin surface for v10.15 Spare Bag: moderation of sender requests and
 * journeys (GLOBAL admin/moderator or COUNTRY moderator for either route end),
 * traveller verification and country config (platform admin only). Roles are
 * asserted in the services, as everywhere else in the codebase.
 */
@RestController
@RequestMapping("/api/v1/admin/spare-bag")
public class SpareBagV2AdminController {

    private final SenderRequestService requests;
    private final TravellerJourneyService journeys;
    private final TravellerProfileService travellers;
    private final SpareBagReferenceService reference;

    public SpareBagV2AdminController(SenderRequestService requests,
            TravellerJourneyService journeys, TravellerProfileService travellers,
            SpareBagReferenceService reference) {
        this.requests = requests;
        this.journeys = journeys;
        this.travellers = travellers;
        this.reference = reference;
    }

    record ModerationBody(@NotBlank String action, @Size(max = 1000) String reason) {
    }

    record VerificationBody(@NotBlank String decision, @Size(max = 1000) String reason) {
    }

    record CountryConfigBody(Boolean enabled, Boolean requiresItemDisclosure,
            List<String> prohibitedCategories, @Size(max = 5000) String legalNotice) {
    }

    @GetMapping("/moderation")
    public Map<String, Object> pending(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam String type, @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return switch (type.trim().toUpperCase()) {
            case "SENDER_REQUEST" -> Map.of("items",
                    requests.pendingReview(p.userId(), cursor, size));
            case "JOURNEY" -> Map.of("items", journeys.pendingReview(p.userId(), cursor, size));
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "INVALID_MODERATION_TYPE");
        };
    }

    @PostMapping("/sender-requests/{id}/moderation")
    public SenderRequestView moderateRequest(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id, @Valid @RequestBody ModerationBody body) {
        return requests.moderate(p.userId(), id, body.action(), body.reason());
    }

    @PostMapping("/journeys/{id}/moderation")
    public JourneyView moderateJourney(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id, @Valid @RequestBody ModerationBody body) {
        return journeys.moderate(p.userId(), id, body.action(), body.reason());
    }

    @GetMapping("/traveller-verifications")
    public Page<TravellerProfileView> verifications(
            @AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return travellers.pendingVerifications(p.userId(), cursor, size);
    }

    @PostMapping("/traveller-profiles/{id}/verification")
    public TravellerProfileView verify(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID id, @Valid @RequestBody VerificationBody body) {
        return travellers.decideVerification(p.userId(), id, body.decision(), body.reason());
    }

    @PutMapping("/country-config/{countryId}")
    public CountryConfig countryConfig(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID countryId, @Valid @RequestBody CountryConfigBody body) {
        return reference.upsertCountryConfig(p.userId(), countryId, new CountryConfigInput(
                body.enabled(), body.requiresItemDisclosure(), body.prohibitedCategories(),
                body.legalNotice()));
    }
}
