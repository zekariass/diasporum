package com.diasporum.backend.matchmaking.internal.api.rest;

import com.diasporum.backend.matchmaking.internal.application.CancelLikeService;
import com.diasporum.backend.matchmaking.internal.application.DiscoveryService;
import com.diasporum.backend.matchmaking.internal.application.MatchService;
import com.diasporum.backend.matchmaking.internal.application.MatchmakingProfileService;
import com.diasporum.backend.matchmaking.internal.application.PreferenceService;
import com.diasporum.backend.matchmaking.internal.application.RecordSwipeService;
import com.diasporum.backend.matchmaking.internal.application.ReferenceDataService;
import com.diasporum.backend.matchmaking.internal.application.RewindSwipeService;
import com.diasporum.backend.matchmaking.internal.application.UnmatchService;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.Page;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PreferenceCommand;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PreferenceView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfileCommand;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfileView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PublicProfileView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ReferenceDataView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.SwipeResult;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Versioned Matchmaking API. The authenticated principal is the only actor source. */
@RestController
@RequestMapping("/api/v1/matchmaking")
public class MatchmakingController {

    private final MatchmakingProfileService profiles;
    private final PreferenceService preferences;
    private final DiscoveryService discovery;
    private final RecordSwipeService swipes;
    private final CancelLikeService cancelLikes;
    private final RewindSwipeService rewinds;
    private final MatchService matches;
    private final UnmatchService unmatches;
    private final ReferenceDataService referenceData;

    public MatchmakingController(MatchmakingProfileService profiles,
            PreferenceService preferences, DiscoveryService discovery,
            RecordSwipeService swipes, CancelLikeService cancelLikes,
            RewindSwipeService rewinds, MatchService matches, UnmatchService unmatches,
            ReferenceDataService referenceData) {
        this.profiles = profiles;
        this.preferences = preferences;
        this.discovery = discovery;
        this.swipes = swipes;
        this.cancelLikes = cancelLikes;
        this.rewinds = rewinds;
        this.matches = matches;
        this.unmatches = unmatches;
        this.referenceData = referenceData;
    }

    public record ProfileRequest(@NotBlank String genderKey, UUID addressId,
            UUID nationalityCountryId, UUID religionId, String educationLevel,
            @Size(max = 160) String occupation, String relationshipIntention, String maritalStatus,
            Boolean hasChildren, String wantsChildren, String smoking, String drinking,
            String activityLevel, @Min(80) @Max(250) Integer heightCm, String marriageTimeline,
            Boolean longDistanceRelationship, String religionImportance, Boolean willingToRelocate,
            UUID photoMediaId, UUID blurredPhotoMediaId, @NotBlank String nameVisibility,
            @NotBlank String photoVisibility, @NotBlank @Size(max = 80) String anonymousAlias,
            @NotBlank String status) {
    }

    public record PreferenceRequest(@NotNull @Min(18) @Max(110) Integer minAge,
            @NotNull @Min(18) @Max(110) Integer maxAge,
            @Min(1) @Max(20000) Integer maxDistanceKm, @NotNull Boolean showVerifiedOnly,
            @NotBlank String hasChildrenPreference, @NotBlank String wantsChildrenPreference,
            @NotNull List<@NotBlank String> genderKeys,
            @NotNull List<@NotNull UUID> religionIds,
            @NotNull List<@NotNull UUID> languageIds) {
    }

    public record SwipeRequest(@NotNull UUID targetUserId, @NotBlank String action) {
    }

    public record UnmatchRequest(@Size(max = 500) String reason) {
    }

    public record ReportRequest(@NotBlank String reason, @Size(max = 4000) String details) {
    }

    @GetMapping("/reference-data")
    public ReferenceDataView referenceData(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return referenceData.referenceData(principal.userId());
    }

    @GetMapping("/profile")
    public ProfileView profile(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return profiles.profile(principal.userId());
    }

    @PutMapping("/profile")
    public ProfileView saveProfile(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody ProfileRequest request) {
        return profiles.save(principal.userId(), new ProfileCommand(request.genderKey(),
                request.addressId(), request.nationalityCountryId(), request.religionId(),
                request.educationLevel(), request.occupation(), request.relationshipIntention(),
                request.maritalStatus(), request.hasChildren(), request.wantsChildren(),
                request.smoking(), request.drinking(), request.activityLevel(), request.heightCm(),
                request.marriageTimeline(), request.longDistanceRelationship(),
                request.religionImportance(), request.willingToRelocate(), request.photoMediaId(),
                request.blurredPhotoMediaId(), request.nameVisibility(), request.photoVisibility(),
                request.anonymousAlias(), request.status()));
    }

    @DeleteMapping("/profile")
    public ResponseEntity<Void> deleteProfile(
            @AuthenticationPrincipal DiasporumUserPrincipal principal) {
        profiles.delete(principal.userId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/preferences")
    public PreferenceView preferences(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return preferences.preferences(principal.userId());
    }

    @PutMapping("/preferences")
    public PreferenceView savePreferences(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody PreferenceRequest request) {
        return preferences.replace(principal.userId(), new PreferenceCommand(request.minAge(),
                request.maxAge(), request.maxDistanceKm(), request.showVerifiedOnly(),
                request.hasChildrenPreference(), request.wantsChildrenPreference(),
                request.genderKeys(), request.religionIds(), request.languageIds()));
    }

    @GetMapping("/discover")
    public Page<PublicProfileView> discover(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit) {
        return discovery.discover(principal.userId(), cursor, limit);
    }

    @GetMapping("/profiles/{targetUserId}")
    public PublicProfileView candidate(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID targetUserId) {
        return discovery.profile(principal.userId(), targetUserId);
    }

    @PostMapping("/swipes")
    public SwipeResult swipe(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody SwipeRequest request) {
        return swipes.record(principal.userId(), request.targetUserId(), request.action());
    }

    @DeleteMapping("/likes/{targetUserId}")
    public SwipeResult cancelLike(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID targetUserId) {
        return cancelLikes.cancel(principal.userId(), targetUserId);
    }

    @PostMapping("/rewind")
    public SwipeResult rewind(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return rewinds.rewind(principal.userId());
    }

    @GetMapping("/likes/received")
    public Page<PublicProfileView> receivedLikes(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit) {
        return discovery.receivedLikes(principal.userId(), cursor, limit);
    }

    @GetMapping("/matches")
    public Page<MatchView> matches(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit) {
        return matches.matches(principal.userId(), cursor, limit);
    }

    @GetMapping("/matches/{matchId}")
    public MatchView match(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID matchId) {
        return matches.detail(principal.userId(), matchId);
    }

    @PostMapping("/matches/{matchId}/report")
    public ResponseEntity<Map<String, UUID>> report(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID matchId, @Valid @RequestBody ReportRequest request) {
        UUID id = matches.report(principal.userId(), matchId, request.reason(), request.details());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id));
    }

    @PostMapping("/matches/{matchId}/unmatch")
    public MatchView unmatch(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID matchId, @Valid @RequestBody(required = false) UnmatchRequest request) {
        return unmatches.unmatch(principal.userId(), matchId,
                request == null ? null : request.reason());
    }
}
