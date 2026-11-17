package com.diasporum.backend.sparebag.internal.application.v2;

import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.bad;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.conflict;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.forbidden;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.notFound;

import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.moderation.ModerationApi;
import com.diasporum.backend.notifications.NotificationsApi;
import com.diasporum.backend.social.SocialApi;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Owner;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Page;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.CountryRules;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.ModerationItem;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderItem;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderItemInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequest;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequestFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequestInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.SenderRequestView;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.MatchRequestRepository;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.SenderRequestRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Sender requests ("Items to Send" tab) with line items and photos. Lifecycle
 * DRAFT -&gt; PENDING_REVIEW (MANUAL) | PUBLISHED (AUTO_APPROVE) -&gt; PAUSED /
 * MATCHED (match accepted) / CLOSED / EXPIRED (closes_at) / REMOVED (admin).
 * Country rules: is_enabled gates posting, prohibited_categories rejects item
 * categories, requires_item_disclosure needs at least one item and a category
 * on every item before review/publication.
 */
@Service
public class SenderRequestService {

    static final int MAX_ITEMS = 20;
    static final int MAX_MEDIA = 10;
    private static final String MEDIA_PURPOSE = "SPARE_BAG_SENDER";
    private static final Set<String> IMAGE_TYPES = Set.of("image/jpeg", "image/png",
            "image/webp");
    private static final Set<String> EDITABLE = Set.of("DRAFT", "PENDING_REVIEW",
            "PUBLISHED", "PAUSED");
    private static final Set<String> CLOSABLE = Set.of("DRAFT", "PENDING_REVIEW",
            "PUBLISHED", "PAUSED", "MATCHED");

    private final SenderRequestRepository requests;
    private final MatchRequestRepository matches;
    private final SpareBagReferenceService reference;
    private final SpareBagVisibility visibility;
    private final SpareBagModeration moderation;
    private final SpareBagV2Properties properties;
    private final SpareBagOwners owners;
    private final MediaApi media;
    private final NotificationsApi notifications;
    private final SocialApi social;
    private final ModerationApi reports;

    public SenderRequestService(SenderRequestRepository requests,
            MatchRequestRepository matches, SpareBagReferenceService reference,
            SpareBagVisibility visibility, SpareBagModeration moderation,
            SpareBagV2Properties properties, SpareBagOwners owners, MediaApi media,
            NotificationsApi notifications, SocialApi social, ModerationApi reports) {
        this.requests = requests;
        this.matches = matches;
        this.reference = reference;
        this.visibility = visibility;
        this.moderation = moderation;
        this.properties = properties;
        this.owners = owners;
        this.media = media;
        this.notifications = notifications;
        this.social = social;
        this.reports = reports;
    }

    // =================== owner lifecycle ===================

    @Transactional
    public SenderRequestView create(UUID actor, SenderRequestInput in) {
        CountryRules rules = reference.requirePostableRoute(in.fromCountryId(),
                in.toCountryId());
        List<SenderItemInput> items = normalizeItems(in.items());
        SpareBagReferenceService.rejectProhibited(rules, categories(items));
        List<UUID> mediaIds = validMedia(actor, in.mediaIds());
        UUID id = UUID.randomUUID();
        try {
            requests.insert(id, actor, in.fromCountryId(),
                    SpareBagV2Support.trimToNull(in.fromCity()), in.toCountryId(),
                    SpareBagV2Support.trimToNull(in.toCity()),
                    SpareBagV2Support.trimToNull(in.description()), in.closesAt());
        } catch (DataIntegrityViolationException e) {
            throw SpareBagV2Support.translate(e, "SENDER_REQUEST_INVALID");
        }
        writeChildren(id, items, mediaIds);
        return view(actor, requireRequest(id));
    }

    @Transactional
    public SenderRequestView update(UUID actor, UUID id, SenderRequestInput in) {
        SenderRequest current = requireOwnedForUpdate(actor, id);
        if (!EDITABLE.contains(current.status())) {
            throw conflict("SENDER_REQUEST_NOT_EDITABLE");
        }
        CountryRules rules = reference.requirePostableRoute(in.fromCountryId(),
                in.toCountryId());
        List<SenderItemInput> items = normalizeItems(in.items());
        SpareBagReferenceService.rejectProhibited(rules, categories(items));
        List<UUID> mediaIds = validMedia(actor, in.mediaIds());
        try {
            requests.update(id, in.fromCountryId(),
                    SpareBagV2Support.trimToNull(in.fromCity()), in.toCountryId(),
                    SpareBagV2Support.trimToNull(in.toCity()),
                    SpareBagV2Support.trimToNull(in.description()),
                    // an omitted closesAt keeps the current one (set at first publish)
                    in.closesAt() == null ? current.closesAt() : in.closesAt());
        } catch (DataIntegrityViolationException e) {
            throw SpareBagV2Support.translate(e, "SENDER_REQUEST_INVALID");
        }
        writeChildren(id, items, mediaIds);
        if (!"DRAFT".equals(current.status())) {
            requirePublishable(requireRequest(id), true);
        }
        if (!properties.autoApprove()
                && Set.of("PUBLISHED", "PAUSED").contains(current.status())) {
            // a substantive edit of a reviewed request goes back through review
            requests.transition(id, Set.of(current.status()), "PENDING_REVIEW");
            moderation.submit(SpareBagModeration.SENDER_REQUEST, id);
            matches.expirePendingForRequest(id);
        }
        return view(actor, requireRequest(id));
    }

    @Transactional
    public SenderRequestView publish(UUID actor, UUID id) {
        SenderRequest r = requireOwnedForUpdate(actor, id);
        switch (r.status()) {
            case "DRAFT" -> {
                requirePublishable(r, false);
                if (r.closesAt() == null) {
                    requests.setClosesAt(id, Instant.now().plus(properties.requestDefaultTtl()));
                }
                String target = properties.autoApprove() ? "PUBLISHED" : "PENDING_REVIEW";
                transition(id, Set.of("DRAFT"), target);
                if ("PENDING_REVIEW".equals(target)) {
                    moderation.submit(SpareBagModeration.SENDER_REQUEST, id);
                }
            }
            case "PAUSED" -> {
                // already reviewed: resuming does not re-enter review
                requirePublishable(r, true);
                transition(id, Set.of("PAUSED"), "PUBLISHED");
            }
            default -> throw conflict("SENDER_REQUEST_NOT_PUBLISHABLE");
        }
        return view(actor, requireRequest(id));
    }

    @Transactional
    public SenderRequestView pause(UUID actor, UUID id) {
        requireOwnedForUpdate(actor, id);
        transition(id, Set.of("PUBLISHED"), "PAUSED");
        return view(actor, requireRequest(id));
    }

    @Transactional
    public SenderRequestView close(UUID actor, UUID id) {
        requireOwnedForUpdate(actor, id);
        transition(id, CLOSABLE, "CLOSED");
        matches.expirePendingForRequest(id);
        return view(actor, requireRequest(id));
    }

    /** MATCHED -&gt; PUBLISHED once the accepted match was closed (deal fell through). */
    @Transactional
    public SenderRequestView reopen(UUID actor, UUID id) {
        SenderRequest r = requireOwnedForUpdate(actor, id);
        if (!"MATCHED".equals(r.status())) {
            throw conflict("INVALID_SENDER_REQUEST_TRANSITION");
        }
        if (matches.hasAccepted(id)) {
            throw conflict("MATCH_STILL_ACCEPTED");
        }
        requirePublishable(r, true);
        transition(id, Set.of("MATCHED"), "PUBLISHED");
        return view(actor, requireRequest(id));
    }

    @Transactional
    public void delete(UUID actor, UUID id) {
        requireOwnedForUpdate(actor, id);
        if (requests.softDeleteDraft(id) == 0) {
            throw conflict("SENDER_REQUEST_NOT_DELETABLE");
        }
    }

    // =================== reads ===================

    @Transactional(readOnly = true)
    public SenderRequestView detail(UUID actor, UUID id) {
        SenderRequest r = requireRequest(id);
        if (!canView(actor, r)) {
            throw notFound("SENDER_REQUEST_NOT_FOUND");
        }
        return view(actor, r);
    }

    @Transactional(readOnly = true)
    public Page<SenderRequestView> search(UUID actor, SenderRequestFilters filters,
            String cursor, Integer size) {
        int limit = SpareBagV2Support.pageSize(size);
        SenderRequestFilters f = new SenderRequestFilters(filters.fromCountryId(),
                filters.toCountryId(), filters.category() == null || filters.category().isBlank()
                        ? null : reference.validCategories(List.of(filters.category())).get(0));
        Set<UUID> countries = visibility.visibleCountries(actor);
        if (countries.isEmpty()) {
            return new Page<>(List.of(), null);
        }
        var c = SpareBagV2Support.decode(cursor);
        List<SenderRequest> rows = requests.search(countries, f,
                SpareBagV2Support.cursorInstant(c), c == null ? null : c.id(), limit + 1);
        String next = null;
        if (rows.size() > limit) {
            rows = rows.subList(0, limit);
            SenderRequest last = rows.get(limit - 1);
            next = SpareBagV2Support.cursor(last.publishedAt(), last.id());
        }
        Set<UUID> blocked = social.blockedWith(actor,
                rows.stream().map(SenderRequest::ownerUserId).collect(Collectors.toSet()));
        return new Page<>(views(actor, rows.stream()
                .filter(r -> !blocked.contains(r.ownerUserId())).toList()), next);
    }

    @Transactional(readOnly = true)
    public Page<SenderRequestView> mine(UUID actor, String status, String cursor,
            Integer size) {
        int limit = SpareBagV2Support.pageSize(size);
        var c = SpareBagV2Support.decode(cursor);
        List<SenderRequest> rows = requests.mine(actor, SpareBagV2Support.upper(status),
                SpareBagV2Support.cursorInstant(c), c == null ? null : c.id(), limit + 1);
        String next = null;
        if (rows.size() > limit) {
            rows = rows.subList(0, limit);
            SenderRequest last = rows.get(limit - 1);
            next = SpareBagV2Support.cursor(last.createdAt(), last.id());
        }
        return new Page<>(views(actor, rows), next);
    }

    @Transactional(readOnly = true)
    public String mediaDownloadUrl(UUID actor, UUID id, UUID mediaId) {
        SenderRequest r = requireRequest(id);
        if (!canView(actor, r)) {
            throw notFound("SENDER_REQUEST_NOT_FOUND");
        }
        if (!requests.media(List.of(id)).getOrDefault(id, List.of()).contains(mediaId)) {
            throw notFound("MEDIA_NOT_FOUND");
        }
        return media.authorizedDownloadUrl(mediaId);
    }

    @Transactional
    public UUID report(UUID actor, UUID id, String reason, String details) {
        SenderRequest r = requireRequest(id);
        if (r.ownerUserId().equals(actor)) {
            throw bad("CANNOT_REPORT_OWN_POSTING");
        }
        if (!canView(actor, r)) {
            throw notFound("SENDER_REQUEST_NOT_FOUND");
        }
        return reports.report(actor, SpareBagModeration.SENDER_REQUEST, id,
                r.fromCountryId(), null, reason, details);
    }

    // =================== admin moderation ===================

    @Transactional(readOnly = true)
    public List<ModerationItem> pendingReview(UUID actor, String cursor, Integer size) {
        Set<UUID> scope = moderation.moderatorScope(actor);
        var c = SpareBagV2Support.decode(cursor);
        return requests.pendingReview(scope, SpareBagV2Support.cursorInstant(c),
                c == null ? null : c.id(), SpareBagV2Support.pageSize(size));
    }

    @Transactional
    public SenderRequestView moderate(UUID actor, UUID id, String action, String reason) {
        String a = SpareBagV2Support.upper(action);
        String why = SpareBagV2Support.trimToNull(reason);
        SenderRequest r = requireForUpdate(id);
        moderation.requireModerator(actor, r.fromCountryId(), r.toCountryId());
        switch (a == null ? "" : a) {
            case "APPROVE" -> {
                requirePublishable(r, true);
                moderated(id, Set.of("PENDING_REVIEW"), "PUBLISHED");
                moderation.decide(actor, SpareBagModeration.SENDER_REQUEST, id,
                        r.ownerUserId(), r.fromCountryId(), "APPROVE", "APPROVE",
                        "APPROVE_CONTENT", why == null ? "Approved" : why);
                notifyOwner(r, "Request approved", "Your Spare Bag request is now live.");
            }
            case "REJECT" -> {
                requireReason(why);
                moderated(id, Set.of("PENDING_REVIEW"), "DRAFT");
                moderation.decide(actor, SpareBagModeration.SENDER_REQUEST, id,
                        r.ownerUserId(), r.fromCountryId(), "REJECT", "REJECT",
                        "REJECT_LISTING", why);
                notifyOwner(r, "Request needs changes", why);
            }
            case "REMOVE" -> {
                requireReason(why);
                moderated(id, Set.of("DRAFT", "PENDING_REVIEW", "PUBLISHED", "PAUSED",
                        "MATCHED", "CLOSED", "EXPIRED"), "REMOVED");
                matches.expirePendingForRequest(id);
                moderation.decide(actor, SpareBagModeration.SENDER_REQUEST, id,
                        r.ownerUserId(), r.fromCountryId(), "REMOVE", "REJECT",
                        "REMOVE_CONTENT", why);
                notifyOwner(r, "Request removed", why);
            }
            default -> throw bad("INVALID_MODERATION_ACTION");
        }
        return view(actor, requireRequest(id));
    }

    // =================== shared ===================

    public SenderRequest requireRequest(UUID id) {
        return requests.find(id).orElseThrow(() -> notFound("SENDER_REQUEST_NOT_FOUND"));
    }

    public SenderRequest requireForUpdate(UUID id) {
        return requests.findForUpdate(id)
                .orElseThrow(() -> notFound("SENDER_REQUEST_NOT_FOUND"));
    }

    public List<SenderItem> items(UUID id) {
        return requests.items(List.of(id)).getOrDefault(id, List.of());
    }

    public static boolean listable(SenderRequest r) {
        return "PUBLISHED".equals(r.status())
                && (r.closesAt() == null || r.closesAt().isAfter(Instant.now()));
    }

    /**
     * Owner, a moderator for the route, the traveller side of a match on this
     * request (so a MATCHED request stays readable), or anyone the section 6.6
     * rule admits while it is listed.
     */
    public boolean canView(UUID actor, SenderRequest r) {
        if (r.ownerUserId().equals(actor)) {
            return true;
        }
        if (moderation.isModerator(actor, r.fromCountryId(), r.toCountryId())) {
            return true;
        }
        if (!social.canInteract(actor, r.ownerUserId())) {
            return false;
        }
        if (matches.travellerParticipatesInRequest(r.id(), actor)) {
            return true;
        }
        return listable(r) && visibility.canSee(actor, r.fromCountryId(), r.toCountryId());
    }

    public List<SenderRequestView> views(UUID actor, Collection<SenderRequest> rows) {
        List<UUID> ids = rows.stream().map(SenderRequest::id).toList();
        Map<UUID, List<SenderItem>> itemMap = requests.items(ids);
        Map<UUID, List<UUID>> mediaMap = requests.media(ids);
        Map<UUID, Owner> ownerMap = owners.owners(
                rows.stream().map(SenderRequest::ownerUserId).collect(Collectors.toSet()));
        List<SenderRequestView> out = new ArrayList<>();
        for (SenderRequest r : rows) {
            out.add(new SenderRequestView(r, itemMap.getOrDefault(r.id(), List.of()),
                    mediaMap.getOrDefault(r.id(), List.of()), ownerMap.get(r.ownerUserId()),
                    r.ownerUserId().equals(actor)));
        }
        return out;
    }

    public SenderRequestView view(UUID actor, SenderRequest r) {
        return views(actor, List.of(r)).get(0);
    }

    /**
     * Route enabled, no prohibited item category, item disclosure (at least one
     * item and a category on each) when either country requires it, and a
     * future closes_at ({@code requireClosesAt=false} for a DRAFT publish,
     * which applies the default TTL when unset).
     */
    private void requirePublishable(SenderRequest r, boolean requireClosesAt) {
        CountryRules rules = reference.requirePostableRoute(r.fromCountryId(),
                r.toCountryId());
        List<SenderItem> items = items(r.id());
        SpareBagReferenceService.rejectProhibited(rules,
                items.stream().map(SenderItem::categoryKey).toList());
        if (rules.requiresItemDisclosure() && (items.isEmpty()
                || items.stream().anyMatch(i -> i.categoryKey() == null))) {
            throw bad("ITEM_DISCLOSURE_REQUIRED");
        }
        if (r.closesAt() == null ? requireClosesAt : !r.closesAt().isAfter(Instant.now())) {
            throw bad("CLOSES_AT_PAST");
        }
    }

    private void writeChildren(UUID id, List<SenderItemInput> items, List<UUID> mediaIds) {
        try {
            requests.replaceItems(id, items);
        } catch (DataIntegrityViolationException e) {
            throw SpareBagV2Support.translate(e, "SENDER_ITEM_INVALID");
        }
        requests.replaceMedia(id, mediaIds);
    }

    private List<SenderItemInput> normalizeItems(List<SenderItemInput> items) {
        if (items == null) {
            return List.of();
        }
        if (items.size() > MAX_ITEMS) {
            throw bad("TOO_MANY_ITEMS");
        }
        Set<String> units = reference.unitCodes();
        List<SenderItemInput> out = new ArrayList<>();
        for (SenderItemInput i : items) {
            if (i == null) {
                throw bad("SENDER_ITEM_INVALID");
            }
            String unit = SpareBagV2Support.upper(i.unitCode());
            String perUnit = SpareBagV2Support.upper(i.perUnitUnit());
            if (unit == null || !units.contains(unit)
                    || (perUnit != null && !units.contains(perUnit))) {
                throw bad("INVALID_MEASUREMENT_UNIT");
            }
            String category = i.categoryKey() == null || i.categoryKey().isBlank() ? null
                    : reference.validCategories(List.of(i.categoryKey())).get(0);
            out.add(new SenderItemInput(SpareBagV2Support.trimToNull(i.itemName()),
                    SpareBagV2Support.trimToNull(i.itemDescription()), category, i.quantity(),
                    unit, i.perUnitAmount(), perUnit, i.declaredValueAmount(),
                    SpareBagV2Support.upper(i.declaredValueCurrency())));
        }
        return out;
    }

    private static List<String> categories(List<SenderItemInput> items) {
        return items.stream().map(SenderItemInput::categoryKey).filter(Objects::nonNull)
                .toList();
    }

    /** Owned, READY, image, purpose SPARE_BAG_SENDER; order preserved, de-duplicated. */
    private List<UUID> validMedia(UUID actor, List<UUID> mediaIds) {
        if (mediaIds == null || mediaIds.isEmpty()) {
            return List.of();
        }
        List<UUID> unique = new ArrayList<>(new LinkedHashSet<>(mediaIds));
        if (unique.size() > MAX_MEDIA || unique.contains(null)) {
            throw bad("TOO_MANY_MEDIA");
        }
        var assets = media.assets(unique);
        if (assets.size() != unique.size()) {
            throw bad("MEDIA_NOT_READY");
        }
        for (var asset : assets) {
            if (!"READY".equals(asset.status())) {
                throw bad("MEDIA_NOT_READY");
            }
            if (!actor.equals(asset.ownerId()) || !MEDIA_PURPOSE.equals(asset.purpose())
                    || asset.mimeType() == null || !IMAGE_TYPES.contains(asset.mimeType())) {
                throw bad("MEDIA_NOT_ATTACHABLE");
            }
        }
        return unique;
    }

    private SenderRequest requireOwnedForUpdate(UUID actor, UUID id) {
        SenderRequest r = requireForUpdate(id);
        if (!r.ownerUserId().equals(actor)) {
            if (canView(actor, r)) {
                throw forbidden("NOT_SENDER_REQUEST_OWNER");
            }
            throw notFound("SENDER_REQUEST_NOT_FOUND");
        }
        return r;
    }

    private void transition(UUID id, Set<String> from, String to) {
        if (requests.transition(id, from, to) == 0) {
            throw conflict("INVALID_SENDER_REQUEST_TRANSITION");
        }
    }

    private void moderated(UUID id, Set<String> from, String to) {
        if (requests.transition(id, from, to) == 0) {
            throw conflict("MODERATION_STATE_INVALID");
        }
    }

    private static void requireReason(String reason) {
        if (reason == null) {
            throw bad("REASON_REQUIRED");
        }
    }

    private void notifyOwner(SenderRequest r, String title, String body) {
        notifications.notify(r.ownerUserId(), "SPARE_BAG_LISTING_UPDATE", title, body,
                SpareBagModeration.SENDER_REQUEST, r.id(),
                "spare-bag-v2-moderation:" + r.id() + ":" + UUID.randomUUID());
    }
}
