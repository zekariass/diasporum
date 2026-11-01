package com.diasporum.backend.messaging.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.feed.FeedApi;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.social.SocialApi;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Direct-messaging core (v10.12 §9.2–9.4): canonical context-aware
 * conversations, message requests, sequence-scoped history and read cursors.
 *
 * <p>The database owns ordering/uniqueness invariants (canonical participant
 * ordering, context validation, sequence allocation, preview maintenance,
 * read-cursor monotonicity, single-initial-message enforcement). This service
 * owns authorization: participant membership (re-checked per request,
 * including live Business Account membership), account status, privacy
 * ({@code dm_permission}/{@code allow_message_requests}), blocks, DM mutes
 * and message-request policy.
 */
@Service
public class MessagingService {

    static final Set<String> CONTEXT_TYPES = Set.of("GENERAL", "PROPERTY_LISTING",
            "VEHICLE_LISTING", "BUSINESS_PROFILE", "EVENT", "JOB_LISTING",
            "SPARE_BAG_CONTACT", "SERVICE_REQUEST", "COMMUNITY_HELP_POST");

    private static final int DEFAULT_PAGE = 20;
    private static final int MAX_PAGE = 50;
    private static final int MAX_BODY = 10_000;

    private final JdbcTemplate jdbc;
    private final IdentityApi identity;
    private final SocialApi social;
    private final CommunityApi community;
    private final BusinessAccountsApi businesses;
    private final FeedApi feed;
    private final MessagingProperties props;

    public MessagingService(JdbcTemplate jdbc, IdentityApi identity,
            SocialApi social, CommunityApi community,
            BusinessAccountsApi businesses, FeedApi feed,
            MessagingProperties props) {
        this.jdbc = jdbc;
        this.identity = identity;
        this.social = social;
        this.community = community;
        this.businesses = businesses;
        this.feed = feed;
        this.props = props;
    }

    // =================== endpoints ===================

    /** A conversation endpoint identity: a personal user, or a Business
     * Account whose canonical representative user id is stored alongside. */
    private record Endpoint(UUID userId, UUID businessAccountId) {
        /** Canonical identity key — mirrors the schema ordering expression. */
        String key() {
            return businessAccountId != null
                    ? "B:" + businessAccountId : "U:" + userId;
        }

        boolean business() {
            return businessAccountId != null;
        }
    }

    private static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    private static ResponseStatusException forbidden(String code) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, code);
    }

    private static ResponseStatusException notFound(String code) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, code);
    }

    private static ResponseStatusException tooMany(String code) {
        return new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, code);
    }

    // =================== abuse protection ===================

    /**
     * Transaction-scoped advisory lock serialising quota checks per acting
     * user — concurrent creates/sends by the same actor are evaluated
     * one-at-a-time so count-then-insert cannot overshoot a limit. Device and
     * session independent, and identical for business acting since quotas key
     * on the acting user id.
     */
    private void lockActor(UUID actor) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended("
                + "'diasporum.messaging.' || ?::text, 0))", Object.class, actor);
    }

    private void checkCreateQuota(UUID actor) {
        int hourly = Optional.ofNullable(jdbc.queryForObject(
                "SELECT count(*) FROM direct_conversations"
                        + " WHERE created_by=?"
                        + " AND created_at > now() - interval '1 hour'",
                Integer.class, actor)).orElse(0);
        if (hourly >= props.createPerHour()) {
            throw tooMany("CONVERSATION_CREATE_RATE_LIMIT");
        }
        int daily = Optional.ofNullable(jdbc.queryForObject(
                "SELECT count(*) FROM direct_conversations"
                        + " WHERE created_by=?"
                        + " AND created_at > now() - interval '1 day'",
                Integer.class, actor)).orElse(0);
        if (daily >= props.createPerDay()) {
            throw tooMany("CONVERSATION_DAILY_QUOTA_EXCEEDED");
        }
    }

    private void checkSendRate(UUID actor) {
        int sent = Optional.ofNullable(jdbc.queryForObject(
                "SELECT count(*) FROM direct_messages"
                        + " WHERE sender_id=?"
                        + " AND created_at > now() - interval '1 minute'",
                Integer.class, actor)).orElse(0);
        if (sent >= props.sendPerMinute()) {
            throw tooMany("MESSAGE_SEND_RATE_LIMIT");
        }
    }

    /** Caps outstanding outbound REQUESTED requests per acting user —
     * request spam is bounded regardless of how many recipients are tried. */
    private void checkPendingRequestCap(UUID actor) {
        int pending = Optional.ofNullable(jdbc.queryForObject(
                "SELECT count(*) FROM message_requests"
                        + " WHERE sender_id=? AND status='REQUESTED'",
                Integer.class, actor)).orElse(0);
        if (pending >= props.maxPendingRequests()) {
            throw tooMany("MESSAGE_REQUEST_LIMIT");
        }
    }

    /**
     * Maps trigger-level rejections to stable codes without leaking whether a
     * resource exists — existence/publication/OPEN failures all surface as
     * {@code CONTEXT_NOT_AVAILABLE} so unauthorized callers cannot probe ids.
     */
    private ResponseStatusException conversationRejected(
            DataIntegrityViolationException e) {
        String m = String.valueOf(e.getMostSpecificCause().getMessage());
        if (m.contains("must be a conversation participant")
                || m.contains("contact request participants")
                || m.contains("customer/provider identities")) {
            return bad("CONTEXT_RECIPIENT_MISMATCH");
        }
        if (m.contains("not authorised to act")) {
            return forbidden("NOT_AUTHORIZED_ACTOR");
        }
        if (m.contains("message-request acceptance")) {
            return bad("CONTEXT_REQUEST_UNSUPPORTED");
        }
        return forbidden("CONTEXT_NOT_AVAILABLE");
    }

    private void requireActiveUser(UUID userId, String code) {
        var p = identity.profileSummary(userId)
                .orElseThrow(() -> notFound("USER_NOT_FOUND"));
        if (!"ACTIVE".equals(p.accountStatus())) {
            throw forbidden(code);
        }
    }

    /** Resolves the endpoint the authenticated actor speaks for. */
    private Endpoint actorEndpoint(UUID actor, UUID actingBusinessAccountId) {
        requireActiveUser(actor, "ACCOUNT_NOT_ACTIVE");
        if (actingBusinessAccountId == null) {
            return new Endpoint(actor, null);
        }
        var biz = businesses.accountSummary(actingBusinessAccountId)
                .orElseThrow(() -> notFound("BUSINESS_ACCOUNT_NOT_FOUND"));
        if (!"ACTIVE".equals(biz.status())) {
            throw forbidden("BUSINESS_ACCOUNT_NOT_ACTIVE");
        }
        if (!businesses.isActiveMember(actor, actingBusinessAccountId)) {
            throw forbidden("NOT_BUSINESS_MEMBER");
        }
        UUID rep = businesses.representativeUserId(actingBusinessAccountId)
                .orElseThrow(() -> bad("BUSINESS_ACCOUNT_NO_REPRESENTATIVE"));
        return new Endpoint(rep, actingBusinessAccountId);
    }

    /** Resolves the recipient endpoint for a requested conversation. */
    private Endpoint recipientEndpoint(String contextType, UUID contextId,
            UUID recipientUserId, UUID recipientBusinessAccountId,
            Endpoint actorEndpoint, UUID actor) {
        if ("COMMUNITY_HELP_POST".equals(contextType)) {
            // Counterparty is the post author — derived server-side, never
            // trusted from the client.
            var post = feed.post(contextId)
                    .orElseThrow(() -> notFound("CONTEXT_NOT_FOUND"));
            if (!"COMMUNITY_HELP".equals(post.postType())) {
                throw bad("CONTEXT_TYPE_MISMATCH");
            }
            if (!feed.canView(actor, contextId)) {
                throw forbidden("CONTEXT_NOT_VISIBLE");
            }
            if (!"OPEN".equals(feed.helpStatus(contextId).orElse(""))) {
                throw bad("HELP_POST_NOT_OPEN");
            }
            return new Endpoint(post.authorId(), null);
        }
        if ((recipientUserId == null) == (recipientBusinessAccountId == null)) {
            throw bad("RECIPIENT_REQUIRED");
        }
        if (recipientBusinessAccountId != null) {
            var biz = businesses.accountSummary(recipientBusinessAccountId)
                    .orElseThrow(() -> notFound("BUSINESS_ACCOUNT_NOT_FOUND"));
            if (!"ACTIVE".equals(biz.status())) {
                throw bad("BUSINESS_ACCOUNT_NOT_ACTIVE");
            }
            UUID rep = businesses.representativeUserId(recipientBusinessAccountId)
                    .orElseThrow(() -> bad("BUSINESS_ACCOUNT_NO_REPRESENTATIVE"));
            return new Endpoint(rep, recipientBusinessAccountId);
        }
        return new Endpoint(recipientUserId, null);
    }

    private void requireEndpointReachable(Endpoint e) {
        if (e.business()) {
            // already validated ACTIVE at resolution time
            return;
        }
        requireActiveUser(e.userId(), "RECIPIENT_NOT_ACTIVE");
    }

    // =================== row types ===================

    public record ConversationRow(UUID id, UUID participantAId,
            UUID participantBId, UUID participantABizId,
            UUID participantBBizId, String contextType, UUID contextId,
            String status, UUID createdBy, long lastMessageSeq,
            Instant lastMessageAt, String lastMessagePreview,
            Instant createdAt) {

        /** Side ('A'/'B') this endpoint occupies, or null. */
        String sideOf(Endpoint e) {
            if (e.userId().equals(participantAId)
                    && java.util.Objects.equals(e.businessAccountId(), participantABizId)) {
                return "A";
            }
            if (e.userId().equals(participantBId)
                    && java.util.Objects.equals(e.businessAccountId(), participantBBizId)) {
                return "B";
            }
            // member acting for a business side: identity match on the biz key
            if (e.businessAccountId() != null) {
                if (e.businessAccountId().equals(participantABizId)) {
                    return "A";
                }
                if (e.businessAccountId().equals(participantBBizId)) {
                    return "B";
                }
            }
            return null;
        }

        Endpoint endpointA() {
            return new Endpoint(participantAId, participantABizId);
        }

        Endpoint endpointB() {
            return new Endpoint(participantBId, participantBBizId);
        }
    }

    private static ConversationRow conv(java.sql.ResultSet rs, int i)
            throws java.sql.SQLException {
        return new ConversationRow(rs.getObject("id", UUID.class),
                rs.getObject("participant_a_id", UUID.class),
                rs.getObject("participant_b_id", UUID.class),
                rs.getObject("participant_a_business_account_id", UUID.class),
                rs.getObject("participant_b_business_account_id", UUID.class),
                rs.getString("context_type"),
                rs.getObject("context_id", UUID.class),
                rs.getString("status"), rs.getObject("created_by", UUID.class),
                rs.getLong("last_message_seq"),
                ts(rs, "last_message_at"), rs.getString("last_message_preview"),
                ts(rs, "created_at"));
    }

    private static final String CONV_COLS = "id,participant_a_id,participant_b_id,"
            + "participant_a_business_account_id,participant_b_business_account_id,"
            + "context_type,context_id,status::text,created_by,last_message_seq,"
            + "last_message_at,last_message_preview,created_at";

    private static Instant ts(java.sql.ResultSet rs, String col)
            throws java.sql.SQLException {
        var t = rs.getTimestamp(col);
        return t == null ? null : t.toInstant();
    }

    public record ParticipantView(String side, UUID userId,
            UUID businessAccountId, String displayName, boolean business) {
    }

    public record ConversationView(UUID id, String contextType, UUID contextId,
            String status, ParticipantView self, ParticipantView other,
            long lastMessageSeq, Instant lastMessageAt,
            String lastMessagePreview, long unreadCount, Instant archivedAt,
            Instant mutedUntil, UUID pendingRequestId,
            String pendingRequestDirection, Instant createdAt) {
    }

    public record MessageView(UUID id, UUID conversationId, long sequenceNo,
            UUID senderId, UUID senderBusinessAccountId, String body,
            String messageType, UUID replyToMessageId, Instant createdAt,
            Instant editedAt) {
    }

    public record MessageRequestView(UUID id, UUID conversationId,
            String status, ParticipantView sender, ParticipantView recipient,
            String initialMessage, Instant createdAt, Instant respondedAt) {
    }

    public record ConversationPage(List<ConversationView> items,
            String nextCursor) {
    }

    public record MessagePage(List<MessageView> items, String nextCursor) {
    }

    public record UnreadCountView(long messages, long pendingRequests,
            long total) {
    }

    // =================== access ===================

    /**
     * Loads a conversation and proves the actor currently occupies one of its
     * participant sides. Returns the actor's endpoint. Membership in a
     * business side is re-validated against live
     * {@code business_account_members} state on every call — revocation
     * removes access without deleting history.
     */
    private Endpoint requireSide(ConversationRow c, UUID actor) {
        // Personal sides: the endpoint user id itself must match.
        if (c.participantABizId() == null && actor.equals(c.participantAId())) {
            return c.endpointA();
        }
        if (c.participantBBizId() == null && actor.equals(c.participantBId())) {
            return c.endpointB();
        }
        // Business sides: live active membership decides.
        if (c.participantABizId() != null
                && businesses.isActiveMember(actor, c.participantABizId())) {
            return c.endpointA();
        }
        if (c.participantBBizId() != null
                && businesses.isActiveMember(actor, c.participantBBizId())) {
            return c.endpointB();
        }
        throw notFound("CONVERSATION_NOT_FOUND");
    }

    private ConversationRow requireConversation(UUID id) {
        return jdbc.query("SELECT " + CONV_COLS + " FROM direct_conversations"
                        + " WHERE id=?", MessagingService::conv, id)
                .stream().findFirst()
                .orElseThrow(() -> notFound("CONVERSATION_NOT_FOUND"));
    }

    /** Conversation access used by the public module API. */
    public boolean canAccess(UUID viewer, UUID conversationId) {
        try {
            requireSide(requireConversation(conversationId), viewer);
            return true;
        } catch (ResponseStatusException e) {
            return false;
        }
    }

    private void requireNotBlocked(Endpoint a, Endpoint b) {
        if (!social.canInteract(a.userId(), b.userId())) {
            throw forbidden("BLOCKED");
        }
    }

    private void requireNotDmMuted(UUID userId) {
        boolean muted = Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM user_mutes WHERE user_id=?"
                        + " AND revoked_at IS NULL AND scope IN"
                        + " ('DIRECT_MESSAGES','ALL') AND starts_at<=now()"
                        + " AND (ends_at IS NULL OR ends_at>now()))",
                Boolean.class, userId));
        if (muted) {
            throw forbidden("DIRECT_MESSAGES_MUTED");
        }
    }

    // =================== privacy policy (GENERAL) ===================

    private record DmPolicy(boolean directAllowed, boolean requestAllowed) {
    }

    /**
     * Evaluates the recipient's DM privacy for a GENERAL conversation.
     * Relationship checks only make sense between personal users — a business
     * actor cannot satisfy MUTUAL_FOLLOWERS/COMMUNITY_MEMBERS and therefore
     * only qualifies for a message request (or direct under EVERYONE).
     */
    private DmPolicy dmPolicy(Endpoint actor, Endpoint recipient, UUID actorUser) {
        if (recipient.business()) {
            // Business endpoints have no personal privacy settings — they are
            // contactable entities and receive direct conversations.
            return new DmPolicy(true, true);
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT dm_permission,allow_message_requests"
                        + " FROM user_privacy_settings WHERE user_id=?",
                recipient.userId());
        // Missing row → schema defaults (INTERACTED_USERS + requests allowed).
        String permission = rows.isEmpty()
                ? "INTERACTED_USERS" : (String) rows.get(0).get("dm_permission");
        boolean requestsAllowed = rows.isEmpty()
                || Boolean.TRUE.equals(rows.get(0).get("allow_message_requests"));
        if ("NONE".equals(permission)) {
            return new DmPolicy(false, false);
        }
        boolean direct = switch (permission) {
            case "EVERYONE" -> true;
            case "MUTUAL_FOLLOWERS" -> !actor.business()
                    && social.isFriend(actorUser, recipient.userId());
            case "COMMUNITY_MEMBERS" -> !actor.business()
                    && shareCommunity(actorUser, recipient.userId());
            case "INTERACTED_USERS" -> !actor.business()
                    && interacted(actorUser, recipient.userId());
            default -> false;
        };
        return new DmPolicy(direct, requestsAllowed);
    }

    private boolean shareCommunity(UUID a, UUID b) {
        var mine = community.membershipsOf(a).stream()
                .filter(m -> "ACTIVE".equals(m.status()))
                .map(CommunityApi.MembershipView::communityId)
                .collect(java.util.stream.Collectors.toSet());
        return community.membershipsOf(b).stream()
                .filter(m -> "ACTIVE".equals(m.status()))
                .anyMatch(m -> mine.contains(m.communityId()));
    }

    /**
     * INTERACTED_USERS approximation: mutual follow, or an already-accepted
     * prior conversation between the same personal users. Shared community
     * membership is deliberately NOT counted — that is the separate
     * {@code COMMUNITY_MEMBERS} permission.
     */
    private boolean interacted(UUID a, UUID b) {
        if (social.isFriend(a, b)) {
            return true;
        }
        UUID lo = a.compareTo(b) < 0 ? a : b;
        UUID hi = a.compareTo(b) < 0 ? b : a;
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM direct_conversations"
                        + " WHERE participant_a_id=? AND participant_b_id=?"
                        + " AND participant_a_business_account_id IS NULL"
                        + " AND participant_b_business_account_id IS NULL"
                        + " AND status='ACCEPTED')",
                Boolean.class, lo, hi));
    }

    // =================== create / reuse ===================

    public record CreateConversationCommand(String contextType, UUID contextId,
            UUID recipientUserId, UUID recipientBusinessAccountId,
            UUID actingBusinessAccountId, String initialMessage,
            String clientMessageId) {
    }

    /**
     * Creates or reuses the canonical conversation. GENERAL evaluates the
     * recipient's privacy and may open as REQUESTED + a pending message
     * request; context conversations open ACCEPTED after context/block checks.
     */
    @Transactional
    public ConversationView createConversation(UUID actor,
            CreateConversationCommand cmd) {
        String contextType = cmd.contextType() == null
                ? "GENERAL" : cmd.contextType().trim().toUpperCase();
        if (!CONTEXT_TYPES.contains(contextType)) {
            throw bad("INVALID_CONTEXT_TYPE");
        }
        boolean general = "GENERAL".equals(contextType);
        if (general && cmd.contextId() != null) {
            throw bad("GENERAL_HAS_NO_CONTEXT_ID");
        }
        if (!general && cmd.contextId() == null) {
            throw bad("CONTEXT_ID_REQUIRED");
        }

        Endpoint self = actorEndpoint(actor, cmd.actingBusinessAccountId());
        Endpoint other = recipientEndpoint(contextType, cmd.contextId(),
                cmd.recipientUserId(), cmd.recipientBusinessAccountId(),
                self, actor);
        requireEndpointReachable(other);
        if (self.key().equals(other.key())) {
            throw bad("CONVERSATION_SELF");
        }
        requireNotBlocked(self, other);
        requireNotDmMuted(actor);

        // Canonical ordering — same expression as the schema CHECK.
        boolean swap = self.key().compareTo(other.key()) > 0;
        Endpoint a = swap ? other : self;
        Endpoint b = swap ? self : other;

        var existing = findConversation(a, b, contextType, cmd.contextId());
        if (existing.isPresent()) {
            return reuseConversation(existing.get(), actor, self, cmd);
        }

        // Quota applies to genuinely new conversations only — retrieving an
        // existing one is free. The advisory lock serialises this actor's
        // creates so the count-then-insert below is race-safe.
        lockActor(actor);
        checkCreateQuota(actor);

        boolean accepted;
        if (general) {
            var policy = dmPolicy(self, other, actor);
            accepted = policy.directAllowed();
            if (!accepted && !policy.requestAllowed()) {
                throw forbidden("MESSAGE_REQUESTS_NOT_ALLOWED");
            }
        } else {
            // Contextual contact: the resource owner opted in by publishing —
            // dm_permission governs GENERAL only per v10.12. Deployments can
            // tighten this via context-respects-dm-permission.
            accepted = true;
            if (props.contextRespectsDmPermission() && !other.business()
                    && !dmPolicy(self, other, actor).directAllowed()) {
                throw forbidden("CONTEXT_DM_NOT_PERMITTED");
            }
        }

        UUID id = UUID.randomUUID();
        UUID convId;
        try {
            convId = jdbc.queryForObject(
                    "INSERT INTO direct_conversations(id,participant_a_id,"
                            + "participant_b_id,"
                            + "participant_a_business_account_id,"
                            + "participant_b_business_account_id,context_type,"
                            + "context_id,status,created_by)"
                            + " VALUES(?,?,?,?,?,?,?,?::dm_status,?)"
                            + " ON CONFLICT (participant_a_id,participant_b_id,"
                            + "participant_a_business_account_id,"
                            + "participant_b_business_account_id,context_type,"
                            + "context_id) DO NOTHING RETURNING id",
                    UUID.class, id, a.userId(), b.userId(),
                    a.businessAccountId(), b.businessAccountId(),
                    contextType, cmd.contextId(),
                    accepted ? "ACCEPTED" : "REQUESTED", actor);
        } catch (DataIntegrityViolationException e) {
            throw conversationRejected(e);
        }
        if (convId == null) {
            // Concurrent create lost the race — reuse the winner's row.
            var won = findConversation(a, b, contextType, cmd.contextId())
                    .orElseThrow(() -> bad("CONVERSATION_CONFLICT"));
            return reuseConversation(won, actor, self, cmd);
        }

        UUID requestId = null;
        if (!accepted) {
            checkPendingRequestCap(actor);
            requestId = insertMessageRequest(convId, actor, self, other);
        }
        if (cmd.initialMessage() != null && !cmd.initialMessage().isBlank()) {
            sendInternal(actor, requireConversation(convId), self,
                    cmd.initialMessage(), cmd.clientMessageId(), null,
                    requestId);
        }
        return toView(requireConversation(convId), actor, self);
    }

    /**
     * {@code sender_id}/{@code recipient_id} are acting users: for a business
     * side the schema trigger requires them to be active members of that
     * business — so the sender is the acting member and the recipient the
     * business's representative user.
     */
    private UUID insertMessageRequest(UUID convId, UUID actor, Endpoint sender,
            Endpoint recipient) {
        try {
            return jdbc.queryForObject(
                    "INSERT INTO message_requests(id,conversation_id,sender_id,"
                            + "recipient_id,sender_business_account_id,"
                            + "recipient_business_account_id,status)"
                            + " VALUES(?,?,?,?,?,?,'REQUESTED') RETURNING id",
                    UUID.class, UUID.randomUUID(), convId, actor,
                    recipient.userId(), sender.businessAccountId(),
                    recipient.businessAccountId());
        } catch (DataIntegrityViolationException e) {
            throw bad("MESSAGE_REQUEST_REJECTED:" + e.getMostSpecificCause()
                    .getMessage());
        }
    }

    private ConversationView reuseConversation(ConversationRow c, UUID actor,
            Endpoint self, CreateConversationCommand cmd) {
        if ("DECLINED".equals(c.status()) && "GENERAL".equals(c.contextType())) {
            return handleDeclinedReuse(c, actor, self, cmd);
        }
        if (cmd.initialMessage() != null && !cmd.initialMessage().isBlank()) {
            sendInternal(actor, c, self, cmd.initialMessage(),
                    cmd.clientMessageId(), null, null);
        }
        return toView(c, actor, self);
    }

    /**
     * Re-opening a declined GENERAL conversation. The declined requester may
     * re-request only after {@code decline-cooldown} (re-evaluating privacy);
     * the declined recipient re-engages freely — their own attempt is an
     * implicit accept. Non-request declined rows (shouldn't exist) fall back
     * to the plain view.
     */
    private ConversationView handleDeclinedReuse(ConversationRow c, UUID actor,
            Endpoint self, CreateConversationCommand cmd) {
        Endpoint other = self.key().equals(c.endpointA().key())
                ? c.endpointB() : c.endpointA();
        var req = jdbc.query("SELECT sender_id,sender_business_account_id,"
                        + "responded_at FROM message_requests"
                        + " WHERE conversation_id=? AND status='DECLINED'"
                        + " ORDER BY responded_at DESC NULLS LAST LIMIT 1",
                (rs, i) -> new Object[]{rs.getObject(1, UUID.class),
                        rs.getObject(2, UUID.class),
                        rs.getTimestamp(3)},
                c.id()).stream().findFirst();
        if (req.isEmpty()) {
            return toView(c, actor, self);
        }
        boolean actorWasSender = req.get()[0].equals(actor)
                && java.util.Objects.equals(req.get()[1],
                self.businessAccountId());
        UUID requestId = null;
        if (actorWasSender) {
            var respondedAt = (java.sql.Timestamp) req.get()[2];
            if (respondedAt != null && Instant.now().isBefore(
                    respondedAt.toInstant().plus(props.declineCooldown()))) {
                throw forbidden("MESSAGE_REQUEST_COOLDOWN");
            }
            var policy = dmPolicy(self, other, actor);
            if (!policy.directAllowed() && !policy.requestAllowed()) {
                throw forbidden("MESSAGE_REQUESTS_NOT_ALLOWED");
            }
            lockActor(actor);
            if (policy.directAllowed()) {
                jdbc.update("UPDATE direct_conversations SET status='ACCEPTED',"
                        + " updated_at=now() WHERE id=?", c.id());
            } else {
                checkPendingRequestCap(actor);
                jdbc.update("UPDATE direct_conversations SET status='REQUESTED',"
                        + " updated_at=now() WHERE id=?", c.id());
                requestId = insertMessageRequest(c.id(), actor, self, other);
            }
        } else {
            lockActor(actor);
            jdbc.update("UPDATE direct_conversations SET status='ACCEPTED',"
                    + " updated_at=now() WHERE id=?", c.id());
        }
        ConversationRow reloaded = requireConversation(c.id());
        if (cmd.initialMessage() != null && !cmd.initialMessage().isBlank()) {
            sendInternal(actor, reloaded, self, cmd.initialMessage(),
                    cmd.clientMessageId(), null, requestId);
        }
        return toView(reloaded, actor, self);
    }

    private Optional<ConversationRow> findConversation(Endpoint a, Endpoint b,
            String contextType, UUID contextId) {
        return jdbc.query("SELECT " + CONV_COLS + " FROM direct_conversations"
                        + " WHERE participant_a_id=? AND participant_b_id=?"
                        + " AND participant_a_business_account_id IS NOT DISTINCT FROM ?"
                        + " AND participant_b_business_account_id IS NOT DISTINCT FROM ?"
                        + " AND context_type=?"
                        + " AND context_id IS NOT DISTINCT FROM ?",
                MessagingService::conv, a.userId(), b.userId(),
                a.businessAccountId(), b.businessAccountId(),
                contextType, contextId).stream().findFirst();
    }

    /**
     * Module-API entry: creates/reuses an accepted GENERAL conversation for
     * flows that carry their own consent (e.g. matchmaking). Privacy and the
     * message-request path are bypassed by design.
     */
    @Transactional
    public UUID ensureAcceptedGeneralConversation(UUID userA, UUID userB) {
        Endpoint a = new Endpoint(userA, null);
        Endpoint b = new Endpoint(userB, null);
        if (a.key().equals(b.key())) {
            throw bad("CONVERSATION_SELF");
        }
        boolean swap = a.key().compareTo(b.key()) > 0;
        Endpoint lo = swap ? b : a;
        Endpoint hi = swap ? a : b;
        var existing = findConversation(lo, hi, "GENERAL", null);
        if (existing.isPresent()) {
            jdbc.update("UPDATE direct_conversations SET status='ACCEPTED',"
                            + " updated_at=now() WHERE id=?"
                            + " AND status <> 'ACCEPTED'",
                    existing.get().id());
            return existing.get().id();
        }
        try {
            return jdbc.queryForObject(
                    "INSERT INTO direct_conversations(participant_a_id,"
                            + "participant_b_id,context_type,status,created_by)"
                            + " VALUES(?,?,'GENERAL','ACCEPTED',?) RETURNING id",
                    UUID.class, lo.userId(), hi.userId(), userA);
        } catch (DataIntegrityViolationException e) {
            return findConversation(lo, hi, "GENERAL", null)
                    .orElseThrow(() -> bad("CONVERSATION_CONFLICT")).id();
        }
    }

    /**
     * Module-API entry: context conversation creation for other modules
     * (help-post responses, listing enquiries) — same checks as REST.
     */
    @Transactional
    public UUID ensureContextConversation(UUID actor,
            UUID actingBusinessAccountId, String contextType, UUID contextId,
            UUID recipientUserId, UUID recipientBusinessAccountId) {
        return createConversation(actor, new CreateConversationCommand(
                contextType, contextId, recipientUserId,
                recipientBusinessAccountId, actingBusinessAccountId, null,
                null)).id();
    }

    // =================== listing / detail ===================

    /** SQL fragment matching conversations where {@code actor} occupies a
     * participant side — personal endpoint match, or live active membership in
     * a business endpoint. Business ids are inlined (UUID literals, no user
     * input) to keep the query a single PreparedStatement. */
    private String mySidesSql(String alias, UUID actor, List<UUID> bizIds) {
        String a = alias == null ? "" : alias + ".";
        var personal = "((" + a + "participant_a_business_account_id IS NULL"
                + " AND " + a + "participant_a_id='" + actor + "'::uuid)"
                + " OR (" + a + "participant_b_business_account_id IS NULL"
                + " AND " + a + "participant_b_id='" + actor + "'::uuid))";
        if (bizIds.isEmpty()) {
            return personal;
        }
        String in = bizIds.stream().map(u -> "'" + u + "'::uuid")
                .collect(java.util.stream.Collectors.joining(","));
        return "(" + personal
                + " OR " + a + "participant_a_business_account_id IN (" + in + ")"
                + " OR " + a + "participant_b_business_account_id IN (" + in + "))";
    }

    /** IN-list of the actor's business accounts, or FALSE when none. */
    private static String bizIn(String column, List<UUID> bizIds) {
        if (bizIds.isEmpty()) {
            return "FALSE";
        }
        return column + " IN (" + bizIds.stream()
                .map(u -> "'" + u + "'::uuid")
                .collect(java.util.stream.Collectors.joining(",")) + ")";
    }

    /** Unread predicate shared by list/count: durable messages past the read
     * cursor that were NOT sent by an identity the viewer controls (own
     * personal sends, or sends as any of their business accounts). */
    private String unreadSql(String msgAlias, List<UUID> bizIds) {
        String m = msgAlias == null ? "" : msgAlias + ".";
        return " AND NOT (" + m + "sender_id=? AND "
                + m + "sender_business_account_id IS NULL)"
                + " AND (" + m + "sender_business_account_id IS NULL OR NOT ("
                + bizIn(m + "sender_business_account_id", bizIds) + "))";
    }

    public ConversationPage conversations(UUID actor, String cursor,
            int size, boolean includeArchived) {
        var bizIds = businesses.activeAccountIdsOf(actor);
        int limit = Math.min(size <= 0 ? DEFAULT_PAGE : size, MAX_PAGE) + 1;

        Instant afterAt = null;
        UUID afterId = null;
        if (cursor != null && !cursor.isBlank()) {
            int sep = cursor.indexOf('_');
            if (sep <= 0) {
                throw bad("INVALID_CURSOR");
            }
            try {
                afterAt = Instant.ofEpochMilli(
                        Long.parseLong(cursor.substring(0, sep)));
                afterId = UUID.fromString(cursor.substring(sep + 1));
            } catch (IllegalArgumentException e) {
                throw bad("INVALID_CURSOR");
            }
        }

        String sql = "SELECT " + CONV_COLS + ",p.last_read_seq,p.archived_at,"
                + "p.muted_until,"
                + "(SELECT count(*) FROM direct_messages m"
                + "  WHERE m.conversation_id=dc.id AND m.deleted_at IS NULL"
                + "  AND m.sequence_no>COALESCE(p.last_read_seq,0)"
                + unreadSql("m", bizIds) + ") AS unread,"
                + "(SELECT mr.id FROM message_requests mr"
                + "  WHERE mr.conversation_id=dc.id AND mr.status='REQUESTED'"
                + "  LIMIT 1) AS pending_request_id,"
                + "(SELECT mr.sender_id FROM message_requests mr"
                + "  WHERE mr.conversation_id=dc.id AND mr.status='REQUESTED'"
                + "  LIMIT 1) AS pending_sender_id,"
                + "(SELECT mr.sender_business_account_id FROM message_requests mr"
                + "  WHERE mr.conversation_id=dc.id AND mr.status='REQUESTED'"
                + "  LIMIT 1) AS pending_sender_biz"
                + " FROM direct_conversations dc"
                + " LEFT JOIN direct_conversation_participants p"
                + "  ON p.conversation_id=dc.id AND p.user_id=?"
                + " WHERE dc.status IN ('REQUESTED','ACCEPTED')"
                + " AND " + mySidesSql("dc", actor, bizIds);
        var args = new ArrayList<Object>();
        args.add(actor);                                   // unread: own sends
        args.add(actor);                                   // p.user_id
        if (!includeArchived) {
            sql += " AND p.archived_at IS NULL";
        }
        if (afterAt != null) {
            sql += " AND (COALESCE(dc.last_message_at,dc.created_at),dc.id)"
                    + " < (?,?)";
            args.add(java.sql.Timestamp.from(afterAt));
            args.add(afterId);
        }
        sql += " ORDER BY COALESCE(dc.last_message_at,dc.created_at) DESC,"
                + "dc.id DESC LIMIT ?";
        args.add(limit);

        var rows = jdbc.query(sql, (rs, i) -> {
            ConversationRow c = conv(rs, i);
            return new Object[]{c,
                    rs.getObject("last_read_seq", Long.class),
                    ts(rs, "archived_at"), ts(rs, "muted_until"),
                    rs.getLong("unread"),
                    rs.getObject("pending_request_id", UUID.class),
                    rs.getObject("pending_sender_id", UUID.class),
                    rs.getObject("pending_sender_biz", UUID.class)};
        }, args.toArray());

        String next = null;
        var page = rows.size() > limit - 1 ? rows.subList(0, limit - 1) : rows;
        if (rows.size() > limit - 1) {
            ConversationRow last = (ConversationRow) page.get(page.size() - 1)[0];
            Instant sort = last.lastMessageAt() != null
                    ? last.lastMessageAt() : last.createdAt();
            next = sort.toEpochMilli() + "_" + last.id();
        }

        var items = page.stream().map(r -> toView((ConversationRow) r[0],
                actor, null, (Long) r[1], (Instant) r[2], (Instant) r[3],
                (long) r[4], (UUID) r[5],
                requestDirection(actor, resolveSide((ConversationRow) r[0],
                        actor, null), (UUID) r[6], (UUID) r[7]))).toList();
        return new ConversationPage(items, next);
    }

    private static String requestDirection(UUID actor, Endpoint self,
            UUID senderId, UUID senderBiz) {
        if (self == null) {
            return null;
        }
        boolean mine = senderBiz == null
                ? actor.equals(senderId) && !self.business()
                : senderBiz.equals(self.businessAccountId());
        return mine ? "OUTGOING" : "INCOMING";
    }

    private Endpoint resolveSide(ConversationRow c, UUID actor,
            String recordedSide) {
        Endpoint a = c.endpointA();
        Endpoint b = c.endpointB();
        // A business side is occupied by any active member; a personal side by
        // the endpoint user. The recorded participant side is the cursor row's
        // side — fall back to live membership checks.
        if (a.businessAccountId() == null && actor.equals(a.userId())) {
            return a;
        }
        if (b.businessAccountId() == null && actor.equals(b.userId())) {
            return b;
        }
        if (a.businessAccountId() != null
                && businesses.isActiveMember(actor, a.businessAccountId())) {
            return a;
        }
        if (b.businessAccountId() != null
                && businesses.isActiveMember(actor, b.businessAccountId())) {
            return b;
        }
        return null;
    }

    private ParticipantView participantView(String side, Endpoint e,
            Map<UUID, IdentityApi.ProfileSummary> profiles,
            Map<UUID, String> bizNames) {
        String name;
        if (e.business()) {
            name = bizNames.getOrDefault(e.businessAccountId(), "Business");
        } else {
            var p = profiles.get(e.userId());
            name = p != null
                    ? (p.displayName() != null ? p.displayName() : p.username())
                    : "Diasporum member";
        }
        return new ParticipantView(side, e.userId(), e.businessAccountId(),
                name, e.business());
    }

    private Map<UUID, String> businessNames(ConversationRow c) {
        var m = new LinkedHashMap<UUID, String>();
        for (UUID biz : new UUID[]{c.participantABizId(),
                c.participantBBizId()}) {
            if (biz != null) {
                businesses.accountSummary(biz)
                        .ifPresent(s -> m.put(biz, s.accountName()));
            }
        }
        return m;
    }

    private Map<UUID, IdentityApi.ProfileSummary> profilesOf(
            ConversationRow c) {
        var ids = new ArrayList<UUID>();
        ids.add(c.participantAId());
        ids.add(c.participantBId());
        return identity.profileSummaries(ids).stream()
                .collect(java.util.stream.Collectors.toMap(
                        IdentityApi.ProfileSummary::id, p -> p));
    }

    private ConversationView toView(ConversationRow c, UUID actor, Endpoint known) {
        UUID requestId = null;
        String direction = null;
        if ("REQUESTED".equals(c.status())) {
            Endpoint self = known != null
                    ? known : resolveSide(c, actor, null);
            var req = jdbc.query("SELECT id,sender_id,"
                            + "sender_business_account_id FROM message_requests"
                            + " WHERE conversation_id=? AND status='REQUESTED'",
                    (rs, i) -> new Object[]{rs.getObject(1, UUID.class),
                            rs.getObject(2, UUID.class),
                            rs.getObject(3, UUID.class)},
                    c.id()).stream().findFirst().orElse(null);
            if (req != null) {
                requestId = (UUID) req[0];
                direction = requestDirection(actor, self, (UUID) req[1],
                        (UUID) req[2]);
            }
        }
        return toView(c, actor, known, null, null, null, -1, requestId,
                direction);
    }

    private ConversationView toView(ConversationRow c, UUID actor,
            Endpoint known, Long lastReadSeq, Instant archivedAt,
            Instant mutedUntil, long unread, UUID pendingRequestId,
            String direction) {
        Endpoint self = known != null ? known : resolveSide(c, actor, null);
        if (self == null) {
            throw notFound("CONVERSATION_NOT_FOUND");
        }
        String mySide = c.sideOf(self);
        Endpoint other = "A".equals(mySide) ? c.endpointB() : c.endpointA();
        var profiles = profilesOf(c);
        var bizNames = businessNames(c);
        if (unread < 0) {
            unread = unreadFor(c, actor, self, lastReadSeq);
        }
        return new ConversationView(c.id(), c.contextType(), c.contextId(),
                c.status(), participantView(mySide, self, profiles, bizNames),
                participantView("A".equals(mySide) ? "B" : "A", other,
                        profiles, bizNames),
                c.lastMessageSeq(), c.lastMessageAt(), c.lastMessagePreview(),
                unread, archivedAt, mutedUntil, pendingRequestId, direction,
                c.createdAt());
    }

    private long unreadFor(ConversationRow c, UUID actor, Endpoint self,
            Long lastReadSeq) {
        if (lastReadSeq == null) {
            var row = jdbc.query("SELECT last_read_seq"
                            + " FROM direct_conversation_participants"
                            + " WHERE conversation_id=? AND user_id=? AND side=?",
                    (rs, i) -> rs.getLong(1), c.id(), actor, c.sideOf(self))
                    .stream().findFirst();
            lastReadSeq = row.orElse(0L);
        }
        // Exclude messages sent from an identity the viewer controls.
        return Optional.ofNullable(jdbc.queryForObject(
                "SELECT count(*) FROM direct_messages"
                        + " WHERE conversation_id=? AND deleted_at IS NULL"
                        + " AND sequence_no>?"
                        + unreadSql(null,
                                businesses.activeAccountIdsOf(actor)),
                Long.class, c.id(), lastReadSeq, actor)).orElse(0L);
    }

    public Map<String, Object> conversationDetail(UUID actor, UUID id) {
        var c = requireConversation(id);
        Endpoint self = requireSide(c, actor);
        var profiles = profilesOf(c);
        var bizNames = businessNames(c);
        var participants = List.of(
                participantView("A", c.endpointA(), profiles, bizNames),
                participantView("B", c.endpointB(), profiles, bizNames));
        return Map.of("conversation", toView(c, actor, self),
                "participants", participants);
    }

    // =================== messages ===================

    private void requireReplyTarget(UUID convId, UUID replyToMessageId) {
        if (replyToMessageId == null) {
            return;
        }
        boolean ok = Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM direct_messages WHERE id=?"
                        + " AND conversation_id=? AND deleted_at IS NULL)",
                Boolean.class, replyToMessageId, convId));
        if (!ok) {
            throw bad("REPLY_TARGET_NOT_FOUND");
        }
    }

    /**
     * Internal send used by both REST and conversation creation. When
     * {@code requestId} is supplied the message is recorded as the request's
     * single initial message (enforced by the sequence trigger).
     */
    private MessageView sendInternal(UUID actor, ConversationRow c,
            Endpoint self, String body, String clientMessageId,
            UUID replyToMessageId, UUID requestId) {
        String text = body == null ? "" : body.trim();
        if (text.isEmpty() || text.length() > MAX_BODY) {
            throw bad("INVALID_MESSAGE_BODY");
        }
        requireNotBlocked(c.endpointA(), c.endpointB());
        requireNotDmMuted(actor);
        requireReplyTarget(c.id(), replyToMessageId);

        UUID messageRequestId = requestId;
        if (!"ACCEPTED".equals(c.status())) {
            if (!"REQUESTED".equals(c.status())) {
                throw forbidden("CONVERSATION_NOT_SENDABLE");
            }
            // REQUESTED (GENERAL): only the requester's own initial message.
            if (messageRequestId == null) {
                var req = jdbc.query("SELECT id,sender_id,"
                                + "sender_business_account_id FROM message_requests"
                                + " WHERE conversation_id=? AND status='REQUESTED'",
                        (rs, i) -> new Object[]{rs.getObject(1, UUID.class),
                                rs.getObject(2, UUID.class),
                                rs.getObject(3, UUID.class)},
                        c.id()).stream().findFirst()
                        .orElseThrow(() -> forbidden("CONVERSATION_NOT_ACCEPTED"));
                boolean mine = req[1].equals(actor)
                        && java.util.Objects.equals(req[2],
                        self.businessAccountId());
                if (!mine) {
                    throw forbidden("CONVERSATION_NOT_ACCEPTED");
                }
                messageRequestId = (UUID) req[0];
            }
        }

        // Idempotent replay — client_message_id is unique per sender.
        if (clientMessageId != null && !clientMessageId.isBlank()) {
            var prior = jdbc.query("SELECT id,sequence_no,created_at,"
                            + "sender_business_account_id,body,"
                            + "reply_to_message_id,edited_at FROM direct_messages"
                            + " WHERE sender_id=? AND client_message_id=?",
                    (rs, i) -> new MessageView(rs.getObject(1, UUID.class),
                            c.id(), rs.getLong(2), actor,
                            rs.getObject(4, UUID.class), rs.getString(5),
                            "TEXT", rs.getObject(6, UUID.class),
                            rs.getTimestamp(3).toInstant(), ts(rs, "edited_at")),
                    actor, clientMessageId).stream().findFirst();
            if (prior.isPresent()) {
                return prior.get();
            }
        }

        UUID id = UUID.randomUUID();
        try {
            var row = jdbc.queryForMap(
                    "INSERT INTO direct_messages(id,conversation_id,sender_id,"
                            + "sender_business_account_id,message_request_id,"
                            + "client_message_id,body,message_type,"
                            + "reply_to_message_id)"
                            + " VALUES(?,?,?,?,?,?,?, 'TEXT',?)"
                            + " RETURNING id,sequence_no,created_at",
                    id, c.id(), actor, self.businessAccountId(),
                    messageRequestId,
                    clientMessageId == null || clientMessageId.isBlank()
                            ? null : clientMessageId,
                    text, replyToMessageId);
            long seq = ((Number) row.get("sequence_no")).longValue();
            Instant createdAt = ((java.sql.Timestamp) row.get("created_at"))
                    .toInstant();
            enqueueOutbox(c, id, actor, self, seq, text);
            return new MessageView(id, c.id(), seq, actor,
                    self.businessAccountId(), text, "TEXT", replyToMessageId,
                    createdAt, null);
        } catch (DuplicateKeyException e) {
            // sequence_no or client_message_id race — safe to surface 409.
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "MESSAGE_CONFLICT", e);
        } catch (DataIntegrityViolationException e) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "MESSAGE_REJECTED:" + e.getMostSpecificCause().getMessage(),
                    e);
        }
    }

    /** Transactional outbox event for realtime fan-out (schema §7.2 — the
     * server persists the event atomically with the durable message; a later
     * publisher ships it to Ably). */
    private void enqueueOutbox(ConversationRow c, UUID messageId, UUID actor,
            Endpoint self, long seq, String body) {
        jdbc.update("INSERT INTO outbox_events(aggregate_type,aggregate_id,"
                        + "event_type,destination,destination_key,payload,"
                        + "event_dedupe_key)"
                        + " VALUES('DIRECT_MESSAGE',?,'DIRECT_MESSAGE_CREATED',"
                        + "'ABLY',?,?::jsonb,?)",
                c.id(), "conversation:" + c.id(),
                "{\"messageId\":\"" + messageId + "\",\"conversationId\":\""
                        + c.id() + "\",\"sequenceNo\":" + seq
                        + ",\"senderId\":\"" + actor + "\""
                        + (self.businessAccountId() == null ? ""
                        : ",\"senderBusinessAccountId\":\""
                        + self.businessAccountId() + "\"")
                        + "}",
                "dm-created:" + messageId);
    }

    @Transactional
    public MessageView sendMessage(UUID actor, UUID conversationId,
            String body, String clientMessageId, UUID replyToMessageId) {
        var c = requireConversation(conversationId);
        Endpoint self = requireSide(c, actor);
        lockActor(actor);
        checkSendRate(actor);
        return sendInternal(actor, c, self, body, clientMessageId,
                replyToMessageId, null);
    }

    public MessagePage messages(UUID actor, UUID conversationId,
            Long beforeSeq, int size) {
        var c = requireConversation(conversationId);
        requireSide(c, actor);
        int limit = Math.min(size <= 0 ? DEFAULT_PAGE : size, MAX_PAGE) + 1;
        long before = beforeSeq == null ? Long.MAX_VALUE : beforeSeq;
        var rows = jdbc.query("SELECT id,sequence_no,sender_id,"
                        + "sender_business_account_id,body,message_type,"
                        + "reply_to_message_id,created_at,edited_at"
                        + " FROM direct_messages WHERE conversation_id=?"
                        + " AND deleted_at IS NULL AND sequence_no<?"
                        + " ORDER BY sequence_no DESC LIMIT ?",
                (rs, i) -> new MessageView(rs.getObject("id", UUID.class),
                        conversationId, rs.getLong("sequence_no"),
                        rs.getObject("sender_id", UUID.class),
                        rs.getObject("sender_business_account_id", UUID.class),
                        rs.getString("body"), rs.getString("message_type"),
                        rs.getObject("reply_to_message_id", UUID.class),
                        ts(rs, "created_at"), ts(rs, "edited_at")),
                conversationId, before, limit);
        String next = null;
        var page = rows.size() > limit - 1 ? rows.subList(0, limit - 1) : rows;
        if (rows.size() > limit - 1) {
            next = String.valueOf(page.get(page.size() - 1).sequenceNo());
        }
        return new MessagePage(page, next);
    }

    @Transactional
    public void deleteMessage(UUID actor, UUID conversationId, UUID messageId) {
        var c = requireConversation(conversationId);
        Endpoint self = requireSide(c, actor);
        var msg = jdbc.query("SELECT sender_id,sender_business_account_id"
                        + " FROM direct_messages WHERE id=? AND conversation_id=?"
                        + " AND deleted_at IS NULL",
                (rs, i) -> new Object[]{rs.getObject(1, UUID.class),
                        rs.getObject(2, UUID.class)},
                messageId, conversationId).stream().findFirst()
                .orElseThrow(() -> notFound("MESSAGE_NOT_FOUND"));
        boolean mine = msg[0].equals(actor)
                && java.util.Objects.equals(msg[1], self.businessAccountId());
        if (!mine) {
            throw forbidden("NOT_MESSAGE_SENDER");
        }
        jdbc.update("UPDATE direct_messages SET deleted_at=now() WHERE id=?",
                messageId);
    }

    // =================== read state / inbox controls ===================

    @Transactional
    public Map<String, Object> markRead(UUID actor, UUID conversationId,
            Long lastReadSeq) {
        var c = requireConversation(conversationId);
        Endpoint self = requireSide(c, actor);
        long target = lastReadSeq == null
                ? c.lastMessageSeq() : Math.min(lastReadSeq, c.lastMessageSeq());
        String side = c.sideOf(self);
        try {
            jdbc.update("INSERT INTO direct_conversation_participants"
                            + "(conversation_id,side,user_id,last_read_seq,"
                            + "last_read_at) VALUES(?,?,?,?,now())"
                            + " ON CONFLICT (conversation_id,side,user_id)"
                            + " DO UPDATE SET last_read_seq=EXCLUDED.last_read_seq",
                    c.id(), side, actor, target);
        } catch (DataIntegrityViolationException e) {
            throw bad("READ_CURSOR_REJECTED");
        }
        return Map.of("conversationId", c.id(), "lastReadSeq", target);
    }

    @Transactional
    public void setArchived(UUID actor, UUID conversationId, boolean archived) {
        var c = requireConversation(conversationId);
        Endpoint self = requireSide(c, actor);
        upsertParticipantState(c.id(), c.sideOf(self), actor,
                "archived_at", archived ? "now()" : "NULL");
    }

    @Transactional
    public void setMuted(UUID actor, UUID conversationId, Integer minutes) {
        var c = requireConversation(conversationId);
        Endpoint self = requireSide(c, actor);
        if (minutes == null) {
            upsertParticipantState(c.id(), c.sideOf(self), actor,
                    "muted_until", "NULL");
        } else if (minutes <= 0 || minutes > 60 * 24 * 365) {
            throw bad("INVALID_MUTE_DURATION");
        } else {
            upsertParticipantState(c.id(), c.sideOf(self), actor,
                    "muted_until", "now()+interval '" + minutes + " minutes'");
        }
    }

    private void upsertParticipantState(UUID convId, String side, UUID actor,
            String column, String valueExpr) {
        jdbc.update("INSERT INTO direct_conversation_participants"
                        + "(conversation_id,side,user_id) VALUES(?,?,?)"
                        + " ON CONFLICT (conversation_id,side,user_id)"
                        + " DO UPDATE SET " + column + "=" + valueExpr,
                convId, side, actor);
    }

    public UnreadCountView unreadCount(UUID actor) {
        var bizIds = businesses.activeAccountIdsOf(actor);
        Long messages = jdbc.queryForObject(
                "SELECT COALESCE(SUM(cnt.cnt),0) FROM ("
                        + "SELECT (SELECT count(*) FROM direct_messages m"
                        + " WHERE m.conversation_id=dc.id AND m.deleted_at IS NULL"
                        + " AND m.sequence_no>COALESCE(p.last_read_seq,0)"
                        + unreadSql("m", bizIds) + ") AS cnt"
                        + " FROM direct_conversations dc"
                        + " LEFT JOIN direct_conversation_participants p"
                        + "  ON p.conversation_id=dc.id AND p.user_id=?"
                        + " WHERE dc.status='ACCEPTED' AND "
                        + mySidesSql("dc", actor, bizIds) + ") cnt",
                Long.class, actor, actor);
        Long pending = jdbc.queryForObject(
                "SELECT count(*) FROM message_requests mr"
                        + " WHERE mr.status='REQUESTED'"
                        + " AND ((mr.recipient_id=? AND"
                        + "  mr.recipient_business_account_id IS NULL) OR "
                        + bizIn("mr.recipient_business_account_id", bizIds) + ")",
                Long.class, actor);
        long m = messages == null ? 0 : messages;
        long pr = pending == null ? 0 : pending;
        return new UnreadCountView(m, pr, m + pr);
    }

    // =================== message requests ===================

    public List<MessageRequestView> incomingRequests(UUID actor) {
        var bizIds = businesses.activeAccountIdsOf(actor);
        String bizCond = bizIds.isEmpty() ? "FALSE"
                : "mr.recipient_business_account_id IN (" + bizIds.stream()
                .map(u -> "'" + u + "'::uuid")
                .collect(java.util.stream.Collectors.joining(",")) + ")";
        return jdbc.query("SELECT mr.id,mr.conversation_id,mr.sender_id,"
                        + "mr.recipient_id,mr.sender_business_account_id,"
                        + "mr.recipient_business_account_id,mr.status::text,"
                        + "mr.created_at,mr.responded_at,"
                        + "(SELECT m.body FROM direct_messages m"
                        + " WHERE m.message_request_id=mr.id AND m.deleted_at IS NULL"
                        + " LIMIT 1) AS initial_body"
                        + " FROM message_requests mr"
                        + " WHERE mr.status='REQUESTED'"
                        + " AND (mr.recipient_id=? OR " + bizCond + ")"
                        + " ORDER BY mr.created_at DESC LIMIT 50",
                (rs, i) -> toRequestView(rs), actor);
    }

    private MessageRequestView toRequestView(java.sql.ResultSet rs)
            throws java.sql.SQLException {
        UUID senderBiz = rs.getObject("sender_business_account_id", UUID.class);
        UUID recipBiz = rs.getObject("recipient_business_account_id", UUID.class);
        UUID senderId = rs.getObject("sender_id", UUID.class);
        UUID recipId = rs.getObject("recipient_id", UUID.class);
        var profiles = identity.profileSummaries(List.of(senderId, recipId))
                .stream().collect(java.util.stream.Collectors.toMap(
                        IdentityApi.ProfileSummary::id, p -> p));
        String senderName = senderBiz != null
                ? businesses.accountSummary(senderBiz)
                        .map(BusinessAccountsApi.BusinessAccountSummary::accountName)
                        .orElse("Business")
                : name(profiles.get(senderId));
        String recipName = recipBiz != null
                ? businesses.accountSummary(recipBiz)
                        .map(BusinessAccountsApi.BusinessAccountSummary::accountName)
                        .orElse("Business")
                : name(profiles.get(recipId));
        return new MessageRequestView(rs.getObject("id", UUID.class),
                rs.getObject("conversation_id", UUID.class),
                rs.getString("status"),
                new ParticipantView(null, senderId, senderBiz, senderName,
                        senderBiz != null),
                new ParticipantView(null, recipId, recipBiz, recipName,
                        recipBiz != null),
                rs.getString("initial_body"), ts(rs, "created_at"),
                ts(rs, "responded_at"));
    }

    private static String name(IdentityApi.ProfileSummary p) {
        return p == null ? "Diasporum member"
                : (p.displayName() != null ? p.displayName() : p.username());
    }

    @Transactional
    public void respondToRequest(UUID actor, UUID requestId, boolean accept) {
        var row = jdbc.query("SELECT mr.conversation_id,mr.status::text,"
                        + "mr.recipient_id,mr.recipient_business_account_id"
                        + " FROM message_requests mr WHERE mr.id=?",
                (rs, i) -> new Object[]{rs.getObject(1, UUID.class),
                        rs.getString(2), rs.getObject(3, UUID.class),
                        rs.getObject(4, UUID.class)},
                requestId).stream().findFirst()
                .orElseThrow(() -> notFound("MESSAGE_REQUEST_NOT_FOUND"));
        if (!"REQUESTED".equals(row[1])) {
            throw bad("MESSAGE_REQUEST_ALREADY_RESOLVED");
        }
        UUID convId = (UUID) row[0];
        UUID recipientId = (UUID) row[2];
        UUID recipientBiz = (UUID) row[3];
        boolean mine = recipientBiz == null
                ? actor.equals(recipientId)
                : businesses.isActiveMember(actor, recipientBiz);
        if (!mine) {
            throw forbidden("NOT_REQUEST_RECIPIENT");
        }
        jdbc.update("UPDATE message_requests SET status=?::dm_status,"
                        + "responded_at=now() WHERE id=?",
                accept ? "ACCEPTED" : "DECLINED", requestId);
        if (!accept) {
            // The acceptance trigger only covers ACCEPTED/CLOSED — mark the
            // conversation declined so no side can continue it.
            jdbc.update("UPDATE direct_conversations SET status='DECLINED',"
                    + " updated_at=now() WHERE id=?", convId);
        }
    }
}
