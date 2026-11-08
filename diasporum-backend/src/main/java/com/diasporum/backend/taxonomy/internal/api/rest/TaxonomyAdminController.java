package com.diasporum.backend.taxonomy.internal.api.rest;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.taxonomy.internal.application.TaxonomyAdminService;
import com.diasporum.backend.taxonomy.internal.application.TaxonomyAdminService.CategoryAdminView;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Platform-admin management of destination-country practical categories.
 * All endpoints are guarded by PLATFORM_ADMIN inside the service.
 */
@RestController
@RequestMapping("/api/v1/admin/taxonomy/categories")
public class TaxonomyAdminController {

    private final TaxonomyAdminService service;

    public TaxonomyAdminController(TaxonomyAdminService service) {
        this.service = service;
    }

    private static List<String> strings(Map<String, Object> body, String key) {
        var raw = body.get(key);
        return raw instanceof List<?> l
                ? l.stream().map(String::valueOf).toList()
                : null;
    }

    private static Integer integer(Map<String, Object> body, String key) {
        var raw = body.get(key);
        return raw == null ? null : Integer.valueOf(raw.toString());
    }

    @GetMapping
    public List<CategoryAdminView> list(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam UUID countryId) {
        service.requireGlobalAdmin(principal.userId());
        return service.list(countryId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CategoryAdminView create(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> b) {
        return service.create(principal.userId(),
                UUID.fromString((String) b.get("countryId")),
                (String) b.get("name"), (String) b.get("slug"),
                (String) b.get("description"), (String) b.get("colorToken"),
                (String) b.get("iconKey"), integer(b, "sortOrder"),
                strings(b, "modules"));
    }

    @PatchMapping("/{id}")
    public CategoryAdminView update(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID id, @RequestBody Map<String, Object> b) {
        return service.update(principal.userId(), id, (String) b.get("name"),
                (String) b.get("slug"), (String) b.get("description"),
                (String) b.get("colorToken"), (String) b.get("iconKey"),
                integer(b, "sortOrder"), (Boolean) b.get("active"),
                strings(b, "modules"));
    }

    @PostMapping("/{id}/active")
    public CategoryAdminView setActive(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID id, @RequestBody Map<String, Object> b) {
        return service.setActive(principal.userId(), id,
                Boolean.TRUE.equals(b.get("active")));
    }
}
