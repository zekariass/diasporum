package com.diasporum.backend.identity.internal.api.rest;


import com.diasporum.backend.identity.internal.application.ProfileService;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Own-profile management endpoints. The profile is always resolved from the
 * authenticated JWT's {@code (issuer, subject)} — never from client input.
 *
 * <p>PATCH accepts a whitelist of fields only; any other key (id,
 * accountStatus, trustScore, profileCompletedAt, ...) is rejected — Boot's
 * Jackson mapper tolerates unknown properties by default, so the check is
 * explicit.
 */
@RestController
@RequestMapping("/api/v1")
public class ProfileController {

    private static final Set<String> PATCHABLE = Set.of(
            "username", "displayName", "bio", "city",
            "dateOfBirth", "originCountryId", "currentCountryId",
            "avatarMediaId");
    private final ProfileService profileService;
    private final ObjectMapper objectMapper;
    private final Validator validator;
    private final com.diasporum.backend.taxonomy.TaxonomyApi taxonomy;

    public ProfileController(
            ProfileService profileService, ObjectMapper objectMapper,
            Validator validator,
            com.diasporum.backend.taxonomy.TaxonomyApi taxonomy) {
        this.profileService = profileService;
        this.objectMapper = objectMapper;
        this.validator = validator;
        this.taxonomy = taxonomy;
    }

    private java.util.UUID profileId(DiasporumUserPrincipal principal) {
        return principal.userId();
    }

    private static ProfileResponse toResponse(ProfileService.ProfileView p) {
        return new ProfileResponse(p.id(), p.username(), p.displayName(), p.bio(),
                p.city(), p.dateOfBirth(), p.originCountryId(), p.currentCountryId(),
                p.accountStatus(), p.profileCompleted(), p.avatarMediaId());
    }

    @GetMapping("/me/profile")
    public ProfileResponse profile(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return toResponse(profileService.getProfile(profileId(principal)));
    }

    @PatchMapping("/me/profile")
    public ProfileResponse updateProfile(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> body) {
        List<String> rejected = body.keySet().stream()
                .filter(k -> !PATCHABLE.contains(k)).toList();
        if (!rejected.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "PROTECTED_OR_UNKNOWN_FIELD:" + rejected.get(0));
        }
        UpdateProfileRequest req = PatchBodies.convert(objectMapper, body,
                UpdateProfileRequest.class);
        Set<ConstraintViolation<UpdateProfileRequest>> violations =
                validator.validate(req);
        if (!violations.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "VALIDATION_FAILED:"
                            + violations.iterator().next().getPropertyPath());
        }
        return toResponse(profileService.updateProfile(profileId(principal), req));
    }

    @GetMapping("/me/profile/completion")
    public Map<String, Object> completion(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return profileService.completion(profileId(principal));
    }

    @GetMapping("/usernames/availability")
    public Map<String, Object> usernameAvailability(
            @RequestParam String username) {
        return profileService.usernameAvailability(username);
    }

    @GetMapping("/countries")
    public List<com.diasporum.backend.taxonomy.TaxonomyApi.CountryView> countries() {
        return taxonomy.activeCountries();
    }
}
