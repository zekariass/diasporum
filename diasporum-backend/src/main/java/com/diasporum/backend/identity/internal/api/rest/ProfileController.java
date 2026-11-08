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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;
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

    public record CompatibilityRequest(@NotNull @Size(max = 30) List<@NotNull UUID> interestIds,
            @NotNull @Size(max = 30) List<@NotNull UUID> languageIds) {}
    public record DiscoveryLocationRequest(@NotNull Double latitude, @NotNull Double longitude,
            @NotNull Boolean consent) {}
    public record AgeConfirmationRequest(@NotNull Boolean confirmed) {}

    @GetMapping("/me/profile/compatibility")
    public ProfileService.CompatibilityView compatibility(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return profileService.compatibility(principal.userId());
    }

    @PutMapping("/me/profile/compatibility")
    public ProfileService.CompatibilityView compatibility(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody CompatibilityRequest request) {
        return profileService.replaceCompatibility(principal.userId(), request.interestIds(), request.languageIds());
    }

    @PutMapping("/me/profile/discovery-location")
    public Map<String, Boolean> discoveryLocation(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody DiscoveryLocationRequest request) {
        profileService.saveDiscoveryLocation(principal.userId(), request.latitude(), request.longitude(), request.consent());
        return Map.of("hasDiscoveryLocation", true);
    }

    @DeleteMapping("/me/profile/discovery-location")
    public Map<String, Boolean> removeDiscoveryLocation(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        profileService.removeDiscoveryLocation(principal.userId());
        return Map.of("hasDiscoveryLocation", false);
    }

    @PostMapping("/me/profile/age-confirmation")
    public Map<String, Boolean> confirmAge(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody AgeConfirmationRequest request) {
        if (!Boolean.TRUE.equals(request.confirmed())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "AGE_CONFIRMATION_REQUIRED");
        }
        profileService.confirmAgeEligibility(principal.userId());
        return Map.of("confirmed", true);
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
