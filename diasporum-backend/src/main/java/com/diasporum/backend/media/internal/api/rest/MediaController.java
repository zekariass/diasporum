package com.diasporum.backend.media.internal.api.rest;

import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.media.internal.application.MediaService;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Media upload/asset endpoints — actor always resolved from the JWT. */
@RestController
@RequestMapping("/api/v1/media")
public class MediaController {

    private final IdentityApi identity;
    private final MediaService service;

    public MediaController(IdentityApi identity, MediaService service) {
        this.identity = identity;
        this.service = service;
    }

    private UUID me(DiasporumUserPrincipal principal) {
        return identity.findByExternalId("https://accounts.google.com", principal.userId().toString())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "PROFILE_NOT_PROVISIONED"))
                .profileId();
    }

    @PostMapping("/uploads")
    public Map<String, Object> initiate(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> body) {
        var purpose = (String) body.get("purpose");
        var mimeType = (String) body.get("mimeType");
        var declared = body.get("declaredSizeBytes");
        var declaredDuration = body.get("durationMs");
        if (purpose == null || mimeType == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "PURPOSE_AND_MIME_REQUIRED");
        }
        Long size = declared == null ? null
                : Long.parseLong(declared.toString());
        Long duration = declaredDuration == null ? null
                : Long.parseLong(declaredDuration.toString());
        var r = service.initiate(principal.userId(), purpose, mimeType, size,
                duration);
        return Map.of("assetId", r.assetId(), "uploadUrl", r.uploadUrl());
    }

    @PostMapping("/uploads/{assetId}/complete")
    public MediaService.AssetView complete(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID assetId, @RequestBody(required = false)
            Map<String, Object> body) {
        Long size = body == null || body.get("declaredSizeBytes") == null ? null
                : Long.parseLong(body.get("declaredSizeBytes").toString());
        Long duration = body == null || body.get("durationMs") == null ? null
                : Long.parseLong(body.get("durationMs").toString());
        return service.complete(principal.userId(), assetId, size, duration);
    }

    @DeleteMapping("/uploads/{assetId}")
    public void cancel(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID assetId) {
        service.cancel(principal.userId(), assetId);
    }

    @GetMapping("/{assetId}")
    public MediaService.AssetView asset(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID assetId) {
        var a = service.asset(assetId).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "MEDIA_NOT_FOUND"));
        if (!a.ownerId().equals(principal.userId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_OWNER");
        }
        return a;
    }

    @PostMapping("/{assetId}/download-url")
    public Map<String, String> downloadUrl(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID assetId) {
        return Map.of("downloadUrl", service.downloadUrl(principal.userId(), assetId));
    }

    @DeleteMapping("/{assetId}")
    public void delete(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID assetId) {
        service.delete(principal.userId(), assetId);
    }
}
