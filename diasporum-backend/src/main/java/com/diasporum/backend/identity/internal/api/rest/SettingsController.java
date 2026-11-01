package com.diasporum.backend.identity.internal.api.rest;


import com.diasporum.backend.identity.internal.application.SettingsService;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Own-user settings/privacy endpoints — same whitelist PATCH pattern as profiles. */
@RestController
@RequestMapping("/api/v1")
public class SettingsController {

    private static final Set<String> SETTINGS_KEYS = Set.of(
            "theme", "preferredLanguageCode", "activeCommunityId", "defaultCommunityId");
    private static final Set<String> PRIVACY_KEYS = Set.of(
            "profileDiscoverable", "showProfileToCommunity", "showCity",
            "showOnlineStatus", "allowFollowers", "allowMessageRequests",
            "dmPermission", "allowPeopleSuggestions", "allowMatchmakingDiscovery");
    private final SettingsService settingsService;
    private final ObjectMapper objectMapper;
    private final Validator validator;

    public SettingsController(
            SettingsService settingsService, ObjectMapper objectMapper,
            Validator validator) {
        this.settingsService = settingsService;
        this.objectMapper = objectMapper;
        this.validator = validator;
    }

    private java.util.UUID profileId(DiasporumUserPrincipal principal) {
        return principal.userId();
    }

    @GetMapping("/me/settings")
    public SettingsResponse settings(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return settingsService.getSettings(profileId(principal));
    }

    @PatchMapping("/me/settings")
    public SettingsResponse updateSettings(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> body) {
        rejectUnknown(body, SETTINGS_KEYS);
        UpdateSettingsRequest req = PatchBodies.convert(objectMapper, body,
                UpdateSettingsRequest.class);
        validate(req);
        return settingsService.updateSettings(profileId(principal), req);
    }

    @GetMapping("/me/privacy-settings")
    public PrivacySettingsResponse privacySettings(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return settingsService.getPrivacySettings(profileId(principal));
    }

    @PatchMapping("/me/privacy-settings")
    public PrivacySettingsResponse updatePrivacySettings(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> body) {
        rejectUnknown(body, PRIVACY_KEYS);
        UpdatePrivacySettingsRequest req = PatchBodies.convert(objectMapper, body,
                UpdatePrivacySettingsRequest.class);
        validate(req);
        return settingsService.updatePrivacySettings(profileId(principal), req);
    }

    private void rejectUnknown(Map<String, Object> body, Set<String> allowed) {
        List<String> bad = body.keySet().stream().filter(k -> !allowed.contains(k)).toList();
        if (!bad.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "PROTECTED_OR_UNKNOWN_FIELD:" + bad.get(0));
        }
    }

    private <T> void validate(T req) {
        Set<ConstraintViolation<T>> v = validator.validate(req);
        if (!v.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "VALIDATION_FAILED:" + v.iterator().next().getPropertyPath());
        }
    }
}
