package com.diasporum.backend.servicemarketplace.internal.api.rest;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceModerationService;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Page;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Report;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Scoped Service Marketplace moderation endpoints. */
@RestController
@RequestMapping("/api/v1/admin/service")
public class AdminServiceMarketplaceController {
    private final ServiceModerationService moderation;

    public AdminServiceMarketplaceController(ServiceModerationService moderation) {
        this.moderation = moderation;
    }

    @GetMapping("/reports")
    public Page<Report> reports(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String targetType,
            @RequestParam(required = false) UUID countryId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return moderation.reports(principal.userId(), status, targetType, countryId, cursor, size);
    }

    @GetMapping("/reports/{reportId}")
    public Report report(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID reportId) {
        return moderation.report(principal.userId(), reportId);
    }

    @PostMapping("/moderation-actions")
    public ResponseEntity<Report> action(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody ModerationActionBody body) {
        Report report = moderation.moderate(principal.userId(), body.targetType(), body.targetId(),
                body.action(), body.reason(), body.reportId());
        return report == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(report);
    }

    public record ModerationActionBody(@NotBlank String targetType, @NotNull UUID targetId,
            @NotBlank String action, @Size(max = 2000) String reason, UUID reportId) {
    }
}
