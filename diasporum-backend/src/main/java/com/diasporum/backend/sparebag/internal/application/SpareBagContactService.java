package com.diasporum.backend.sparebag.internal.application;

import com.diasporum.backend.messaging.MessagingApi;
import com.diasporum.backend.notifications.NotificationsApi;
import com.diasporum.backend.social.SocialApi;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ContactInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ContactRequest;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ContactView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Listing;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ListingView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Owner;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Page;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.SpareBagContactRepository;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.SpareBagListingRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Compatible-listing contact requests and their contextual conversations. */
@Service
public class SpareBagContactService {

    private static final int DEFAULT_PAGE = 20;
    private static final int MAX_PAGE = 50;
    private static final Set<String> PRICE_UNITS = Set.of("PER_KG", "PER_PARCEL");
    private static final Set<String> REPORT_REASONS = Set.of("SPAM", "SCAM",
            "HARASSMENT", "HATE", "SEXUAL_MISCONDUCT", "MISINFORMATION",
            "IMPERSONATION", "PRIVACY", "OTHER");

    private final SpareBagContactRepository repository;
    private final SpareBagListingRepository listings;
    private final SpareBagListingService listingService;
    private final MessagingApi messaging;
    private final NotificationsApi notifications;
    private final SocialApi social;

    public SpareBagContactService(SpareBagContactRepository repository,
            SpareBagListingRepository listings, SpareBagListingService listingService,
            MessagingApi messaging, NotificationsApi notifications, SocialApi social) {
        this.repository = repository;
        this.listings = listings;
        this.listingService = listingService;
        this.messaging = messaging;
        this.notifications = notifications;
        this.social = social;
    }

    @Transactional
    public ContactView create(UUID actor, ContactInput in) {
        validate(in);
        String operationKey = "spare-bag-contact:" + in.idempotencyKey();
        String requestHash = hash(in);
        repository.lock(actor + ":" + operationKey);
        var previous = repository.idempotent(actor, operationKey);
        if (previous.isPresent()) {
            if (!previous.get().requestHash().equals(requestHash)
                    || previous.get().contactRequestId() == null) {
                throw conflict("IDEMPOTENCY_KEY_REUSED");
            }
            return detail(actor, previous.get().contactRequestId());
        }

        UUID firstId = in.ownListingId().compareTo(in.targetListingId()) < 0
                ? in.ownListingId() : in.targetListingId();
        UUID secondId = firstId.equals(in.ownListingId())
                ? in.targetListingId() : in.ownListingId();
        Listing first = listingService.requireForUpdate(firstId);
        Listing second = listingService.requireForUpdate(secondId);
        Listing own = in.ownListingId().equals(first.id()) ? first : second;
        Listing target = in.targetListingId().equals(first.id()) ? first : second;
        if (!own.ownerUserId().equals(actor)) throw forbidden("NOT_LISTING_OWNER");
        if (own.ownerUserId().equals(target.ownerUserId())
                || own.listingType().equals(target.listingType())) {
            throw bad("INCOMPATIBLE_LISTING_PAIR");
        }
        listingService.requireViewable(actor, target);
        requireEligiblePair(own, target);
        if (!social.canInteract(actor, target.ownerUserId())) throw forbidden("BLOCKED");

        UUID senderId = "SENDER_REQUEST".equals(own.listingType()) ? own.id() : target.id();
        UUID passengerId = "PASSENGER_OFFER".equals(own.listingType()) ? own.id() : target.id();
        var pending = repository.pendingPair(senderId, passengerId);
        if (pending.isPresent()) {
            if (pending.get().requestedByUserId().equals(actor)) {
                repository.saveIdempotency(actor, operationKey, requestHash, pending.get().id());
                return detail(actor, pending.get().id());
            }
            throw conflict("CONTACT_REQUEST_EXISTS");
        }

        UUID id = UUID.randomUUID();
        ContactRequest created;
        try {
            created = repository.insert(id, senderId, passengerId, actor, in);
            repository.saveIdempotency(actor, operationKey, requestHash, id);
        } catch (DataIntegrityViolationException e) {
            throw conflict("CONTACT_REQUEST_CONFLICT");
        }
        notifications.notify(target.ownerUserId(), "SPARE_BAG_CONTACT_REQUEST",
                "New Spare Bag contact request", own.title(),
                "SPARE_BAG_CONTACT_REQUEST", id, "spare-bag-contact-created:" + id);
        return detail(actor, created.id());
    }

    @Transactional(readOnly = true)
    public ContactView detail(UUID actor, UUID id) {
        ContactRequest contact = repository.find(id)
                .orElseThrow(() -> notFound("CONTACT_REQUEST_NOT_FOUND"));
        Listing sender = listingService.requireListing(contact.senderListingId());
        Listing passenger = listingService.requireListing(contact.passengerListingId());
        requireParticipant(actor, contact, sender, passenger);
        return contactView(actor, contact, sender, passenger);
    }

    @Transactional(readOnly = true)
    public Page<ContactView> list(UUID actor, String direction, String cursor, int size) {
        if (direction != null && !Set.of("INCOMING", "OUTGOING").contains(direction)) {
            throw bad("INVALID_CONTACT_DIRECTION");
        }
        Instant ts = null;
        UUID id = null;
        if (cursor != null && !cursor.isBlank()) {
            String[] parts = decode(cursor);
            ts = Instant.parse(parts[0]);
            id = UUID.fromString(parts[1]);
        }
        int limit = clamp(size);
        List<ContactRequest> rows = repository.forUser(actor, direction, ts, id, limit + 1);
        boolean hasMore = rows.size() > limit;
        List<ContactRequest> pageRows = hasMore ? new ArrayList<>(rows.subList(0, limit)) : rows;
        String next = hasMore ? encode(pageRows.getLast().createdAt().toString(),
                pageRows.getLast().id()) : null;
        List<UUID> listingIds = new ArrayList<>();
        for (ContactRequest contact : pageRows) {
            listingIds.add(contact.senderListingId());
            listingIds.add(contact.passengerListingId());
        }
        Map<UUID, Listing> listingRows = listings.findAll(listingIds).stream()
                .collect(Collectors.toMap(Listing::id, Function.identity()));
        List<Listing> orderedListings = listingIds.stream().map(listingRows::get)
                .filter(java.util.Objects::nonNull).toList();
        Map<UUID, ListingView> views = listingService.views(actor, orderedListings).stream()
                .collect(Collectors.toMap(v -> v.listing().id(), Function.identity(),
                        (a, b) -> a));
        List<ContactView> items = pageRows.stream().map(contact -> {
            ListingView sender = views.get(contact.senderListingId());
            ListingView passenger = views.get(contact.passengerListingId());
            Owner other = otherOwner(actor, sender, passenger);
            return new ContactView(contact, sender, passenger, other,
                    !contact.requestedByUserId().equals(actor));
        }).toList();
        return new Page<>(items, next);
    }

    @Transactional
    public ContactView accept(UUID actor, UUID id, String note) {
        ContactRequest contact = requirePendingResponse(actor, id, note);
        UUID firstId = contact.senderListingId().compareTo(contact.passengerListingId()) < 0
                ? contact.senderListingId() : contact.passengerListingId();
        UUID secondId = firstId.equals(contact.senderListingId())
                ? contact.passengerListingId() : contact.senderListingId();
        Listing first = listingService.requireForUpdate(firstId);
        Listing second = listingService.requireForUpdate(secondId);
        if (!"PUBLISHED".equals(first.status()) || !"PUBLISHED".equals(second.status())) {
            throw conflict("LISTING_NOT_ELIGIBLE");
        }
        repository.respond(id, actor, "ACCEPTED", note);
        ContactRequest accepted = repository.find(id).orElseThrow();
        UUID recipient = otherUser(actor, accepted);
        UUID conversationId = messaging.ensureContextConversation(actor, null,
                "SPARE_BAG_CONTACT", id, recipient, null);
        repository.linkConversation(id, conversationId);
        listings.setStatus(accepted.senderListingId(), "MATCHED");
        listings.setStatus(accepted.passengerListingId(), "MATCHED");
        notifications.notify(recipient, "SPARE_BAG_CONTACT_REQUEST",
                "Spare Bag contact request accepted", "You can now arrange handover.",
                "SPARE_BAG_CONTACT_REQUEST", id, "spare-bag-contact-accepted:" + id);
        notifyMatched(accepted.senderListingId());
        notifyMatched(accepted.passengerListingId());
        return detail(actor, id);
    }

    @Transactional
    public ContactView decline(UUID actor, UUID id, String note) {
        requirePendingResponse(actor, id, note);
        repository.respond(id, actor, "DECLINED", note);
        ContactRequest updated = repository.find(id).orElseThrow();
        notifications.notify(updated.requestedByUserId(), "SPARE_BAG_CONTACT_REQUEST",
                "Spare Bag contact request declined", "The contact request was declined.",
                "SPARE_BAG_CONTACT_REQUEST", id, "spare-bag-contact-declined:" + id);
        return detail(actor, id);
    }

    @Transactional
    public ContactView cancel(UUID actor, UUID id) {
        ContactRequest contact = requireParticipantContact(actor, id);
        if (!contact.requestedByUserId().equals(actor)) {
            throw forbidden("ONLY_REQUESTER_CAN_CANCEL");
        }
        if (!"PENDING".equals(contact.status())) throw conflict("INVALID_CONTACT_TRANSITION");
        repository.setStatus(id, "CANCELLED");
        UUID other = otherUser(actor, contact);
        notifications.notify(other, "SPARE_BAG_CONTACT_REQUEST",
                "Spare Bag contact request cancelled", "The contact request was cancelled.",
                "SPARE_BAG_CONTACT_REQUEST", id, "spare-bag-contact-cancelled:" + id);
        return detail(actor, id);
    }

    @Transactional
    public ContactView close(UUID actor, UUID id) {
        ContactRequest contact = requireParticipantContact(actor, id);
        if (!"ACCEPTED".equals(contact.status())) throw conflict("INVALID_CONTACT_TRANSITION");
        repository.setStatus(id, "CLOSED");
        UUID other = otherUser(actor, contact);
        notifications.notify(other, "SPARE_BAG_CONTACT_REQUEST",
                "Spare Bag contact closed", "The contact request was closed.",
                "SPARE_BAG_CONTACT_REQUEST", id, "spare-bag-contact-closed:" + id);
        return detail(actor, id);
    }

    @Transactional
    public ContactView openConversation(UUID actor, UUID id) {
        ContactRequest contact = requireParticipantContact(actor, id);
        if (!"ACCEPTED".equals(contact.status())) throw conflict("CONTACT_NOT_ACCEPTED");
        if (contact.directConversationId() == null) {
            UUID conversation = messaging.ensureContextConversation(actor, null,
                    "SPARE_BAG_CONTACT", id, otherUser(actor, contact), null);
            repository.linkConversation(id, conversation);
        }
        return detail(actor, id);
    }

    @Transactional
    public UUID report(UUID actor, UUID id, String reason, String details) {
        ContactRequest contact = requireParticipantContact(actor, id);
        if (!REPORT_REASONS.contains(reason)) throw bad("INVALID_REPORT_REASON");
        if (details != null && details.length() > 4000) throw bad("REPORT_DETAILS_TOO_LONG");
        if (listings.hasOpenReport(actor, "SPARE_BAG_CONTACT_REQUEST", id)) {
            throw conflict("REPORT_DUPLICATE");
        }
        Listing sender = listingService.requireListing(contact.senderListingId());
        return listings.report(actor, sender.originAirport().countryId(), sender.communityId(),
                "SPARE_BAG_CONTACT_REQUEST", id, reason, details);
    }

    public int expirePending() {
        return repository.expirePending();
    }

    private ContactRequest requirePendingResponse(UUID actor, UUID id, String note) {
        if (note != null && note.length() > 3000) throw bad("RESPONSE_NOTE_TOO_LONG");
        ContactRequest contact = requireParticipantContact(actor, id);
        if (contact.requestedByUserId().equals(actor)) {
            throw forbidden("REQUESTER_CANNOT_RESPOND");
        }
        if (!"PENDING".equals(contact.status())) throw conflict("INVALID_CONTACT_TRANSITION");
        return contact;
    }

    private ContactRequest requireParticipantContact(UUID actor, UUID id) {
        ContactRequest contact = repository.findForUpdate(id)
                .orElseThrow(() -> notFound("CONTACT_REQUEST_NOT_FOUND"));
        Listing sender = listingService.requireListing(contact.senderListingId());
        Listing passenger = listingService.requireListing(contact.passengerListingId());
        requireParticipant(actor, contact, sender, passenger);
        return contact;
    }

    private void requireParticipant(UUID actor, ContactRequest contact,
            Listing sender, Listing passenger) {
        if (!actor.equals(sender.ownerUserId()) && !actor.equals(passenger.ownerUserId())) {
            throw notFound("CONTACT_REQUEST_NOT_FOUND");
        }
    }

    private void requireEligiblePair(Listing own, Listing target) {
        if (!"PUBLISHED".equals(own.status()) || !"PUBLISHED".equals(target.status())
                || own.effectiveEndDate().isBefore(LocalDate.now())
                || target.effectiveEndDate().isBefore(LocalDate.now())
                || own.closesAt() != null && own.closesAt().isBefore(Instant.now())
                || target.closesAt() != null && target.closesAt().isBefore(Instant.now())) {
            throw conflict("LISTING_NOT_ELIGIBLE");
        }
        if (!own.originAirport().id().equals(target.originAirport().id())
                || !own.destinationAirport().id().equals(target.destinationAirport().id())
                || own.travelDateStart().isAfter(target.effectiveEndDate())
                || target.travelDateStart().isAfter(own.effectiveEndDate())) {
            throw bad("LISTINGS_DO_NOT_MATCH");
        }
    }

    private ContactView contactView(UUID actor, ContactRequest contact,
            Listing sender, Listing passenger) {
        Map<UUID, ListingView> views = listingService.views(actor, List.of(sender, passenger))
                .stream().collect(Collectors.toMap(v -> v.listing().id(), Function.identity()));
        ListingView senderView = views.get(sender.id());
        ListingView passengerView = views.get(passenger.id());
        return new ContactView(contact, senderView, passengerView,
                otherOwner(actor, senderView, passengerView),
                !contact.requestedByUserId().equals(actor));
    }

    private Owner otherOwner(UUID actor, ListingView sender, ListingView passenger) {
        return sender.listing().ownerUserId().equals(actor)
                ? passenger.owner() : sender.owner();
    }

    private UUID otherUser(UUID actor, ContactRequest contact) {
        Listing sender = listingService.requireListing(contact.senderListingId());
        return sender.ownerUserId().equals(actor)
                ? listingService.requireListing(contact.passengerListingId()).ownerUserId()
                : sender.ownerUserId();
    }

    private void notifyMatched(UUID listingId) {
        Listing listing = listingService.requireListing(listingId);
        notifications.notify(listing.ownerUserId(), "SPARE_BAG_LISTING_UPDATE",
                "Spare Bag listing matched", listing.title(), "SPARE_BAG_LISTING",
                listingId, "spare-bag-listing-matched:" + listingId);
    }

    private void validate(ContactInput in) {
        if (in == null || in.ownListingId() == null || in.targetListingId() == null
                || in.ownListingId().equals(in.targetListingId())
                || in.idempotencyKey() == null || in.idempotencyKey().isBlank()
                || in.idempotencyKey().length() > 120
                || in.message() != null && in.message().length() > 3000) {
            throw bad("INVALID_CONTACT_REQUEST");
        }
        boolean anyPrice = in.proposedPriceAmount() != null || in.proposedPriceUnit() != null
                || in.priceCurrency() != null;
        boolean completePrice = in.proposedPriceAmount() != null
                && in.proposedPriceUnit() != null && in.priceCurrency() != null;
        if (anyPrice && (!completePrice || in.proposedPriceAmount().signum() < 0
                || !PRICE_UNITS.contains(in.proposedPriceUnit())
                || !in.priceCurrency().matches("[A-Z]{3}")
                || "PER_KG".equals(in.proposedPriceUnit())
                && (in.parcelWeightKg() == null || in.parcelWeightKg().signum() <= 0))) {
            throw bad("INVALID_PROPOSED_PRICE");
        }
        if (in.parcelWeightKg() != null && in.parcelWeightKg().signum() <= 0) {
            throw bad("INVALID_PARCEL_WEIGHT");
        }
    }

    private String hash(ContactInput in) {
        try {
            String value = String.join("|", in.ownListingId().toString(),
                    in.targetListingId().toString(), String.valueOf(in.parcelWeightKg()),
                    String.valueOf(in.proposedPriceAmount()),
                    String.valueOf(in.proposedPriceUnit()), String.valueOf(in.priceCurrency()),
                    String.valueOf(in.message()));
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static int clamp(int size) {
        return size <= 0 ? DEFAULT_PAGE : Math.min(size, MAX_PAGE);
    }

    private static String encode(String value, UUID id) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (value + "|" + id).getBytes(StandardCharsets.UTF_8));
    }

    private static String[] decode(String cursor) {
        try {
            String decoded = new String(Base64.getUrlDecoder().decode(cursor),
                    StandardCharsets.UTF_8);
            String[] parts = decoded.split("\\|", -1);
            if (parts.length != 2) throw new IllegalArgumentException();
            return parts;
        } catch (IllegalArgumentException e) {
            throw bad("INVALID_CURSOR");
        }
    }

    private static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    private static ResponseStatusException forbidden(String code) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, code);
    }

    private static ResponseStatusException conflict(String code) {
        return new ResponseStatusException(HttpStatus.CONFLICT, code);
    }

    private static ResponseStatusException notFound(String code) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, code);
    }
}
