package com.diasporum.backend.events.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.businessaccounts.BusinessAccountsApi.AccountMembershipView;
import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.social.SocialApi;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import com.diasporum.backend.taxonomy.TaxonomyApi.CommunityView;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Event lifecycle, discovery, RSVP/capacity/waitlist, saves, participants and
 * reports over the v10.12 {@code events} tables. Community membership and
 * catalogue data come from {@link CommunityApi}/{@link TaxonomyApi}; business
 * ownership from {@link BusinessAccountsApi}; cover assets from {@link MediaApi};
 * block filtering from {@link SocialApi}.
 *
 * <p>Capacity and waitlist invariants are serialized per event with
 * {@code SELECT ... FOR UPDATE} on the event row inside the RSVP transaction,
 * so concurrent RSVP requests cannot oversell capacity; the
 * {@code event_rsvps} primary key prevents duplicate participation records.
 */
@Service
public class EventService {

    private static final Set<String> VISIBILITIES = Set.of("COMMUNITY", "COUNTRY");
    private static final Set<String> MODES = Set.of("IN_PERSON", "ONLINE_EXTERNAL");
    private static final Set<String> RSVP_INPUTS = Set.of("GOING", "INTERESTED",
            "NOT_GOING");
    private static final Set<String> REPORT_REASONS = Set.of("SPAM", "SCAM",
            "HARASSMENT", "HATE", "SEXUAL_MISCONDUCT", "MISINFORMATION",
            "IMPERSONATION", "PRIVACY", "OTHER");
    private static final int DEFAULT_PAGE = 20;
    private static final int MAX_PAGE = 50;

    private final JdbcTemplate jdbc;
    private final IdentityApi identity;
    private final CommunityApi community;
    private final TaxonomyApi taxonomy;
    private final MediaApi media;
    private final SocialApi social;
    private final BusinessAccountsApi businessAccounts;

    public EventService(JdbcTemplate jdbc, IdentityApi identity,
            CommunityApi community, TaxonomyApi taxonomy, MediaApi media,
            SocialApi social, BusinessAccountsApi businessAccounts) {
        this.jdbc = jdbc;
        this.identity = identity;
        this.community = community;
        this.taxonomy = taxonomy;
        this.media = media;
        this.social = social;
        this.businessAccounts = businessAccounts;
    }

    // =================== row types ===================

    public record EventRow(UUID id, UUID countryId, UUID communityId,
            String visibilityScope, UUID organizerId, UUID ownerUserId,
            UUID businessAccountId, UUID createdByUserId, UUID categoryId,
            UUID countryTopicCategoryId, String title, String description,
            String eventMode, Instant startsAt, Instant endsAt, String timezone,
            String locationName, String externalUrl, Integer capacity,
            String status, Instant publishedAt, Instant cancelledAt,
            String cancelReason, Instant createdAt, Instant updatedAt,
            UUID coverMediaId, UUID voiceRoomId) {
    }

    public record CategoryRow(UUID id, UUID countryId, String categoryKey,
            String displayName, int sortOrder) {
    }

    public record ParticipantCounts(int going, int interested, int waitlisted) {
    }

    /** List/detail item with viewer-dependent engagement flags. */
    public record EventItem(EventRow event, CategoryRow category,
            ParticipantCounts counts, String myRsvp, boolean saved,
            boolean canManage) {
    }

    public record EventPage(List<EventItem> items, String nextCursor) {
    }

    public record RsvpResult(String status, ParticipantCounts counts,
            Integer capacity, UUID promotedUserId) {
    }

    public record ParticipantItem(ProfileSummary profile, String rsvpStatus) {
    }

    public record ParticipantPage(List<ParticipantItem> items,
            ParticipantCounts counts, int page, int size) {
    }

    private static final String COLS = "e.id,e.country_id,e.community_id,"
            + "e.visibility_scope::text,e.organizer_id,e.owner_user_id,"
            + "e.business_account_id,e.created_by_user_id,e.event_category_id,"
            + "e.country_topic_category_id,e.title,e.description,"
            + "e.event_mode::text,e.starts_at,e.ends_at,e.timezone,"
            + "e.location_name,e.external_url,e.capacity,e.status::text,"
            + "e.published_at,e.cancelled_at,e.cancel_reason,e.created_at,"
            + "e.updated_at,(SELECT em.media_id FROM event_media em"
            + " WHERE em.event_id=e.id AND em.is_cover LIMIT 1) AS cover_media_id,"
            + "e.voice_room_id";

    private static EventRow event(java.sql.ResultSet rs, int i)
            throws java.sql.SQLException {
        return new EventRow(rs.getObject("id", UUID.class),
                rs.getObject("country_id", UUID.class),
                rs.getObject("community_id", UUID.class),
                rs.getString("visibility_scope"),
                rs.getObject("organizer_id", UUID.class),
                rs.getObject("owner_user_id", UUID.class),
                rs.getObject("business_account_id", UUID.class),
                rs.getObject("created_by_user_id", UUID.class),
                rs.getObject("event_category_id", UUID.class),
                rs.getObject("country_topic_category_id", UUID.class),
                rs.getString("title"), rs.getString("description"),
                rs.getString("event_mode"), ts(rs, "starts_at"), ts(rs, "ends_at"),
                rs.getString("timezone"), rs.getString("location_name"),
                rs.getString("external_url"),
                (Integer) rs.getObject("capacity"), rs.getString("status"),
                ts(rs, "published_at"), ts(rs, "cancelled_at"),
                rs.getString("cancel_reason"), ts(rs, "created_at"),
                ts(rs, "updated_at"),
                rs.getObject("cover_media_id", UUID.class),
                rs.getObject("voice_room_id", UUID.class));
    }

    private static Instant ts(java.sql.ResultSet rs, String col)
            throws java.sql.SQLException {
        var t = rs.getTimestamp(col);
        return t == null ? null : t.toInstant();
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

    private static int clamp(int size) {
        return size <= 0 ? DEFAULT_PAGE : Math.min(size, MAX_PAGE);
    }

    // =================== categories ===================

    /** Active event categories: global plus country-specific, display order. */
    public List<CategoryRow> categories(UUID countryId) {
        return jdbc.query("SELECT id,country_id,category_key,display_name,"
                        + "sort_order FROM event_categories WHERE is_active"
                        + " AND (country_id IS NULL OR country_id=?)"
                        + " ORDER BY sort_order,display_name",
                (rs, i) -> new CategoryRow(rs.getObject("id", UUID.class),
                        rs.getObject("country_id", UUID.class),
                        rs.getString("category_key"), rs.getString("display_name"),
                        rs.getInt("sort_order")), countryId);
    }

    private CategoryRow requireCategory(UUID categoryId, UUID countryId) {
        return jdbc.query("SELECT id,country_id,category_key,display_name,"
                        + "sort_order FROM event_categories WHERE id=? AND is_active",
                        (rs, i) -> new CategoryRow(rs.getObject("id", UUID.class),
                                rs.getObject("country_id", UUID.class),
                                rs.getString("category_key"),
                                rs.getString("display_name"),
                                rs.getInt("sort_order")), categoryId)
                .stream().findFirst()
                .filter(c -> c.countryId() == null || c.countryId().equals(countryId))
                .orElseThrow(() -> bad("INVALID_CATEGORY"));
    }

    // =================== authorization ===================

    /** True if the actor owns the event personally or through a business
     * workspace with an event-management role. */
    public boolean canManage(UUID actor, EventRow e) {
        if (actor.equals(e.ownerUserId()) || actor.equals(e.organizerId())
                && e.ownerUserId() == null && e.businessAccountId() == null) {
            return true;
        }
        if (e.businessAccountId() != null) {
            var m = businessAccounts.membership(actor, e.businessAccountId());
            return EventAuthorization.canManageEvents(m.map(AccountMembershipView::role)
                    .orElse(null));
        }
        return false;
    }

    /** Visibility rule: community events need active membership; country-scope
     * events are visible to users whose current country matches; managers
     * always see their own events, including drafts. */
    public boolean canView(UUID viewer, EventRow e) {
        if ("DELETED".equals(e.status())) {
            return false;
        }
        if (canManage(viewer, e)) {
            return true;
        }
        if (!"PUBLISHED".equals(e.status())) {
            return false;
        }
        if (e.communityId() != null
                && community.canAccess(viewer, e.communityId())) {
            return true;
        }
        if ("COUNTRY".equals(e.visibilityScope())) {
            var p = identity.profileSummary(viewer).orElse(null);
            return p != null && e.countryId().equals(p.currentCountryId());
        }
        return false;
    }

    private EventRow requireEvent(UUID id) {
        return jdbc.query("SELECT " + COLS + " FROM events e WHERE e.id=?",
                        EventService::event, id).stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "EVENT_NOT_FOUND"));
    }

    private EventRow requireViewable(UUID viewer, UUID id) {
        var e = requireEvent(id);
        if (!canView(viewer, e)) {
            // Do not reveal community-scoped events to non-members.
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "EVENT_NOT_FOUND");
        }
        return e;
    }

    private EventRow requireManaged(UUID actor, UUID id) {
        var e = requireEvent(id);
        if (!canManage(actor, e)) {
            throw forbidden("NOT_EVENT_ORGANIZER");
        }
        return e;
    }

    /** Managed read with the event row locked FOR UPDATE — for update paths
     * that must serialize with concurrent RSVP transactions. */
    private EventRow requireManagedLocked(UUID actor, UUID id) {
        var e = lockEvent(id);
        if (!canManage(actor, e)) {
            throw forbidden("NOT_EVENT_ORGANIZER");
        }
        return e;
    }

    // =================== creation ===================

    @Transactional
    public EventItem create(UUID actor, UUID communityId, String visibilityScope,
            UUID categoryId, UUID countryTopicCategoryId, String title,
            String description, String eventMode, Instant startsAt, Instant endsAt,
            String timezone, String locationName, String externalUrl,
            Integer capacity, UUID coverMediaId, UUID businessAccountId,
            boolean draft) {
        if (!community.isActiveMember(actor, communityId)) {
            throw forbidden("NOT_A_MEMBER");
        }
        CommunityView c = taxonomy.findCommunityById(communityId).orElseThrow(
                () -> bad("COMMUNITY_NOT_FOUND"));
        if (!c.active()) {
            throw bad("COMMUNITY_INACTIVE");
        }
        if (visibilityScope == null) {
            visibilityScope = "COMMUNITY";
        }
        if (!VISIBILITIES.contains(visibilityScope)) {
            throw bad("INVALID_VISIBILITY");
        }
        if (eventMode == null || !MODES.contains(eventMode)) {
            // ONLINE_VOICE references a Diasporum voice room (events.voice_room_id,
            // see V5) and requires the Voice Rooms milestone — still rejected.
            if ("ONLINE_VOICE".equals(eventMode)) {
                throw bad("ONLINE_VOICE_NOT_SUPPORTED");
            }
            throw bad("INVALID_EVENT_MODE");
        }
        validateContent(title, description, eventMode, locationName, externalUrl,
                startsAt, endsAt, timezone, capacity, true);
        var category = requireCategory(categoryId, c.destinationCountryId());
        if (countryTopicCategoryId != null
                && !taxonomy.isCategoryActiveInCountry(countryTopicCategoryId,
                        c.destinationCountryId(), "EVENT")) {
            throw bad("INVALID_COUNTRY_TOPIC");
        }
        AccountMembershipView business = null;
        if (businessAccountId != null) {
            business = EventAuthorization.asEventManager(
                    businessAccounts.membership(actor, businessAccountId).orElse(null));
            if (business == null) {
                throw forbidden("BUSINESS_ROLE_REQUIRED");
            }
        }
        UUID cover = validateCover(coverMediaId, actor);

        UUID id = UUID.randomUUID();
        String status = draft ? "DRAFT" : "PUBLISHED";
        jdbc.update("INSERT INTO events(id,country_id,community_id,"
                        + "visibility_scope,organizer_id,event_category_id,"
                        + "country_topic_category_id,title,description,event_mode,"
                        + "starts_at,ends_at,timezone,location_name,external_url,"
                        + "capacity,status,published_at,owner_user_id,"
                        + "business_account_id,created_by_user_id)"
                        + " VALUES(?,?,?,?::visibility_scope,?,?,?,?,?,?::event_mode,"
                        + "?,?,?,?,?,?,?::content_status,?,?,?,?)",
                id, c.destinationCountryId(), communityId, visibilityScope, actor,
                categoryId, countryTopicCategoryId, title, description, eventMode,
                Timestamp.from(startsAt), endsAt == null ? null : Timestamp.from(endsAt),
                timezone, locationName, externalUrl, capacity, status,
                draft ? null : Timestamp.from(Instant.now()),
                business == null ? actor : null,
                business == null ? null : business.accountId(), actor);
        if (cover != null) {
            jdbc.update("INSERT INTO event_media(event_id,media_id,sort_order,"
                    + "is_cover) VALUES(?,?,0,true)", id, cover);
        }
        return detail(actor, id);
    }

    private void validateContent(String title, String description, String eventMode,
            String locationName, String externalUrl, Instant startsAt,
            Instant endsAt, String timezone, Integer capacity,
            boolean requireFutureStart) {
        if (title == null || title.trim().isEmpty() || title.trim().length() > 200) {
            throw bad("TITLE_INVALID");
        }
        if (description == null || description.trim().isEmpty()
                || description.trim().length() > 12000) {
            throw bad("DESCRIPTION_INVALID");
        }
        if (startsAt == null) {
            throw bad("STARTS_AT_REQUIRED");
        }
        if (requireFutureStart && startsAt.isBefore(Instant.now())) {
            throw bad("STARTS_AT_IN_PAST");
        }
        if (endsAt != null && endsAt.isBefore(startsAt)) {
            throw bad("ENDS_BEFORE_START");
        }
        if (timezone == null) {
            throw bad("TIMEZONE_REQUIRED");
        }
        try {
            ZoneId.of(timezone);
        } catch (Exception e) {
            throw bad("INVALID_TIMEZONE");
        }
        if (capacity != null && capacity <= 0) {
            throw bad("CAPACITY_INVALID");
        }
        if ("IN_PERSON".equals(eventMode)
                && (locationName == null || locationName.trim().isEmpty())) {
            throw bad("LOCATION_REQUIRED");
        }
        if ("ONLINE_EXTERNAL".equals(eventMode)
                && (externalUrl == null
                        || !externalUrl.matches("(?i)^https?://.+"))) {
            throw bad("EXTERNAL_URL_REQUIRED");
        }
    }

    private UUID validateCover(UUID coverMediaId, UUID owner) {
        if (coverMediaId == null) {
            return null;
        }
        var asset = media.asset(coverMediaId).orElseThrow(
                () -> bad("MEDIA_NOT_FOUND"));
        if (!owner.equals(asset.ownerId())) {
            throw forbidden("MEDIA_NOT_OWNED");
        }
        if (!"READY".equals(asset.status())) {
            throw bad("MEDIA_NOT_READY");
        }
        if (!"EVENT".equals(asset.purpose())) {
            throw bad("MEDIA_WRONG_PURPOSE");
        }
        return coverMediaId;
    }

    // =================== lifecycle ===================

    /**
     * Partial update. Visibility may be switched between COMMUNITY and
     * COUNTRY (see {@link #validateVisibilityChange}). When the organizer
     * raises capacity, waitlisted participants are promoted in FIFO order in
     * this same transaction — the event row is locked FOR UPDATE so the
     * promotion serializes with concurrent RSVP transactions and capacity is
     * never oversold.
     */
    @Transactional
    public EventItem update(UUID actor, UUID eventId, String visibilityScope,
            String title, String description, String eventMode, Instant startsAt,
            Instant endsAt, String timezone, String locationName,
            String externalUrl, Integer capacity, UUID categoryId,
            UUID countryTopicCategoryId, UUID coverMediaId, boolean clearCover) {
        var e = requireManagedLocked(actor, eventId);
        if (e.cancelledAt() != null) {
            throw conflict("EVENT_CANCELLED");
        }
        if ("DELETED".equals(e.status())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "EVENT_NOT_FOUND");
        }
        validateVisibilityChange(actor, e, visibilityScope);
        Instant now = Instant.now();
        boolean started = e.startsAt() != null && e.startsAt().isBefore(now);
        boolean reschedules = startsAt != null || endsAt != null;
        // Raising capacity only adds spots — never a reason to block an
        // already-started event (waitlisted participants get promoted).
        boolean raisesCapacity = capacity != null
                && (e.capacity() == null || capacity > e.capacity());
        if (started && (reschedules || eventMode != null
                || locationName != null || visibilityScope != null
                || (capacity != null && !raisesCapacity))) {
            throw conflict("EVENT_ALREADY_STARTED");
        }
        String newTitle = title != null ? title : e.title();
        String newDescription = description != null ? description : e.description();
        String newMode = eventMode != null ? eventMode : e.eventMode();
        Instant newStarts = startsAt != null ? startsAt : e.startsAt();
        Instant newEnds = endsAt != null ? endsAt : e.endsAt();
        String newTz = timezone != null ? timezone : e.timezone();
        String newLocation = locationName != null ? locationName : e.locationName();
        String newUrl = externalUrl != null ? externalUrl : e.externalUrl();
        Integer newCapacity = capacity != null ? capacity : e.capacity();
        // Clearing an optional field: explicit empty string clears location/URL.
        if (locationName != null && locationName.isBlank()) {
            newLocation = null;
        }
        if (externalUrl != null && externalUrl.isBlank()) {
            newUrl = null;
        }
        if (!MODES.contains(newMode)) {
            if ("ONLINE_VOICE".equals(newMode)) {
                throw bad("ONLINE_VOICE_NOT_SUPPORTED");
            }
            throw bad("INVALID_EVENT_MODE");
        }
        // A moved event must still start in the future; an already-started
        // event keeps its original times when only text fields change.
        validateContent(newTitle, newDescription, newMode, newLocation, newUrl,
                newStarts, newEnds, newTz, newCapacity, reschedules);
        if (newCapacity != null) {
            int going = rsvpCount(e.id(), "GOING");
            if (newCapacity < going) {
                throw conflict("CAPACITY_BELOW_PARTICIPANTS");
            }
        }
        UUID newCategory = categoryId != null ? categoryId : e.categoryId();
        requireCategory(newCategory, e.countryId());
        UUID newTopic = countryTopicCategoryId != null ? countryTopicCategoryId
                : e.countryTopicCategoryId();
        if (newTopic != null
                && !taxonomy.isCategoryActiveInCountry(newTopic, e.countryId(),
                        "EVENT")) {
            throw bad("INVALID_COUNTRY_TOPIC");
        }
        jdbc.update("UPDATE events SET title=?,description=?,event_mode=?::event_mode,"
                        + "starts_at=?,ends_at=?,timezone=?,location_name=?,"
                        + "external_url=?,capacity=?,event_category_id=?,"
                        + "country_topic_category_id=?,"
                        + (visibilityScope == null ? ""
                                : "visibility_scope=?::visibility_scope,")
                        + "updated_at=now() WHERE id=?",
                buildUpdateArgs(eventId, newTitle, newDescription, newMode,
                        newStarts, newEnds, newTz, newLocation, newUrl,
                        newCapacity, newCategory, newTopic, visibilityScope));
        // Capacity increase frees waitlisted spots — promote in FIFO order
        // while seats remain. The row lock held for this transaction keeps
        // concurrent RSVP writers out until the promotion is done.
        if (newCapacity != null && raisesCapacity) {
            promoteWaitlistToCapacity(eventId, newCapacity);
        }
        if (coverMediaId != null || clearCover) {
            replaceCover(eventId, clearCover ? null : coverMediaId, actor);
        }
        return detail(actor, eventId);
    }

    /** Argument list for the whitelist UPDATE above (visibility optional).
     * Built with explicit adds — several columns are legitimately null, which
     * List.of would reject. */
    private Object[] buildUpdateArgs(UUID eventId, String title,
            String description, String mode, Instant startsAt, Instant endsAt,
            String timezone, String locationName, String externalUrl,
            Integer capacity, UUID categoryId, UUID countryTopicCategoryId,
            String visibilityScope) {
        List<Object> args = new ArrayList<>();
        args.add(title);
        args.add(description);
        args.add(mode);
        args.add(Timestamp.from(startsAt));
        args.add(endsAt == null ? null : Timestamp.from(endsAt));
        args.add(timezone);
        args.add(locationName);
        args.add(externalUrl);
        args.add(capacity);
        args.add(categoryId);
        args.add(countryTopicCategoryId);
        if (visibilityScope != null) {
            args.add(visibilityScope);
        }
        args.add(eventId);
        return args.toArray();
    }

    /**
     * Visibility switch rules: organizer/manager only (caller enforced),
     * before start, and the target scope must be reachable — COMMUNITY scope
     * requires the actor to remain an active member of the event's community,
     * COUNTRY scope requires an event country (set from the community's
     * destination country at creation). Switching COMMUNITY→COUNTRY widens
     * the audience to the event's country deliberately, at the organizer's
     * request — never beyond it, and drafts stay organizer-only.
     */
    private void validateVisibilityChange(UUID actor, EventRow e,
            String visibilityScope) {
        if (visibilityScope == null || visibilityScope.equals(
                e.visibilityScope())) {
            return;
        }
        if (!VISIBILITIES.contains(visibilityScope)) {
            throw bad("INVALID_VISIBILITY");
        }
        if (e.communityId() != null
                && "COMMUNITY".equals(visibilityScope)
                && !community.isActiveMember(actor, e.communityId())) {
            throw forbidden("NOT_A_MEMBER");
        }
        if ("COUNTRY".equals(visibilityScope) && e.countryId() == null) {
            throw bad("COUNTRY_REQUIRED");
        }
    }

    /** Promote waitlisted participants (FIFO) until capacity is reached. */
    private List<UUID> promoteWaitlistToCapacity(UUID eventId, int capacity) {
        var promoted = new ArrayList<UUID>();
        while (rsvpCount(eventId, "GOING") < capacity) {
            UUID next = promoteFromWaitlist(eventId);
            if (next == null) {
                break;
            }
            promoted.add(next);
        }
        return promoted;
    }

    private UUID currentCover(UUID eventId) {
        var ids = jdbc.queryForList("SELECT media_id FROM event_media"
                + " WHERE event_id=? AND is_cover ORDER BY sort_order LIMIT 1",
                UUID.class, eventId);
        return ids.isEmpty() ? null : ids.get(0);
    }

    private void replaceCover(UUID eventId, UUID coverMediaId, UUID actor) {
        jdbc.update("DELETE FROM event_media WHERE event_id=?", eventId);
        if (coverMediaId != null) {
            UUID cover = validateCover(coverMediaId, actor);
            if (cover != null) {
                jdbc.update("INSERT INTO event_media(event_id,media_id,sort_order,"
                        + "is_cover) VALUES(?,?,0,true)", eventId, cover);
            }
        }
    }

    @Transactional
    public EventItem publish(UUID actor, UUID eventId) {
        var e = requireManaged(actor, eventId);
        if ("DELETED".equals(e.status())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "EVENT_NOT_FOUND");
        }
        if (!"DRAFT".equals(e.status())) {
            throw conflict("EVENT_NOT_DRAFT");
        }
        if (e.startsAt().isBefore(Instant.now())) {
            throw conflict("STARTS_AT_IN_PAST");
        }
        jdbc.update("UPDATE events SET status='PUBLISHED',published_at=now(),"
                + "updated_at=now() WHERE id=?", eventId);
        return detail(actor, eventId);
    }

    @Transactional
    public EventItem cancel(UUID actor, UUID eventId, String reason) {
        var e = requireManaged(actor, eventId);
        if ("DELETED".equals(e.status())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "EVENT_NOT_FOUND");
        }
        if (!"PUBLISHED".equals(e.status())) {
            throw conflict("EVENT_NOT_PUBLISHED");
        }
        if (e.cancelledAt() != null) {
            return detail(actor, eventId);           // idempotent
        }
        if (reason != null && reason.trim().length() > 1000) {
            throw bad("CANCEL_REASON_TOO_LONG");
        }
        jdbc.update("UPDATE events SET cancelled_at=now(),cancel_reason=?,"
                + "updated_at=now() WHERE id=?", reason, eventId);
        return detail(actor, eventId);
    }

    /** Soft delete — only while nobody is GOING or WAITLISTED. */
    @Transactional
    public void delete(UUID actor, UUID eventId) {
        var e = requireManaged(actor, eventId);
        if ("DELETED".equals(e.status())) {
            return;                                   // idempotent
        }
        int active = rsvpCount(eventId, "GOING")
                + rsvpCount(eventId, "WAITLISTED");
        if (active > 0) {
            throw conflict("EVENT_HAS_PARTICIPANTS");
        }
        jdbc.update("UPDATE events SET status='DELETED',updated_at=now()"
                + " WHERE id=?", eventId);
    }

    // =================== detail / discovery ===================

    public EventItem detail(UUID viewer, UUID eventId) {
        var e = requireViewable(viewer, eventId);
        var category = requireCategory(e.categoryId(), e.countryId());
        var counts = counts(eventId);
        var my = myRsvp(viewer, eventId);
        boolean saved = isSaved(viewer, eventId);
        return new EventItem(e, category, counts, my, saved,
                canManage(viewer, e));
    }

    public UUID coverMediaId(UUID eventId) {
        return currentCover(eventId);
    }

    /** Authorized cover download URL — the caller passed the visibility check. */
    public String coverDownloadUrl(UUID viewer, UUID eventId) {
        requireViewable(viewer, eventId);
        UUID cover = currentCover(eventId);
        if (cover == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "COVER_NOT_FOUND");
        }
        return media.authorizedDownloadUrl(cover);
    }

    /**
     * Discovery: upcoming published, non-cancelled events visible to the
     * viewer — country-scope events in the viewer's current country plus
     * community events of the viewer's active memberships. Cursor pagination
     * ordered by starts_at, id.
     */
    public EventPage discover(UUID viewer, UUID communityId, String scope,
            UUID categoryId, String mode, Instant from, Instant to, String search,
            String cursor, int size) {
        int limit = clamp(size);
        var args = new ArrayList<Object>();
        args.add(viewer);                              // my.user_id / save join
        args.add(viewer);
        String where = " WHERE e.status='PUBLISHED' AND e.cancelled_at IS NULL";
        if (communityId != null) {
            if (!community.canAccess(viewer, communityId)) {
                throw forbidden("NOT_A_MEMBER");
            }
            where += " AND e.community_id=?";
            args.add(communityId);
        } else {
            var memberships = community.membershipsOf(viewer);
            String communityFilter;
            if (memberships.isEmpty()) {
                communityFilter = "FALSE";
            } else {
                String ph = String.join(",", java.util.Collections.nCopies(
                        memberships.size(), "?"));
                communityFilter = "e.community_id IN (" + ph + ")";
            }
            var country = identity.profileSummary(viewer)
                    .map(ProfileSummary::currentCountryId).orElse(null);
            String countryFilter = country == null
                    ? "FALSE" : "e.visibility_scope='COUNTRY' AND e.country_id=?";
            where += " AND (" + countryFilter + " OR " + communityFilter + ")";
            // Placeholder order mirrors the SQL text: country first, then ids.
            if (country != null) {
                args.add(country);
            }
            memberships.forEach(m -> args.add(m.communityId()));
        }
        if (scope != null && VISIBILITIES.contains(scope)) {
            where += " AND e.visibility_scope=?";
            args.add(scope);
        }
        if (categoryId != null) {
            where += " AND e.event_category_id=?";
            args.add(categoryId);
        }
        if (mode != null && MODES.contains(mode)) {
            where += " AND e.event_mode=?::event_mode";
            args.add(mode);
        }
        Instant effectiveFrom = from != null ? from : Instant.now();
        where += " AND e.starts_at >= ?";
        args.add(Timestamp.from(effectiveFrom));
        if (to != null) {
            where += " AND e.starts_at <= ?";
            args.add(Timestamp.from(to));
        }
        if (search != null && !search.isBlank()) {
            where += " AND e.title ILIKE ?";
            args.add("%" + search.trim() + "%");
        }
        if (cursor != null) {
            var c = decode(cursor);
            where += " AND (e.starts_at,e.id) > (?,?)";
            args.add(Timestamp.from(c.ts()));
            args.add(c.id());
        }
        args.add(limit + 1);
        var rows = jdbc.query("SELECT " + COLS + ",c.id AS cat_id,c.country_id"
                        + " AS cat_country_id,c.category_key,c.display_name,"
                        + "c.sort_order AS cat_sort,"
                        + "(SELECT count(*) FROM event_rsvps r WHERE r.event_id=e.id"
                        + " AND r.status='GOING') AS going_count,"
                        + "(SELECT count(*) FROM event_rsvps r WHERE r.event_id=e.id"
                        + " AND r.status='INTERESTED') AS interested_count,"
                        + "(SELECT count(*) FROM event_rsvps r WHERE r.event_id=e.id"
                        + " AND r.status='WAITLISTED') AS waitlisted_count,"
                        + "my.status::text AS my_rsvp,"
                        + "(s.user_id IS NOT NULL) AS saved"
                        + " FROM events e"
                        + " JOIN event_categories c ON c.id=e.event_category_id"
                        + " LEFT JOIN event_rsvps my ON my.event_id=e.id"
                        + " AND my.user_id=?"
                        + " LEFT JOIN event_saves s ON s.event_id=e.id"
                        + " AND s.user_id=?" + where
                        + " ORDER BY e.starts_at,e.id LIMIT ?",
                (rs, i) -> new Listed(event(rs, i), cat(rs), counts(rs),
                        rs.getString("my_rsvp"), rs.getBoolean("saved")),
                args.toArray());
        return page(rows, limit);
    }

    /** Community-specific listing — any scope, membership enforced. */
    public EventPage communityEvents(UUID viewer, UUID communityId,
            String cursor, int size) {
        return discover(viewer, communityId, null, null, null, null, null, null,
                cursor, size);
    }

    private record Listed(EventRow event, CategoryRow category,
            ParticipantCounts counts, String myRsvp, boolean saved) {
    }

    private EventPage page(List<Listed> rows, int limit) {
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            var last = rows.get(rows.size() - 1);
            next = encode(last.event().startsAt(), last.event().id());
        }
        return new EventPage(rows.stream()
                .map(r -> new EventItem(r.event(), r.category(), r.counts(),
                        r.myRsvp(), r.saved(), false))
                .toList(), next);
    }

    private static CategoryRow cat(java.sql.ResultSet rs)
            throws java.sql.SQLException {
        return new CategoryRow(rs.getObject("cat_id", UUID.class),
                rs.getObject("cat_country_id", UUID.class),
                rs.getString("category_key"), rs.getString("display_name"),
                rs.getInt("cat_sort"));
    }

    private static ParticipantCounts counts(java.sql.ResultSet rs)
            throws java.sql.SQLException {
        return new ParticipantCounts(rs.getInt("going_count"),
                rs.getInt("interested_count"), rs.getInt("waitlisted_count"));
    }

    private static String encode(Instant ts, UUID id) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (ts + "|" + id).getBytes());
    }

    private record CursorParts(Instant ts, UUID id) {
    }

    private static CursorParts decode(String cursor) {
        try {
            var parts = new String(Base64.getUrlDecoder().decode(cursor))
                    .split("\\|");
            if (parts.length != 2) {
                throw bad("INVALID_CURSOR");
            }
            return new CursorParts(Instant.parse(parts[0]), UUID.fromString(parts[1]));
        } catch (IllegalArgumentException | NullPointerException e) {
            throw bad("INVALID_CURSOR");
        }
    }

    // =================== RSVP / capacity / waitlist ===================

    /**
     * Set the caller's RSVP. GOING beyond capacity is automatically placed on
     * the waitlist; leaving GOING (NOT_GOING or removal) promotes the earliest
     * waitlisted participant. The event row is locked FOR UPDATE so concurrent
     * RSVP transactions serialize and capacity is never oversold.
     */
    @Transactional
    public RsvpResult setRsvp(UUID userId, UUID eventId, String status) {
        if (status == null || !RSVP_INPUTS.contains(status)) {
            throw bad("INVALID_RSVP_STATUS");
        }
        EventRow e = lockEvent(eventId);
        if (!canView(userId, e)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "EVENT_NOT_FOUND");
        }
        if (e.cancelledAt() != null) {
            throw conflict("EVENT_CANCELLED");
        }
        if (e.startsAt().isBefore(Instant.now())) {
            throw conflict("EVENT_ALREADY_STARTED");
        }
        String previous = myRsvp(userId, eventId);
        String assigned = status;
        if ("GOING".equals(status) && e.capacity() != null
                && !"GOING".equals(previous)) {
            int going = rsvpCount(eventId, "GOING");
            if (going >= e.capacity()) {
                assigned = "WAITLISTED";
            }
        }
        jdbc.update("INSERT INTO event_rsvps(event_id,user_id,status)"
                        + " VALUES(?,?,?::rsvp_status) ON CONFLICT (event_id,user_id)"
                        + " DO UPDATE SET status=EXCLUDED.status,updated_at=now()",
                eventId, userId, assigned);
        UUID promoted = null;
        if ("GOING".equals(previous) && !"GOING".equals(assigned)) {
            promoted = promoteFromWaitlist(eventId);
        }
        return new RsvpResult(assigned, counts(eventId), e.capacity(), promoted);
    }

    /** Remove the participation record entirely (also frees a spot). */
    @Transactional
    public RsvpResult removeRsvp(UUID userId, UUID eventId) {
        EventRow e = lockEvent(eventId);
        if (!canView(userId, e)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "EVENT_NOT_FOUND");
        }
        String previous = myRsvp(userId, eventId);
        if (previous == null) {
            return new RsvpResult(null, counts(eventId), e.capacity(), null);
        }
        jdbc.update("DELETE FROM event_rsvps WHERE event_id=? AND user_id=?",
                eventId, userId);
        UUID promoted = "GOING".equals(previous) ? promoteFromWaitlist(eventId)
                : null;
        return new RsvpResult(null, counts(eventId), e.capacity(), promoted);
    }

    private EventRow lockEvent(UUID eventId) {
        return jdbc.query("SELECT " + COLS + " FROM events e WHERE e.id=?"
                        + " FOR UPDATE", EventService::event, eventId)
                .stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "EVENT_NOT_FOUND"));
    }

    /** Promote the earliest WAITLISTED participant to GOING, if any. */
    private UUID promoteFromWaitlist(UUID eventId) {
        var next = jdbc.query("SELECT user_id FROM event_rsvps WHERE event_id=?"
                        + " AND status='WAITLISTED' ORDER BY updated_at,user_id"
                        + " LIMIT 1", (rs, i) -> rs.getObject("user_id", UUID.class),
                eventId);
        if (next.isEmpty()) {
            return null;
        }
        UUID promoted = next.get(0);
        jdbc.update("UPDATE event_rsvps SET status='GOING',updated_at=now()"
                + " WHERE event_id=? AND user_id=?", eventId, promoted);
        return promoted;
    }

    private int rsvpCount(UUID eventId, String status) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM event_rsvps"
                + " WHERE event_id=? AND status=?::rsvp_status", Integer.class,
                eventId, status);
        return n == null ? 0 : n;
    }

    public ParticipantCounts counts(UUID eventId) {
        Map<String, Integer> byStatus = jdbc.query(
                "SELECT status::text AS s,count(*) AS n FROM event_rsvps"
                        + " WHERE event_id=? GROUP BY status::text",
                (rs, i) -> Map.entry(rs.getString("s"), rs.getInt("n")), eventId)
                .stream().collect(Collectors.toMap(Map.Entry::getKey,
                        Map.Entry::getValue));
        return new ParticipantCounts(
                byStatus.getOrDefault("GOING", 0),
                byStatus.getOrDefault("INTERESTED", 0),
                byStatus.getOrDefault("WAITLISTED", 0));
    }

    private String myRsvp(UUID userId, UUID eventId) {
        var list = jdbc.queryForList("SELECT status::text FROM event_rsvps"
                + " WHERE event_id=? AND user_id=?", String.class, eventId, userId);
        return list.isEmpty() ? null : list.get(0);
    }

    /**
     * Participant identities are visible only to viewers who can already see
     * the event; users blocked in either direction are hidden.
     */
    public ParticipantPage participants(UUID viewer, UUID eventId,
            String status, int page, int size) {
        var e = requireViewable(viewer, eventId);
        size = clamp(size);
        page = Math.max(page, 0);
        var args = new ArrayList<Object>();
        args.add(eventId);
        String where = " WHERE r.event_id=?";
        if (status != null && (RSVP_INPUTS.contains(status)
                || "WAITLISTED".equals(status))) {
            where += " AND r.status=?::rsvp_status";
            args.add(status);
        }
        args.add(size);
        args.add(page * size);
        var rows = jdbc.query("SELECT r.user_id,r.status::text,r.updated_at"
                        + " FROM event_rsvps r" + where
                        + " ORDER BY r.updated_at,r.user_id LIMIT ? OFFSET ?",
                (rs, i) -> new RsvpRow(rs.getObject("user_id", UUID.class),
                        rs.getString("status")), args.toArray());
        var ids = rows.stream().map(RsvpRow::userId).toList();
        var hidden = ids.isEmpty() ? Set.<UUID>of()
                : social.blockedWith(viewer, ids);
        var profiles = identity.profileSummaries(ids.stream()
                .filter(id -> !hidden.contains(id)).toList());
        var byId = profiles.stream().collect(Collectors.toMap(ProfileSummary::id,
                p -> p, (a, b) -> a));
        List<ParticipantItem> items = new ArrayList<>();
        for (RsvpRow r : rows) {
            var p = byId.get(r.userId());
            if (p != null) {
                items.add(new ParticipantItem(p, r.status()));
            }
        }
        return new ParticipantPage(items, counts(eventId), page, size);
    }

    private record RsvpRow(UUID userId, String status) {
    }

    // =================== saves ===================

    @Transactional
    public void save(UUID userId, UUID eventId) {
        requireViewable(userId, eventId);
        try {
            jdbc.update("INSERT INTO event_saves(user_id,event_id) VALUES(?,?)",
                    userId, eventId);
        } catch (org.springframework.dao.DuplicateKeyException e) {
            // idempotent — already saved
        }
    }

    @Transactional
    public void unsave(UUID userId, UUID eventId) {
        jdbc.update("DELETE FROM event_saves WHERE user_id=? AND event_id=?",
                userId, eventId);
    }

    private boolean isSaved(UUID userId, UUID eventId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM event_saves"
                + " WHERE user_id=? AND event_id=?", Integer.class, userId, eventId);
        return n != null && n > 0;
    }

    /** Saved events, newest save first. */
    public Map<String, Object> savedEvents(UUID viewer, int page, int size) {
        size = clamp(size);
        page = Math.max(page, 0);
        var rows = jdbc.query("SELECT " + COLS + ",c.id AS cat_id,"
                        + "c.country_id AS cat_country_id,c.category_key,"
                        + "c.display_name,c.sort_order AS cat_sort,"
                        + "(SELECT count(*) FROM event_rsvps r WHERE r.event_id=e.id"
                        + " AND r.status='GOING') AS going_count,"
                        + "(SELECT count(*) FROM event_rsvps r WHERE r.event_id=e.id"
                        + " AND r.status='INTERESTED') AS interested_count,"
                        + "(SELECT count(*) FROM event_rsvps r WHERE r.event_id=e.id"
                        + " AND r.status='WAITLISTED') AS waitlisted_count,"
                        + "my.status::text AS my_rsvp,"
                        + "TRUE AS saved"
                        + " FROM event_saves s"
                        + " JOIN events e ON e.id=s.event_id"
                        + " JOIN event_categories c ON c.id=e.event_category_id"
                        + " LEFT JOIN event_rsvps my ON my.event_id=e.id"
                        + " AND my.user_id=?"
                        + " WHERE s.user_id=? AND e.status<>'DELETED'"
                        + " ORDER BY s.created_at DESC,s.event_id DESC"
                        + " LIMIT ? OFFSET ?",
                (rs, i) -> new Listed(event(rs, i), cat(rs), counts(rs),
                        rs.getString("my_rsvp"), true),
                viewer, viewer, size, page * size);
        return Map.of("items", rows.stream()
                .map(r -> new EventItem(r.event(), r.category(), r.counts(),
                        r.myRsvp(), true, canManage(viewer, r.event())))
                .toList(), "page", page, "size", size);
    }

    // =================== my events ===================

    /** role=organized (created/managed) or participating (active RSVP). */
    public Map<String, Object> myEvents(UUID viewer, String role, int page,
            int size) {
        size = clamp(size);
        page = Math.max(page, 0);
        boolean participating = "participating".equalsIgnoreCase(role);
        // Placeholders in SQL order: join r.user_id first, then WHERE literals.
        var args = new ArrayList<Object>();
        args.add(viewer);                              // LEFT JOIN r.user_id=?
        String scope;
        if (participating) {
            scope = " JOIN event_rsvps r ON r.event_id=e.id AND r.user_id=?"
                    + " AND r.status IN ('GOING','INTERESTED','WAITLISTED')";
        } else {
            var accounts = businessAccounts.membershipsOf(viewer).stream()
                    .map(AccountMembershipView::accountId).toList();
            String businessFilter;
            if (accounts.isEmpty()) {
                businessFilter = "FALSE";
            } else {
                String ph = String.join(",", java.util.Collections.nCopies(
                        accounts.size(), "?"));
                businessFilter = "e.business_account_id IN (" + ph + ")";
            }
            // WHERE placeholders: owner, created_by, organizer, business ids.
            args.add(viewer);
            args.add(viewer);
            args.add(viewer);
            accounts.forEach(args::add);
            scope = " LEFT JOIN event_rsvps r ON r.event_id=e.id AND r.user_id=?"
                    + " WHERE (e.owner_user_id=? OR e.created_by_user_id=?"
                    + " OR e.organizer_id=? OR " + businessFilter + ")"
                    + " AND e.status<>'DELETED'";
        }
        args.add(size);
        args.add(page * size);
        var rows = jdbc.query("SELECT " + COLS + ",c.id AS cat_id,"
                        + "c.country_id AS cat_country_id,c.category_key,"
                        + "c.display_name,c.sort_order AS cat_sort,"
                        + "(SELECT count(*) FROM event_rsvps rr WHERE rr.event_id=e.id"
                        + " AND rr.status='GOING') AS going_count,"
                        + "(SELECT count(*) FROM event_rsvps rr WHERE rr.event_id=e.id"
                        + " AND rr.status='INTERESTED') AS interested_count,"
                        + "(SELECT count(*) FROM event_rsvps rr WHERE rr.event_id=e.id"
                        + " AND rr.status='WAITLISTED') AS waitlisted_count,"
                        + (participating ? "r.status::text AS my_rsvp"
                                : "NULL AS my_rsvp")
                        + ",FALSE AS saved"
                        + " FROM events e"
                        + " JOIN event_categories c ON c.id=e.event_category_id"
                        + scope
                        + (participating ? " WHERE e.status<>'DELETED'" : "")
                        + " ORDER BY e.starts_at,e.id LIMIT ? OFFSET ?",
                (rs, i) -> new Listed(event(rs, i), cat(rs), counts(rs),
                        rs.getString("my_rsvp"), rs.getBoolean("saved")),
                args.toArray());
        return Map.of("items", rows.stream()
                .map(r -> new EventItem(r.event(), r.category(), r.counts(),
                        r.myRsvp(), r.myRsvp() != null && isSaved(viewer,
                                r.event().id()), true))
                .toList(), "page", page, "size", size);
    }

    // =================== reporting ===================

    @Transactional
    public UUID report(UUID reporter, UUID eventId, String reason, String details) {
        var e = requireViewable(reporter, eventId);
        if (reason == null || !REPORT_REASONS.contains(reason)) {
            throw bad("INVALID_REPORT_REASON");
        }
        if (details != null && details.length() > 4000) {
            throw bad("REPORT_DETAILS_TOO_LONG");
        }
        Integer open = jdbc.queryForObject("SELECT count(*) FROM reports"
                + " WHERE reporter_id=? AND target_type='EVENT' AND target_id=?"
                + " AND status='OPEN'", Integer.class, reporter, eventId);
        if (open != null && open > 0) {
            throw conflict("REPORT_DUPLICATE");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO reports(id,reporter_id,country_id,community_id,"
                        + "target_type,target_id,reason,details) VALUES(?,?,?,?,"
                        + "?::report_target_type,?,?,?)",
                id, reporter, e.countryId(), e.communityId(), "EVENT", eventId,
                reason, details);
        return id;
    }

    // =================== organizer helpers ===================

    /** Organizer display summary for detail responses. */
    public Optional<ProfileSummary> organizer(UUID eventId) {
        var e = requireEvent(eventId);
        return identity.profileSummary(e.organizerId());
    }

    /** Business account name for detail responses, when business-owned. */
    public Optional<String> businessAccountName(UUID eventId) {
        var e = requireEvent(eventId);
        if (e.businessAccountId() == null) {
            return Optional.empty();
        }
        return businessAccounts.membership(e.organizerId(), e.businessAccountId())
                .map(AccountMembershipView::accountName);
    }

    /** Categories the user has referenced (used by tests/debug listings). */
    public List<CategoryRow> allCategories() {
        return jdbc.query("SELECT id,country_id,category_key,display_name,"
                + "sort_order FROM event_categories ORDER BY sort_order",
                (rs, i) -> new CategoryRow(rs.getObject("id", UUID.class),
                        rs.getObject("country_id", UUID.class),
                        rs.getString("category_key"), rs.getString("display_name"),
                        rs.getInt("sort_order")));
    }
}
