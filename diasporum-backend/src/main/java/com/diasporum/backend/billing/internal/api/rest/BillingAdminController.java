package com.diasporum.backend.billing.internal.api.rest;

import com.diasporum.backend.billing.internal.application.BillingAdminService;
import com.diasporum.backend.billing.internal.application.BillingAdminService.FeatureConfigurationView;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Audited administration for Extended-community Billing; values are never client-supplied. */
@RestController
@RequestMapping("/api/v1/admin/billing")
public class BillingAdminController {

    private final BillingAdminService service;

    public BillingAdminController(BillingAdminService service) {
        this.service = service;
    }

    @GetMapping("/extended-features")
    public List<FeatureConfigurationView> configurations(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(defaultValue = "FREE") String planKey) {
        return service.configurations(principal.userId(), planKey);
    }

    @PutMapping("/extended-features/{featureKey}/plans/{planKey}")
    public FeatureConfigurationView setEntitlement(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable String featureKey, @PathVariable String planKey,
            @RequestBody Map<String, Object> body) {
        return service.setEntitlement(principal.userId(), planKey, featureKey,
                Boolean.TRUE.equals(body.get("enabled")), longValue(body.get("quantityLimit")),
                (String) body.get("resetPeriod"));
    }

    @PutMapping("/extended-features/{featureKey}/fallback")
    public void setFallback(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable String featureKey, @RequestBody Map<String, Object> body) {
        service.setUnconfiguredFree(principal.userId(), featureKey,
                Boolean.TRUE.equals(body.get("unconfiguredFree")),
                uuid(body.get("countryId")), uuid(body.get("communityId")));
    }

    @PostMapping("/usage/{usageRecordId}/reverse")
    public void reverse(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID usageRecordId, @RequestBody Map<String, Object> body) {
        service.reverse(principal.userId(), usageRecordId, (String) body.get("reason"));
    }

    private static Long longValue(Object value) {
        return value == null ? null : Long.valueOf(value.toString());
    }

    private static UUID uuid(Object value) {
        return value == null || value.toString().isBlank() ? null : UUID.fromString(value.toString());
    }
}
