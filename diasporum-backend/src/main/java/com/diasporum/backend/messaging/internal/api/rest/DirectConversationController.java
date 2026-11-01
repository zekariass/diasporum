package com.diasporum.backend.messaging.internal.api.rest;

import com.diasporum.backend.messaging.internal.api.rest.Requests.CreateConversationRequest;
import com.diasporum.backend.messaging.internal.api.rest.Requests.MarkReadRequest;
import com.diasporum.backend.messaging.internal.api.rest.Requests.MuteRequest;
import com.diasporum.backend.messaging.internal.application.MessagingService;
import com.diasporum.backend.messaging.internal.application.MessagingService.ConversationPage;
import com.diasporum.backend.messaging.internal.application.MessagingService.ConversationView;
import com.diasporum.backend.messaging.internal.application.MessagingService.CreateConversationCommand;
import com.diasporum.backend.messaging.internal.application.MessagingService.UnreadCountView;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Direct-conversation endpoints — actor is always resolved from the JWT;
 * participant/business ids in the body are re-validated server-side.
 */
@RestController
@RequestMapping("/api/v1/conversations")
public class DirectConversationController {

    private final MessagingService service;

    public DirectConversationController(MessagingService service) {
        this.service = service;
    }

    /** Create or reuse a conversation (GENERAL request/direct or context). */
    @PostMapping
    public ConversationView create(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody CreateConversationRequest req) {
        return service.createConversation(principal.userId(),
                new CreateConversationCommand(req.contextType(), req.contextId(),
                        req.recipientUserId(), req.recipientBusinessAccountId(),
                        req.actingBusinessAccountId(), req.initialMessage(),
                        req.clientMessageId()));
    }

    /** Inbox page — keyset cursor on (last activity, id). */
    @GetMapping
    public ConversationPage conversations(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "false") boolean archived) {
        return service.conversations(principal.userId(), cursor, size,
                archived);
    }

    /** Aggregate unread: unread messages + incoming pending requests. */
    @GetMapping("/unread-count")
    public UnreadCountView unreadCount(
            @AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return service.unreadCount(principal.userId());
    }

    /** Conversation detail with both participant side identities. */
    @GetMapping("/{id}")
    public Map<String, Object> conversation(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID id) {
        return service.conversationDetail(principal.userId(), id);
    }

    /** Advance the caller's read cursor (monotonic, clamped at last seq). */
    @PostMapping("/{id}/read")
    public Map<String, Object> markRead(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID id,
            @RequestBody(required = false) MarkReadRequest req) {
        return service.markRead(principal.userId(), id,
                req == null ? null : req.lastReadSeq());
    }

    @PostMapping("/{id}/archive")
    public void archive(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID id) {
        service.setArchived(principal.userId(), id, true);
    }

    @DeleteMapping("/{id}/archive")
    public void unarchive(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID id) {
        service.setArchived(principal.userId(), id, false);
    }

    /** Mute for {@code minutes} (POST), or clear the mute (DELETE). */
    @PostMapping("/{id}/mute")
    public void mute(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID id,
            @RequestBody(required = false) MuteRequest req) {
        service.setMuted(principal.userId(), id,
                req == null ? null : req.minutes());
    }

    @DeleteMapping("/{id}/mute")
    public void unmute(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID id) {
        service.setMuted(principal.userId(), id, null);
    }
}
