package com.diasporum.backend.community.internal.api.rest;

import com.diasporum.backend.community.internal.application.CommunityAccessAdminService;
import com.diasporum.backend.community.internal.application.CommunityAccessAdminService.ModuleFlagView;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Platform-admin access configuration; no mobile/client authorization authority. */
@RestController
@RequestMapping("/api/v1/admin/community-access")
public class CommunityAccessAdminController {

    private final CommunityAccessAdminService service;

    public CommunityAccessAdminController(CommunityAccessAdminService service) {
        this.service = service;
    }

    @GetMapping("/modules")
    public List<ModuleFlagView> flags(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID countryId,
            @RequestParam(required = false) UUID communityId) {
        return service.flags(principal.userId(), countryId, communityId);
    }

    @PutMapping("/modules/{moduleKey}")
    public ModuleFlagView setModule(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable String moduleKey, @RequestBody Map<String, Object> body) {
        return service.setModule(principal.userId(), moduleKey,
                Boolean.TRUE.equals(body.get("enabled")), uuid(body.get("countryId")),
                uuid(body.get("communityId")));
    }

    @PatchMapping("/communities/{communityId}")
    public void setCommunityActive(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID communityId, @RequestBody Map<String, Object> body) {
        service.setCommunityActive(principal.userId(), communityId,
                Boolean.TRUE.equals(body.get("active")));
    }

    private static UUID uuid(Object value) {
        return value == null || value.toString().isBlank() ? null : UUID.fromString(value.toString());
    }
}
