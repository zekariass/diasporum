package com.diasporum.backend.messaging.internal.api.rest;

import com.diasporum.backend.messaging.internal.application.MessagingService;
import com.diasporum.backend.messaging.internal.application.MessagingService.MessageRequestView;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Message-request inbox: GENERAL first-contact requests addressed to the
 * caller (personally or to a business they are an active member of).
 */
@RestController
@RequestMapping("/api/v1/message-requests")
public class MessageRequestController {

    private final MessagingService service;

    public MessageRequestController(MessagingService service) {
        this.service = service;
    }

    /** Pending incoming requests, newest first. */
    @GetMapping
    public List<MessageRequestView> incoming(
            @AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return service.incomingRequests(principal.userId());
    }

    /** Accept — the conversation becomes ACCEPTED via the schema trigger. */
    @PostMapping("/{id}/accept")
    public void accept(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID id) {
        service.respondToRequest(principal.userId(), id, true);
    }

    /** Decline — request and conversation become DECLINED. */
    @PostMapping("/{id}/decline")
    public void decline(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID id) {
        service.respondToRequest(principal.userId(), id, false);
    }
}
