package com.diasporum.backend.sparebag.internal.application.v2;

import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.bad;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.conflict;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.forbidden;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.notFound;

import com.diasporum.backend.messaging.MessagingApi;
import com.diasporum.backend.notifications.NotificationsApi;
import com.diasporum.backend.social.SocialApi;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Owner;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Page;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.Journey;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.MatchInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.MatchRequest;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.MatchView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderItem;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequest;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.Touched;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.JourneyRepository;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.MatchRequestRepository;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.SenderRequestRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Contact/matching between a sender request and a traveller journey
 * ({@code spare_bag_match_requests}, V39). Either owner may ask; the other
 * owner accepts or declines. Accepting moves the sender request to MATCHED,
 * opens the {@code SPARE_BAG_SENDER_REQUEST} context conversation through
 * {@link MessagingApi#ensureContextConversation} and expires competing
 * PENDING matches on the same request. The journey stays PUBLISHED.
 *
 * <p>States: PENDING -&gt; ACCEPTED | DECLINED (responder), CANCELLED
 * (requester), EXPIRED (worker / request matched or removed); ACCEPTED -&gt;
 * CLOSED (either participant).
 */
@Service
public class SpareBagMatchService {

    static final String CONTEXT_TYPE = "SPARE_BAG_SENDER_REQUEST";
    private static final int MAX_NOTE = 3000;

    private final MatchRequestRepository matches;
    private final SenderRequestRepository requestRows;
    private final JourneyRepository journeyRows;
    private final SenderRequestService requests;
    private final TravellerJourneyService journeys;
    private final SpareBagOwners owners;
    private final MessagingApi messaging;
    private final NotificationsApi notifications;
    private final SocialApi social;

    public SpareBagMatchService(MatchRequestRepository matches,
            SenderRequestRepository requestRows, JourneyRepository journeyRows,
            SenderRequestService requests, TravellerJourneyService journeys,
            SpareBagOwners owners, MessagingApi messaging, NotificationsApi notifications,
            SocialApi social) {
        this.matches = matches;
        this.requestRows = requestRows;
        this.journeyRows = journeyRows;
        this.requests = requests;
        this.journeys = journeys;
        this.owners = owners;
        this.messaging = messaging;
        this.notifications = notifications;
        this.social = social;
    }

    @Transactional
    public MatchView create(UUID actor, MatchInput in) {
        String key = SpareBagV2Support.trimToNull(in.idempotencyKey());
        if (key == null || key.length() > 120) {
            throw bad("IDEMPOTENCY_KEY_REQUIRED");
        }
        String message = SpareBagV2Support.trimToNull(in.message());
        if (message != null && message.length() > MAX_NOTE) {
            throw bad("MESSAGE_TOO_LONG");
        }
        String operationKey = "spare-bag-match:" + key;
        String requestHash = hash(in.senderRequestId() + "|" + in.journeyId() + "|" + message);
        matches.lock(actor + ":" + operationKey);
        var previous = matches.idempotent(actor, operationKey);
        if (previous.isPresent()) {
            if (!previous.get().requestHash().equals(requestHash)
                    || previous.get().matchRequestId() == null) {
                throw conflict("IDEMPOTENCY_KEY_REUSED");
            }
            return detail(actor, previous.get().matchRequestId());
        }

        // lock both postings in a stable (UUID) order
        SenderRequest r;
        Journey j;
        if (in.senderRequestId().compareTo(in.journeyId()) < 0) {
            r = requests.requireForUpdate(in.senderRequestId());
            j = journeys.requireForUpdate(in.journeyId());
        } else {
            j = journeys.requireForUpdate(in.journeyId());
            r = requests.requireForUpdate(in.senderRequestId());
        }
        boolean actorIsSender = r.ownerUserId().equals(actor);
        boolean actorIsTraveller = j.ownerUserId().equals(actor);
        if (actorIsSender && actorIsTraveller) {
            throw bad("CANNOT_MATCH_OWN_POSTINGS");
        }
        if (!actorIsSender && !actorIsTraveller) {
            throw forbidden("NOT_POSTING_OWNER");
        }
        // the counterpart must be visible to the actor (section 6.6) - else 404
        if (actorIsSender && !journeys.canView(actor, j)) {
            throw notFound("JOURNEY_NOT_FOUND");
        }
        if (actorIsTraveller && !requests.canView(actor, r)) {
            throw notFound("SENDER_REQUEST_NOT_FOUND");
        }
        if (!SenderRequestService.listable(r) || !TravellerJourneyService.listable(j)) {
            throw conflict("POSTING_NOT_AVAILABLE");
        }
        if (!r.fromCountryId().equals(j.fromCountryId())
                || !r.toCountryId().equals(j.toCountryId())) {
            throw bad("ROUTE_MISMATCH");
        }
        if (j.acceptedCategories() != null) {
            Set<String> accepted = new HashSet<>(j.acceptedCategories());
            boolean uncovered = requests.items(r.id()).stream().map(SenderItem::categoryKey)
                    .filter(Objects::nonNull).anyMatch(c -> !accepted.contains(c));
            if (uncovered) {
                throw bad("CATEGORY_NOT_ACCEPTED");
            }
        }
        UUID counterpart = actorIsSender ? j.ownerUserId() : r.ownerUserId();
        if (!social.canInteract(actor, counterpart)) {
            throw forbidden("BLOCKED");
        }

        var open = matches.openPair(r.id(), j.id());
        if (open.isPresent()) {
            if (open.get().requestedByUserId().equals(actor)) {
                matches.saveIdempotency(actor, operationKey, requestHash, open.get().id());
                return detail(actor, open.get().id());
            }
            throw conflict("MATCH_REQUEST_EXISTS");
        }
        UUID id = UUID.randomUUID();
        try {
            matches.insert(id, r.id(), j.id(), actor, message);
            matches.saveIdempotency(actor, operationKey, requestHash, id);
        } catch (DuplicateKeyException e) {
            throw conflict("MATCH_REQUEST_CONFLICT");
        } catch (DataIntegrityViolationException e) {
            throw SpareBagV2Support.translate(e, "MATCH_REQUEST_INVALID");
        }
        notifications.notify(counterpart, "SPARE_BAG_CONTACT_REQUEST",
                "New Spare Bag match request", r.fromCity() + " → " + r.toCity(),
                "SPARE_BAG_MATCH_REQUEST", id, "spare-bag-match-created:" + id);
        return detail(actor, id);
    }

    @Transactional(readOnly = true)
    public MatchView detail(UUID actor, UUID id) {
        MatchRequest m = matches.find(id).orElseThrow(() -> notFound("MATCH_REQUEST_NOT_FOUND"));
        Parties p = parties(m);
        if (!p.includes(actor)) {
            throw notFound("MATCH_REQUEST_NOT_FOUND");
        }
        return view(actor, m, p);
    }

    @Transactional(readOnly = true)
    public Page<MatchView> list(UUID actor, String direction, String status, String cursor,
            Integer size) {
        String d = SpareBagV2Support.upper(direction);
        if (d == null) {
            d = "INCOMING";
        }
        if (!Set.of("INCOMING", "OUTGOING").contains(d)) {
            throw bad("INVALID_MATCH_DIRECTION");
        }
        int limit = SpareBagV2Support.pageSize(size);
        var c = SpareBagV2Support.decode(cursor);
        List<MatchRequest> rows = matches.list(actor, d, SpareBagV2Support.upper(status),
                SpareBagV2Support.cursorInstant(c), c == null ? null : c.id(), limit + 1);
        String next = null;
        if (rows.size() > limit) {
            rows = rows.subList(0, limit);
            MatchRequest last = rows.get(limit - 1);
            next = SpareBagV2Support.cursor(last.createdAt(), last.id());
        }
        Map<UUID, SenderRequest> reqMap = new HashMap<>();
        requestRows.findAll(rows.stream().map(MatchRequest::senderRequestId)
                .collect(Collectors.toSet())).forEach(r -> reqMap.put(r.id(), r));
        Map<UUID, Journey> journeyMap = new HashMap<>();
        journeyRows.findAll(rows.stream().map(MatchRequest::journeyId)
                .collect(Collectors.toSet())).forEach(j -> journeyMap.put(j.id(), j));
        List<MatchView> items = new ArrayList<>();
        for (MatchRequest m : rows) {
            items.add(view(actor, m, new Parties(reqMap.get(m.senderRequestId()),
                    journeyMap.get(m.journeyId()))));
        }
        return new Page<>(items, next);
    }

    @Transactional
    public MatchView accept(UUID actor, UUID id, String note) {
        MatchRequest m = requirePendingResponse(actor, id, note);
        SenderRequest r;
        Journey j;
        if (m.senderRequestId().compareTo(m.journeyId()) < 0) {
            r = requests.requireForUpdate(m.senderRequestId());
            j = journeys.requireForUpdate(m.journeyId());
        } else {
            j = journeys.requireForUpdate(m.journeyId());
            r = requests.requireForUpdate(m.senderRequestId());
        }
        if (!SenderRequestService.listable(r)) {
            throw conflict("SENDER_REQUEST_NOT_AVAILABLE");
        }
        if (!TravellerJourneyService.listable(j)) {
            throw conflict("JOURNEY_NOT_AVAILABLE");
        }
        try {
            if (matches.respond(id, actor, "ACCEPTED",
                    SpareBagV2Support.trimToNull(note)) == 0) {
                throw conflict("INVALID_MATCH_TRANSITION");
            }
        } catch (DuplicateKeyException e) {
            // ux_spare_bag_match_accepted_request: another traveller won the request
            throw conflict("SENDER_REQUEST_NOT_AVAILABLE");
        }
        if (requestRows.transition(r.id(), Set.of("PUBLISHED"), "MATCHED") == 0) {
            throw conflict("SENDER_REQUEST_NOT_AVAILABLE");
        }
        UUID conversationId = messaging.ensureContextConversation(actor, null, CONTEXT_TYPE,
                r.id(), m.requestedByUserId(), null);
        matches.linkConversation(id, conversationId);
        for (Touched other : matches.expireOtherPending(r.id(), id)) {
            notifications.notify(other.ownerUserId(), "SPARE_BAG_CONTACT_REQUEST",
                    "Match request expired", "The request was matched with another traveller.",
                    "SPARE_BAG_MATCH_REQUEST", other.id(),
                    "spare-bag-match-expired:" + other.id());
        }
        notifications.notify(m.requestedByUserId(), "SPARE_BAG_CONTACT_REQUEST",
                "Match request accepted", r.fromCity() + " → " + r.toCity(),
                "SPARE_BAG_MATCH_REQUEST", id, "spare-bag-match-accepted:" + id);
        // the responder is one owner and the requester (notified above) the other,
        // so both sides of the new match are informed
        return detail(actor, id);
    }

    @Transactional
    public MatchView decline(UUID actor, UUID id, String note) {
        MatchRequest m = requirePendingResponse(actor, id, note);
        if (matches.respond(id, actor, "DECLINED", SpareBagV2Support.trimToNull(note)) == 0) {
            throw conflict("INVALID_MATCH_TRANSITION");
        }
        notifications.notify(m.requestedByUserId(), "SPARE_BAG_CONTACT_REQUEST",
                "Match request declined", "Your Spare Bag match request was declined.",
                "SPARE_BAG_MATCH_REQUEST", id, "spare-bag-match-declined:" + id);
        return detail(actor, id);
    }

    @Transactional
    public MatchView cancel(UUID actor, UUID id) {
        MatchRequest m = lockParticipant(actor, id);
        if (!m.requestedByUserId().equals(actor)) {
            throw forbidden("ONLY_REQUESTER_CAN_CANCEL");
        }
        if (matches.setStatus(id, "PENDING", "CANCELLED") == 0) {
            throw conflict("INVALID_MATCH_TRANSITION");
        }
        return detail(actor, id);
    }

    @Transactional
    public MatchView close(UUID actor, UUID id) {
        lockParticipant(actor, id);
        if (matches.setStatus(id, "ACCEPTED", "CLOSED") == 0) {
            throw conflict("INVALID_MATCH_TRANSITION");
        }
        return detail(actor, id);
    }

    /** Re-ensures the context conversation for an ACCEPTED match (idempotent). */
    @Transactional
    public MatchView openConversation(UUID actor, UUID id) {
        MatchRequest m = lockParticipant(actor, id);
        if (!"ACCEPTED".equals(m.status())) {
            throw conflict("MATCH_NOT_ACCEPTED");
        }
        Parties p = parties(m);
        UUID other = p.request().ownerUserId().equals(actor) ? p.journey().ownerUserId()
                : p.request().ownerUserId();
        UUID conversationId = messaging.ensureContextConversation(actor, null, CONTEXT_TYPE,
                m.senderRequestId(), other, null);
        if (!conversationId.equals(m.directConversationId())) {
            matches.linkConversation(id, conversationId);
        }
        return detail(actor, id);
    }

    // =================== helpers ===================

    private record Parties(SenderRequest request, Journey journey) {

        boolean includes(UUID user) {
            return request.ownerUserId().equals(user) || journey.ownerUserId().equals(user);
        }
    }

    private Parties parties(MatchRequest m) {
        SenderRequest r = requestRows.findAll(List.of(m.senderRequestId())).stream()
                .findFirst().orElseThrow(() -> notFound("MATCH_REQUEST_NOT_FOUND"));
        Journey j = journeyRows.findAll(List.of(m.journeyId())).stream().findFirst()
                .orElseThrow(() -> notFound("MATCH_REQUEST_NOT_FOUND"));
        return new Parties(r, j);
    }

    private MatchRequest lockParticipant(UUID actor, UUID id) {
        MatchRequest m = matches.findForUpdate(id)
                .orElseThrow(() -> notFound("MATCH_REQUEST_NOT_FOUND"));
        if (!parties(m).includes(actor)) {
            throw notFound("MATCH_REQUEST_NOT_FOUND");
        }
        return m;
    }

    private MatchRequest requirePendingResponse(UUID actor, UUID id, String note) {
        if (note != null && note.length() > MAX_NOTE) {
            throw bad("RESPONSE_NOTE_TOO_LONG");
        }
        MatchRequest m = lockParticipant(actor, id);
        if (m.requestedByUserId().equals(actor)) {
            throw forbidden("REQUESTER_CANNOT_RESPOND");
        }
        if (!"PENDING".equals(m.status())) {
            throw conflict("INVALID_MATCH_TRANSITION");
        }
        return m;
    }

    private MatchView view(UUID actor, MatchRequest m, Parties p) {
        UUID other = p.request().ownerUserId().equals(actor) ? p.journey().ownerUserId()
                : p.request().ownerUserId();
        Owner otherOwner = owners.owner(other);
        return new MatchView(m, p.request(), p.journey(), otherOwner,
                !m.requestedByUserId().equals(actor));
    }

    private static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
