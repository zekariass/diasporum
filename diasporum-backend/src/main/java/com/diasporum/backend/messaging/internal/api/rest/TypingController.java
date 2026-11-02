package com.diasporum.backend.messaging.internal.api.rest;

import com.diasporum.backend.messaging.internal.api.rest.Requests.TypingRequest;
import com.diasporum.backend.messaging.internal.application.TypingService;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * M4 typing indicator endpoint. Ephemeral — events go directly to Ably
 * (not via the transactional outbox) and are never persisted in PostgreSQL.
 * Authorization is enforced server-side; clients cannot forge the sender
 * identity in the event payload.
 */
@RestController
@RequestMapping("/api/v1/conversations/{conversationId}/typing")
public class TypingController {

    private final TypingService service;

    public TypingController(TypingService service) {
        this.service = service;
    }

    /**
     * Publish a typing-started or typing-stopped event.
     * {@code typing=true} → TYPING_STARTED, {@code false} → TYPING_STOPPED.
     * Returns 204 on success or when realtime is disabled.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void typing(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID conversationId,
            @RequestBody TypingRequest req) {
        service.publishTyping(principal.userId(), conversationId, req.typing());
    }
}
