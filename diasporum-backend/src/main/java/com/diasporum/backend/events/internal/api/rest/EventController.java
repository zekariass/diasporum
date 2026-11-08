package com.diasporum.backend.events.internal.api.rest;

import com.diasporum.backend.events.internal.application.EventService;
import com.diasporum.backend.events.internal.application.EventService.CategoryRow;
import com.diasporum.backend.events.internal.application.EventService.EventItem;
import com.diasporum.backend.events.internal.application.EventService.EventPage;
import com.diasporum.backend.events.internal.application.EventService.ParticipantCounts;
import com.diasporum.backend.events.internal.application.EventService.ParticipantPage;
import com.diasporum.backend.events.internal.application.EventService.RsvpResult;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
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
import org.springframework.web.server.ResponseStatusException;

/**
 * Events endpoints — actor always resolved from the JWT. Community-scope
 * events are only visible to active members; country-scope events to users
 * whose current country matches. RSVPs enforce capacity and waitlist rules.
 */
@RestController
@RequestMapping("/api/v1")
public class EventController {

    private final EventService service;

    public EventController(EventService service) {
        this.service = service;
    }

    // =================== request DTOs ===================

    /** Create-event request. Starts/ends are ISO-8601 instants. */
    public record CreateEventRequest(
            @NotNull UUID communityId,
            String visibilityScope,
            @NotNull UUID categoryId,
            UUID countryTopicCategoryId,
            @NotBlank @Size(max = 200) String title,
            @NotBlank @Size(max = 12000) String description,
            @NotBlank String eventMode,
            @NotNull Instant startsAt,
            Instant endsAt,
            @NotBlank String timezone,
            @Size(max = 200) String locationName,
            @Size(max = 2000) String externalUrl,
            Integer capacity,
            UUID coverMediaId,
            UUID businessAccountId,
            Boolean draft) {
    }

    /** Update-event request — null fields keep their current values.
     * visibilityScope may be switched between COMMUNITY and COUNTRY.
     * clearEndsAt/clearCountryTopic explicitly clear optional fields. */
    public record UpdateEventRequest(
            String visibilityScope,
            @Size(max = 200) String title,
            @Size(max = 12000) String description,
            String eventMode,
            Instant startsAt,
            Instant endsAt,
            Boolean clearEndsAt,
            @Size(max = 100) String timezone,
            @Size(max = 200) String locationName,
            @Size(max = 2000) String externalUrl,
            Integer capacity,
            UUID categoryId,
            UUID countryTopicCategoryId,
            Boolean clearCountryTopic,
            UUID coverMediaId,
            Boolean clearCover) {
    }

    public record RsvpRequest(@NotBlank String status) {
    }

    public record CancelRequest(@Size(max = 1000) String reason) {
    }

    public record ReportRequest(@NotBlank String reason,
            @Size(max = 4000) String details) {
    }

    // =================== categories ===================

    @GetMapping("/events/categories")
    public Map<String, Object> categories(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID countryId) {
        principal.userId();
        if (countryId == null) {
            return Map.of("items", service.categories(null));
        }
        return Map.of("items", service.categories(countryId));
    }

    // =================== lifecycle ===================

    @PostMapping("/events")
    public ResponseEntity<EventDetail> create(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @jakarta.validation.Valid @RequestBody CreateEventRequest req) {
        var item = service.create(principal.userId(), req.communityId(),
                req.visibilityScope(), req.categoryId(), req.countryTopicCategoryId(),
                req.title(), req.description(), req.eventMode(), req.startsAt(),
                req.endsAt(), req.timezone(), req.locationName(), req.externalUrl(),
                req.capacity(), req.coverMediaId(), req.businessAccountId(),
                Boolean.TRUE.equals(req.draft()));
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(toDetail(principal.userId(), item));
    }

    @GetMapping("/events/{eventId}")
    public EventDetail detail(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId) {
        return toDetail(principal.userId(), service.detail(principal.userId(),
                eventId));
    }

    @PatchMapping("/events/{eventId}")
    public EventDetail update(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId,
            @jakarta.validation.Valid @RequestBody UpdateEventRequest req) {
        return toDetail(principal.userId(), service.update(principal.userId(),
                eventId, req.visibilityScope(), req.title(), req.description(),
                req.eventMode(), req.startsAt(), req.endsAt(),
                Boolean.TRUE.equals(req.clearEndsAt()), req.timezone(),
                req.locationName(), req.externalUrl(), req.capacity(),
                req.categoryId(), req.countryTopicCategoryId(),
                Boolean.TRUE.equals(req.clearCountryTopic()), req.coverMediaId(),
                Boolean.TRUE.equals(req.clearCover())));
    }

    @PostMapping("/events/{eventId}/publish")
    public EventDetail publish(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId) {
        return toDetail(principal.userId(), service.publish(principal.userId(),
                eventId));
    }

    @PostMapping("/events/{eventId}/cancel")
    public EventDetail cancel(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId,
            @jakarta.validation.Valid @RequestBody(required = false)
            CancelRequest req) {
        return toDetail(principal.userId(), service.cancel(principal.userId(),
                eventId, req == null ? null : req.reason()));
    }

    @DeleteMapping("/events/{eventId}")
    public ResponseEntity<Void> delete(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId) {
        service.delete(principal.userId(), eventId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/events/{eventId}/cover/download-url")
    public Map<String, String> coverUrl(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId) {
        return Map.of("downloadUrl", service.coverDownloadUrl(
                principal.userId(), eventId));
    }

    // =================== discovery ===================

    @GetMapping("/events")
    public EventPage discover(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID communityId,
            @RequestParam(required = false) String scope,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) UUID topicCategoryId,
            @RequestParam(required = false) String mode,
            @RequestParam(required = false) String location,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        var viewer = principal.userId();
        var page = service.discover(viewer, communityId, scope, categoryId,
                topicCategoryId, mode, location, from, to, search, cursor, size);
        return new EventPage(page.items().stream()
                .map(i -> withManage(viewer, i)).toList(), page.nextCursor());
    }

    @GetMapping("/communities/{communityId}/events")
    public EventPage communityEvents(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID communityId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        var viewer = principal.userId();
        var page = service.communityEvents(viewer, communityId, cursor, size);
        return new EventPage(page.items().stream()
                .map(i -> withManage(viewer, i)).toList(), page.nextCursor());
    }

    private EventItem withManage(UUID viewer, EventItem item) {
        return new EventItem(item.event(), item.category(), item.counts(),
                item.myRsvp(), item.saved(), service.canManage(viewer,
                        item.event()));
    }

    // =================== RSVP ===================

    @PutMapping("/events/{eventId}/rsvp")
    public RsvpResult rsvp(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId,
            @jakarta.validation.Valid @RequestBody RsvpRequest req) {
        return service.setRsvp(principal.userId(), eventId, req.status());
    }

    @DeleteMapping("/events/{eventId}/rsvp")
    public RsvpResult removeRsvp(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId) {
        return service.removeRsvp(principal.userId(), eventId);
    }

    @GetMapping("/events/{eventId}/participants")
    public ParticipantPage participants(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return service.participants(principal.userId(), eventId, status, page,
                size);
    }

    // =================== saves ===================

    @PutMapping("/events/{eventId}/save")
    public ResponseEntity<Void> save(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId) {
        service.save(principal.userId(), eventId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/events/{eventId}/save")
    public ResponseEntity<Void> unsave(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId) {
        service.unsave(principal.userId(), eventId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me/events/saved")
    public Map<String, Object> savedEvents(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return service.savedEvents(principal.userId(), page, size);
    }

    // =================== my events ===================

    @GetMapping("/me/events")
    public Map<String, Object> myEvents(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(defaultValue = "organized") String role,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return service.myEvents(principal.userId(), role, page, size);
    }

    // =================== reporting ===================

    @PostMapping("/events/{eventId}/report")
    public ResponseEntity<Map<String, Object>> report(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID eventId,
            @jakarta.validation.Valid @RequestBody ReportRequest req) {
        UUID id = service.report(principal.userId(), eventId, req.reason(),
                req.details());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(Map.of("id", id.toString()));
    }

    // =================== detail assembly ===================

    /** Detail DTO — event row, category, counts, viewer flags, organizer. */
    public record EventDetail(EventService.EventRow event, CategoryRow category,
            ParticipantCounts counts, String myRsvp, boolean saved,
            boolean canManage, ProfileSummary organizer,
            String businessAccountName) {
    }

    private EventDetail toDetail(UUID viewer, EventItem item) {
        ProfileSummary organizer = null;
        String businessName = null;
        try {
            organizer = service.organizer(item.event().id()).orElse(null);
            businessName = service.businessAccountName(item.event().id())
                    .orElse(null);
        } catch (ResponseStatusException e) {
            // event row removed mid-request — item fields stay authoritative
        }
        return new EventDetail(item.event(), item.category(), item.counts(),
                item.myRsvp(), item.saved(), item.canManage(), organizer,
                businessName);
    }
}
