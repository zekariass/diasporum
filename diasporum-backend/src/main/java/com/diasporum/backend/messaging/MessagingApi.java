package com.diasporum.backend.messaging;

import java.util.UUID;

/**
 * Public API of the messaging module: create/reuse direct conversations (incl.
 * context types) and query participant access. Other modules call this
 * interface only — never messaging internals or tables.
 *
 * <p>Methods are added as use cases land; consumers depend on this
 * interface so implementations stay swappable and internals encapsulated.
 */
public interface MessagingApi {

    /**
     * Creates or reuses the canonical GENERAL conversation between two
     * personal users and forces it to ACCEPTED. For internal module flows
     * (e.g. matchmaking mutual-match activation) where mutual consent has
     * already been established — privacy/message-request evaluation is
     * deliberately bypassed by the caller's own policy. Reuses an existing
     * conversation including a previously REQUESTED/DECLINED one.
     */
    UUID ensureAcceptedGeneralConversation(UUID userAId, UUID userBId);

    /** Match-aware variant that also maintains the unique conversation/match link. */
    UUID ensureAcceptedGeneralConversation(UUID userAId, UUID userBId, UUID matchId);

    /** Returns the GENERAL conversation linked to a match, if one exists. */
    java.util.Optional<UUID> conversationIdForMatch(UUID matchId);

    /**
     * Creates or reuses the conversation for {@code contextType}/{@code contextId}
     * between the acting endpoint and the recipient endpoint. The acting
     * endpoint is {@code actorUserId} personally, or
     * {@code actingBusinessAccountId} when the user acts as an authorized
     * active member of that business. Exactly one of
     * {@code recipientUserId}/{@code recipientBusinessAccountId} identifies
     * the other side; for {@code COMMUNITY_HELP_POST} both may be null — the
     * post author is resolved from the feed module.
     *
     * <p>Context conversations start ACCEPTED (schema invariant). The same
     * participant/context uniqueness applies: repeated opens reuse the
     * thread, different resources get separate threads.
     */
    UUID ensureContextConversation(UUID actorUserId,
            UUID actingBusinessAccountId, String contextType, UUID contextId,
            UUID recipientUserId, UUID recipientBusinessAccountId);

    /**
     * Whether {@code viewerUserId} currently belongs to a participant side of
     * the conversation — personally, or as an active accepted member of a
     * participating Business Account. Re-evaluated on every call, so business
     * membership changes take effect immediately.
     */
    boolean canAccess(UUID viewerUserId, UUID conversationId);
}
