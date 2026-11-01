package com.diasporum.backend.community.internal.api.rest;

import com.diasporum.backend.community.CommunityApi.MembershipView;
import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.identity.IdentityApi;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Community membership + active-context endpoints. The actor is always the
 * JWT-resolved internal profile; path ids are targets only.
 * Catalogue browsing stays under {@code /api/v1/taxonomy/communities}.
 */
@RestController
@RequestMapping("/api/v1")
public class CommunityController {

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    private final IdentityApi identity;
    private final CommunityService service;

    public CommunityController(IdentityApi identity, CommunityService service) {
        this.identity = identity;
        this.service = service;
    }

    private UUID me(DiasporumUserPrincipal principal) {
        return identity.findByExternalId("https://accounts.google.com", principal.userId().toString())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "PROFILE_NOT_PROVISIONED"))
                .profileId();
    }

    private static int size(int s) {
        return s <= 0 ? DEFAULT_PAGE_SIZE : Math.min(s, MAX_PAGE_SIZE);
    }

    // ---- my context ----

    @GetMapping("/me/communities")
    public Map<String, Object> myCommunities(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return Map.of("items", service.membershipsOf(principal.userId()));
    }

    @GetMapping("/me/communities/available")
    public Map<String, Object> available(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        UUID me = principal.userId();
        return Map.of("items", service.availableCommunities(me));
    }

    @GetMapping("/me/communities/{communityId}")
    public MembershipView myMembership(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID communityId) {
        return service.membershipOf(principal.userId(), communityId).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "MEMBERSHIP_NOT_FOUND"));
    }

    @GetMapping("/me/active-community")
    public Map<String, Object> active(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        var out = new java.util.HashMap<String, Object>();
        out.put("communityId", service.activeCommunityId(principal.userId()).orElse(null));
        return out;
    }

    @PutMapping("/me/active-community")
    public Map<String, Object> setActive(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> body) {
        var raw = body.get("communityId");
        UUID id = raw == null ? null : UUID.fromString(raw.toString());
        service.setActiveCommunity(principal.userId(), id);
        return Map.of("communityId", id == null ? "" : id.toString());
    }

    // ---- onboarding: preview + complete ----

    /** Returns the community the user will automatically join, derived from
     * their origin + current country. Does NOT create membership. */
    @GetMapping("/me/community-preview")
    public Map<String, Object> communityPreview(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        var p = service.communityPreview(principal.userId());
        return Map.of(
                "community", p.community(),
                "originCountry", p.originCountry(),
                "destinationCountry", p.destinationCountry());
    }

    /** Completes onboarding: creates the auto-assigned membership and sets
     * default + active community. Idempotent. */
    @PostMapping("/me/onboarding/complete")
    public Map<String, Object> completeOnboarding(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        var r = service.completeOnboarding(principal.userId());
        return Map.of(
                "membership", r.membership(),
                "community", r.community());
    }

    // ---- membership lifecycle ----

    @PostMapping("/communities/{communityId}/join")
    public MembershipView join(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID communityId) {
        return service.join(principal.userId(), communityId);
    }

    @GetMapping("/communities/{communityId}/membership")
    public MembershipView membership(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID communityId) {
        return service.membershipOf(principal.userId(), communityId).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "MEMBERSHIP_NOT_FOUND"));
    }

    @DeleteMapping("/communities/{communityId}/membership")
    public void leave(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID communityId) {
        service.leave(principal.userId(), communityId);
    }

    // ---- members ----

    @GetMapping("/communities/{communityId}/members")
    public Map<String, Object> members(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID communityId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int s) {
        UUID me = principal.userId();
        var members = service.members(me, communityId, page, size(s));
        var hidden = service.hiddenMembers(me, members);
        var visible = members.stream()
                .filter(m -> !hidden.contains(m.userId())).toList();
        return Map.of("items", identity.profileSummaries(
                        visible.stream().map(MembershipView::userId).toList()),
                "total", service.activeMemberCount(communityId),
                "page", page, "size", size(s));
    }

    @GetMapping("/communities/{communityId}/members/{userId}")
    public MembershipView member(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID communityId, @PathVariable UUID userId) {
        if (!service.isActiveMember(principal.userId(), communityId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_A_MEMBER");
        }
        return service.membershipOf(userId, communityId).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "MEMBERSHIP_NOT_FOUND"));
    }

    // ---- admin ----

    @DeleteMapping("/communities/{communityId}/members/{userId}")
    public void removeMember(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID communityId, @PathVariable UUID userId) {
        service.removeMember(principal.userId(), communityId, userId);
    }

    @PostMapping("/communities/{communityId}/members/{userId}/role")
    public MembershipView changeRole(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID communityId, @PathVariable UUID userId,
            @RequestBody Map<String, Object> body) {
        var role = body.get("role");
        if (role == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ROLE_REQUIRED");
        }
        return service.changeRole(principal.userId(), communityId, userId, role.toString());
    }
}
