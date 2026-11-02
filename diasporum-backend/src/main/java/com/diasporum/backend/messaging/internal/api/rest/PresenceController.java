package com.diasporum.backend.messaging.internal.api.rest;

import com.diasporum.backend.messaging.internal.application.MessagingService;
import com.diasporum.backend.messaging.internal.application.PresenceService;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * M4 — Presence endpoints.
 * POST /api/v1/presence/heartbeat — keep-alive (call every 30 s while active).
 * DELETE /api/v1/presence/online — explicit offline on sign-out/background.
 * GET /api/v1/conversations/{id}/presence — participants' online status.
 */
@RestController
public class PresenceController {

    private final PresenceService presence;
    private final MessagingService messaging;

    public PresenceController(PresenceService presence, MessagingService messaging) {
        this.presence = presence;
        this.messaging = messaging;
    }

    /** Heartbeat — updates last-seen timestamp; publishes PRESENCE_ONLINE on first call. */
    @PostMapping("/api/v1/presence/heartbeat")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void heartbeat(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        presence.heartbeat(principal.userId());
    }

    /** Explicit offline — call on sign-out or when the app goes to background. */
    @PostMapping("/api/v1/presence/offline")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void goOffline(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        presence.goOffline(principal.userId());
    }

    /**
     * Returns presence status for each participant user in the conversation.
     * Authorization: actor must be a participant (enforced via conversationParticipantUserIds).
     */
    @GetMapping("/api/v1/conversations/{conversationId}/presence")
    public Map<String, Boolean> conversationPresence(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID conversationId) {
        Set<UUID> participants = messaging.conversationParticipantUserIds(conversationId);
        if (!participants.contains(principal.userId())) {
            throw new org.springframework.web.server.ResponseStatusException(
                    HttpStatus.FORBIDDEN, "NOT_CONVERSATION_PARTICIPANT");
        }
        return participants.stream().collect(Collectors.toMap(
                UUID::toString,
                presence::isOnline));
    }
}
