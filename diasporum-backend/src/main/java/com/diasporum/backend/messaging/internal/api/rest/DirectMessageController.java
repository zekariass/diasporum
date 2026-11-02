package com.diasporum.backend.messaging.internal.api.rest;

import com.diasporum.backend.messaging.internal.api.rest.Requests.SendMessageRequest;
import com.diasporum.backend.messaging.internal.application.MessagingService;
import com.diasporum.backend.messaging.internal.application.MessagingService.MessagePage;
import com.diasporum.backend.messaging.internal.application.MessagingService.MessageView;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.Valid;
import java.util.List;
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

/** Direct-message endpoints — history, send and soft-delete. */
@RestController
@RequestMapping("/api/v1/conversations/{conversationId}/messages")
public class DirectMessageController {

    private final MessagingService service;

    public DirectMessageController(MessagingService service) {
        this.service = service;
    }

    /** Message history — newest first; {@code beforeSeq} pages older. */
    @GetMapping
    public MessagePage messages(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID conversationId,
            @RequestParam(required = false) Long beforeSeq,
            @RequestParam(defaultValue = "20") int size) {
        return service.messages(principal.userId(), conversationId, beforeSeq, size);
    }

    /**
     * Send a message. {@code clientMessageId} makes retries idempotent.
     * M4: includes optional {@code attachmentIds} for image/document attachments.
     */
    @PostMapping
    public MessageView send(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID conversationId,
            @Valid @RequestBody SendMessageRequest req) {
        return service.sendMessage(principal.userId(), conversationId,
                req.body(), req.clientMessageId(), req.replyToMessageId(),
                req.attachmentIds() == null ? List.of() : req.attachmentIds());
    }

    /** Soft-delete the caller's own message. */
    @DeleteMapping("/{messageId}")
    public void delete(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID conversationId, @PathVariable UUID messageId) {
        service.deleteMessage(principal.userId(), conversationId, messageId);
    }

    /**
     * M4: Returns a short-lived presigned GET URL for the given attachment.
     * Full authorization: actor must be participant, message in conversation,
     * asset linked to message. Never returns permanent or public URLs.
     */
    @PostMapping("/{messageId}/attachments/{assetId}/download-url")
    public Map<String, String> attachmentDownloadUrl(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID conversationId,
            @PathVariable UUID messageId,
            @PathVariable UUID assetId) {
        String url = service.attachmentDownloadUrl(
                principal.userId(), conversationId, messageId, assetId);
        return Map.of("downloadUrl", url);
    }
}
