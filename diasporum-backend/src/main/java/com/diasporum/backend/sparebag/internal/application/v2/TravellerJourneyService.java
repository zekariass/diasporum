package com.diasporum.backend.sparebag.internal.application.v2;

import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.bad;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.conflict;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.forbidden;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.notFound;

import com.diasporum.backend.moderation.ModerationApi;
import com.diasporum.backend.notifications.NotificationsApi;
import com.diasporum.backend.social.SocialApi;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Owner;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Page;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.CountryRules;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.Journey;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.JourneyFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.JourneyInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.JourneyView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.ModerationItem;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.TravellerProfile;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.TravellerSummary;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.JourneyRepository;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.MatchRequestRepository;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.TravellerProfileRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Traveller journeys ("Traveller Journeys" tab). Lifecycle
 * DRAFT -&gt; PENDING_REVIEW (MANUAL) | PUBLISHED (AUTO_APPROVE) -&gt; PAUSED /
 * CLOSED / EXPIRED / REMOVED; journeys have no MATCHED state (one traveller
 * can carry for several senders). {@code travel_date >= CURRENT_DATE} is
 * enforced whenever a journey becomes or stays publicly listed.
 */
@Service
public class TravellerJourneyService {

    private static final Set<String> EDITABLE = Set.of("DRAFT", "PENDING_REVIEW",
            "PUBLISHED", "PAUSED");
    private static final Set<String> CLOSABLE = EDITABLE;

    private final JourneyRepository journeys;
    private final TravellerProfileRepository profiles;
    private final TravellerProfileService travellers;
    private final MatchRequestRepository matches;
    private final SpareBagReferenceService reference;
    private final SpareBagVisibility visibility;
    private final SpareBagModeration moderation;
    private final SpareBagV2Properties properties;
    private final SpareBagOwners owners;
    private final NotificationsApi notifications;
    private final SocialApi social;
    private final ModerationApi reports;

    public TravellerJourneyService(JourneyRepository journeys,
            TravellerProfileRepository profiles, TravellerProfileService travellers,
            MatchRequestRepository matches, SpareBagReferenceService reference,
            SpareBagVisibility visibility, SpareBagModeration moderation,
            SpareBagV2Properties properties, SpareBagOwners owners,
            NotificationsApi notifications, SocialApi social, ModerationApi reports) {
        this.journeys = journeys;
        this.profiles = profiles;
        this.travellers = travellers;
        this.matches = matches;
        this.reference = reference;
        this.visibility = visibility;
        this.moderation = moderation;
        this.properties = properties;
        this.owners = owners;
        this.notifications = notifications;
        this.social = social;
        this.reports = reports;
    }

    // =================== owner lifecycle ===================

    @Transactional
    public JourneyView create(UUID actor, JourneyInput input) {
        TravellerProfile profile = travellers.requireActiveProfile(actor);
        JourneyInput in = normalize(input);
        UUID id = UUID.randomUUID();
        try {
            journeys.insert(id, profile.id(), in);
        } catch (DataIntegrityViolationException e) {
            throw SpareBagV2Support.translate(e, "JOURNEY_INVALID");
        }
        return view(actor, requireJourney(id));
    }

    @Transactional
    public JourneyView update(UUID actor, UUID id, JourneyInput input) {
        Journey current = requireOwnedForUpdate(actor, id);
        if (!EDITABLE.contains(current.status())) {
            throw conflict("JOURNEY_NOT_EDITABLE");
        }
        JourneyInput in = normalize(input);
        try {
            journeys.update(id, in);
        } catch (DataIntegrityViolationException e) {
            throw SpareBagV2Support.translate(e, "JOURNEY_INVALID");
        }
        Journey updated = requireJourney(id);
        if (!"DRAFT".equals(current.status())) {
            requirePublishable(updated);
        }
        if (!properties.autoApprove()
                && Set.of("PUBLISHED", "PAUSED").contains(current.status())) {
            // a substantive edit of a reviewed journey goes back through review
            journeys.transition(id, Set.of(current.status()), "PENDING_REVIEW");
            moderation.submit(SpareBagModeration.TRAVELLER_JOURNEY, id);
            matches.expirePendingForJourney(id);
        }
        return view(actor, requireJourney(id));
    }

    @Transactional
    public JourneyView publish(UUID actor, UUID id) {
        Journey j = requireOwnedForUpdate(actor, id);
        switch (j.status()) {
            case "DRAFT" -> {
                requirePublishable(j);
                String target = properties.autoApprove() ? "PUBLISHED" : "PENDING_REVIEW";
                transition(id, Set.of("DRAFT"), target);
                if ("PENDING_REVIEW".equals(target)) {
                    moderation.submit(SpareBagModeration.TRAVELLER_JOURNEY, id);
                }
            }
            case "PAUSED" -> {
                // already reviewed: resuming does not re-enter review
                requirePublishable(j);
                transition(id, Set.of("PAUSED"), "PUBLISHED");
            }
            default -> throw conflict("JOURNEY_NOT_PUBLISHABLE");
        }
        return view(actor, requireJourney(id));
    }

    @Transactional
    public JourneyView pause(UUID actor, UUID id) {
        requireOwnedForUpdate(actor, id);
        transition(id, Set.of("PUBLISHED"), "PAUSED");
        return view(actor, requireJourney(id));
    }

    @Transactional
    public JourneyView close(UUID actor, UUID id) {
        requireOwnedForUpdate(actor, id);
        transition(id, CLOSABLE, "CLOSED");
        matches.expirePendingForJourney(id);
        return view(actor, requireJourney(id));
    }

    @Transactional
    public void delete(UUID actor, UUID id) {
        requireOwnedForUpdate(actor, id);
        if (journeys.softDeleteDraft(id) == 0) {
            throw conflict("JOURNEY_NOT_DELETABLE");
        }
    }

    // =================== reads ===================

    @Transactional(readOnly = true)
    public JourneyView detail(UUID actor, UUID id) {
        Journey j = requireJourney(id);
        if (!canView(actor, j)) {
            throw notFound("JOURNEY_NOT_FOUND");
        }
        return view(actor, j);
    }

    @Transactional(readOnly = true)
    public Page<JourneyView> search(UUID actor, JourneyFilters filters, String cursor,
            Integer size) {
        int limit = SpareBagV2Support.pageSize(size);
        if (filters.dateFrom() != null && filters.dateTo() != null
                && filters.dateTo().isBefore(filters.dateFrom())) {
            throw bad("INVALID_DATE_RANGE");
        }
        JourneyFilters f = new JourneyFilters(filters.fromCountryId(), filters.toCountryId(),
                filters.dateFrom(), filters.dateTo(), category(filters.category()),
                filters.verifiedOnly());
        Set<UUID> countries = visibility.visibleCountries(actor);
        if (countries.isEmpty()) {
            return new Page<>(List.of(), null);
        }
        var c = SpareBagV2Support.decode(cursor);
        List<Journey> rows = journeys.search(countries, f, SpareBagV2Support.cursorDate(c),
                c == null ? null : c.id(), limit + 1);
        String next = null;
        if (rows.size() > limit) {
            rows = rows.subList(0, limit);
            Journey last = rows.get(limit - 1);
            next = SpareBagV2Support.cursor(last.travelDate(), last.id());
        }
        Set<UUID> blocked = social.blockedWith(actor,
                rows.stream().map(Journey::ownerUserId).collect(Collectors.toSet()));
        return new Page<>(views(actor, rows.stream()
                .filter(j -> !blocked.contains(j.ownerUserId())).toList()), next);
    }

    @Transactional(readOnly = true)
    public Page<JourneyView> mine(UUID actor, String status, String cursor, Integer size) {
        int limit = SpareBagV2Support.pageSize(size);
        var c = SpareBagV2Support.decode(cursor);
        List<Journey> rows = journeys.mine(actor, SpareBagV2Support.upper(status),
                SpareBagV2Support.cursorInstant(c), c == null ? null : c.id(), limit + 1);
        String next = null;
        if (rows.size() > limit) {
            rows = rows.subList(0, limit);
            Journey last = rows.get(limit - 1);
            next = SpareBagV2Support.cursor(last.createdAt(), last.id());
        }
        return new Page<>(views(actor, rows), next);
    }

    @Transactional
    public UUID report(UUID actor, UUID id, String reason, String details) {
        Journey j = requireJourney(id);
        if (j.ownerUserId().equals(actor)) {
            throw bad("CANNOT_REPORT_OWN_POSTING");
        }
        if (!canView(actor, j)) {
            throw notFound("JOURNEY_NOT_FOUND");
        }
        return reports.report(actor, SpareBagModeration.TRAVELLER_JOURNEY, id,
                j.fromCountryId(), null, reason, details);
    }

    // =================== admin moderation ===================

    @Transactional(readOnly = true)
    public List<ModerationItem> pendingReview(UUID actor, String cursor, Integer size) {
        Set<UUID> scope = moderation.moderatorScope(actor);
        var c = SpareBagV2Support.decode(cursor);
        return journeys.pendingReview(scope, SpareBagV2Support.cursorInstant(c),
                c == null ? null : c.id(), SpareBagV2Support.pageSize(size));
    }

    @Transactional
    public JourneyView moderate(UUID actor, UUID id, String action, String reason) {
        String a = SpareBagV2Support.upper(action);
        String why = SpareBagV2Support.trimToNull(reason);
        Journey j = journeys.findForUpdate(id).orElseThrow(() -> notFound("JOURNEY_NOT_FOUND"));
        moderation.requireModerator(actor, j.fromCountryId(), j.toCountryId());
        switch (a == null ? "" : a) {
            case "APPROVE" -> {
                requirePublishable(j);
                moderated(id, Set.of("PENDING_REVIEW"), "PUBLISHED");
                moderation.decide(actor, SpareBagModeration.TRAVELLER_JOURNEY, id,
                        j.ownerUserId(), j.fromCountryId(), "APPROVE", "APPROVE",
                        "APPROVE_CONTENT", why == null ? "Approved" : why);
                notifyOwner(j, "Journey approved", "Your journey is now live.");
            }
            case "REJECT" -> {
                requireReason(why);
                moderated(id, Set.of("PENDING_REVIEW"), "DRAFT");
                moderation.decide(actor, SpareBagModeration.TRAVELLER_JOURNEY, id,
                        j.ownerUserId(), j.fromCountryId(), "REJECT", "REJECT",
                        "REJECT_LISTING", why);
                notifyOwner(j, "Journey needs changes", why);
            }
            case "REMOVE" -> {
                requireReason(why);
                moderated(id, Set.of("DRAFT", "PENDING_REVIEW", "PUBLISHED", "PAUSED",
                        "CLOSED", "EXPIRED"), "REMOVED");
                matches.expirePendingForJourney(id);
                moderation.decide(actor, SpareBagModeration.TRAVELLER_JOURNEY, id,
                        j.ownerUserId(), j.fromCountryId(), "REMOVE", "REJECT",
                        "REMOVE_CONTENT", why);
                notifyOwner(j, "Journey removed", why);
            }
            default -> throw bad("INVALID_MODERATION_ACTION");
        }
        return view(actor, requireJourney(id));
    }

    // =================== shared ===================

    public Journey requireJourney(UUID id) {
        return journeys.find(id).orElseThrow(() -> notFound("JOURNEY_NOT_FOUND"));
    }

    public Journey requireForUpdate(UUID id) {
        return journeys.findForUpdate(id).orElseThrow(() -> notFound("JOURNEY_NOT_FOUND"));
    }

    /** Listed publicly right now (status, traveller and dates). */
    public static boolean listable(Journey j) {
        return "PUBLISHED".equals(j.status()) && "ACTIVE".equals(j.travellerStatus())
                && !j.effectiveEndDate().isBefore(LocalDate.now())
                && (j.closesAt() == null || j.closesAt().isAfter(Instant.now()));
    }

    /**
     * Owner, a moderator for the route, the sender side of a match on this
     * journey, or anyone the section 6.6 rule admits while it is listed.
     */
    public boolean canView(UUID actor, Journey j) {
        if (j.ownerUserId().equals(actor)) {
            return true;
        }
        if (moderation.isModerator(actor, j.fromCountryId(), j.toCountryId())) {
            return true;
        }
        if (!social.canInteract(actor, j.ownerUserId())) {
            return false;
        }
        if (matches.senderParticipatesInJourney(j.id(), actor)) {
            return true;
        }
        return listable(j) && visibility.canSee(actor, j.fromCountryId(), j.toCountryId());
    }

    public List<JourneyView> views(UUID actor, Collection<Journey> rows) {
        Map<UUID, Owner> ownerMap = owners.owners(
                rows.stream().map(Journey::ownerUserId).collect(Collectors.toSet()));
        Map<UUID, TravellerProfile> profileMap = new HashMap<>();
        profiles.findAll(rows.stream().map(Journey::travellerProfileId)
                .collect(Collectors.toSet())).forEach(p -> profileMap.put(p.id(), p));
        List<JourneyView> out = new ArrayList<>();
        for (Journey j : rows) {
            Owner o = ownerMap.get(j.ownerUserId());
            TravellerProfile p = profileMap.get(j.travellerProfileId());
            String name = p != null && p.displayName() != null ? p.displayName()
                    : o == null ? null : o.displayName();
            out.add(new JourneyView(j, new TravellerSummary(j.travellerProfileId(),
                    j.ownerUserId(), name, o == null ? null : o.username(),
                    o == null ? null : o.avatarMediaId(),
                    "VERIFIED".equals(j.travellerVerificationStatus())),
                    j.ownerUserId().equals(actor)));
        }
        return out;
    }

    public JourneyView view(UUID actor, Journey j) {
        return views(actor, List.of(j)).get(0);
    }

    /** Country gate, prohibited categories, travel date, closes_at, traveller status. */
    private void requirePublishable(Journey j) {
        CountryRules rules = reference.requirePostableRoute(j.fromCountryId(), j.toCountryId());
        SpareBagReferenceService.rejectProhibited(rules, j.acceptedCategories());
        if (j.travelDate().isBefore(LocalDate.now())) {
            throw bad("JOURNEY_TRAVEL_DATE_PAST");
        }
        if (j.closesAt() != null && !j.closesAt().isAfter(Instant.now())) {
            throw bad("CLOSES_AT_PAST");
        }
        if (!"ACTIVE".equals(j.travellerStatus())) {
            throw conflict("TRAVELLER_PROFILE_NOT_ACTIVE");
        }
    }

    /** Trims, normalises categories/currency and validates countries + airports. */
    private JourneyInput normalize(JourneyInput in) {
        CountryRules rules = reference.requirePostableRoute(in.fromCountryId(),
                in.toCountryId());
        List<String> categories = reference.validCategories(in.acceptedCategories());
        SpareBagReferenceService.rejectProhibited(rules, categories);
        if (in.fromAirportId() != null
                && !reference.airportCountry(in.fromAirportId()).equals(in.fromCountryId())) {
            throw bad("JOURNEY_AIRPORT_COUNTRY_MISMATCH");
        }
        if (in.toAirportId() != null
                && !reference.airportCountry(in.toAirportId()).equals(in.toCountryId())) {
            throw bad("JOURNEY_AIRPORT_COUNTRY_MISMATCH");
        }
        return new JourneyInput(in.fromCountryId(),
                SpareBagV2Support.trimToNull(in.fromCity()), in.toCountryId(),
                SpareBagV2Support.trimToNull(in.toCity()), in.fromAirportId(),
                in.toAirportId(), SpareBagV2Support.trimToNull(in.pickupLocation()),
                SpareBagV2Support.trimToNull(in.deliveryLocation()), in.travelDate(),
                in.travelDateEnd(), in.availableCapacityKg(), in.maxSingleParcelKg(),
                in.pricePerKg(), in.pricePerPiece(),
                SpareBagV2Support.upper(in.priceCurrency()), categories,
                SpareBagV2Support.trimToNull(in.notes()), in.closesAt());
    }

    private String category(String key) {
        return key == null || key.isBlank() ? null
                : reference.validCategories(List.of(key)).get(0);
    }

    private Journey requireOwnedForUpdate(UUID actor, UUID id) {
        Journey j = requireForUpdate(id);
        if (!j.ownerUserId().equals(actor)) {
            if (canView(actor, j)) {
                throw forbidden("NOT_JOURNEY_OWNER");
            }
            throw notFound("JOURNEY_NOT_FOUND");
        }
        return j;
    }

    private void transition(UUID id, Set<String> from, String to) {
        if (journeys.transition(id, from, to) == 0) {
            throw conflict("INVALID_JOURNEY_TRANSITION");
        }
    }

    private void moderated(UUID id, Set<String> from, String to) {
        if (journeys.transition(id, from, to) == 0) {
            throw conflict("MODERATION_STATE_INVALID");
        }
    }

    private static void requireReason(String reason) {
        if (reason == null) {
            throw bad("REASON_REQUIRED");
        }
    }

    private void notifyOwner(Journey j, String title, String body) {
        notifications.notify(j.ownerUserId(), "SPARE_BAG_LISTING_UPDATE", title, body,
                SpareBagModeration.TRAVELLER_JOURNEY, j.id(),
                "spare-bag-v2-moderation:" + j.id() + ":" + UUID.randomUUID());
    }
}
