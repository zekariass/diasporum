package com.diasporum.backend.social.internal.api.rest;

import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.social.SocialApi.RelationshipView;
import com.diasporum.backend.social.internal.application.SocialService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Social relationship endpoints. Acting user always comes from the JWT's
 * (issuer,subject) via {@link IdentityApi}; the path id is only the target.
 */
@RestController
@RequestMapping("/api/v1/social")
public class SocialController {

    private final IdentityApi identity;
    private final SocialService social;

    public SocialController(IdentityApi identity, SocialService social) {
        this.identity = identity;
        this.social = social;
    }

    private static Map<String, Object> list(List<UUID> ids, int page, int size) {
        return Map.of("items", ids, "page", page, "size", size);
    }

    /** Relationship lists return profile summaries + total via IdentityApi — one batch query. */
    private Map<String, Object> profilesPage(List<UUID> ids, int total,
            int page, int size) {
        return Map.of("items", identity.profileSummaries(ids), "total", total,
                "page", page, "size", size);
    }

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    private static int size(int s) {
        return s <= 0 ? DEFAULT_PAGE_SIZE : Math.min(s, MAX_PAGE_SIZE);
    }

    // follows
    @PostMapping("/follows/{t}")
    public Map<String, Object> follow(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable("t") UUID t) {
        social.follow(principal.userId(), t);
        return Map.of("following", true);
    }

    @DeleteMapping("/follows/{t}")
    public void unfollow(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable("t") UUID t) {
        social.unfollow(principal.userId(), t);
    }

    @GetMapping("/followers")
    public Map<String, Object> followers(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int s) {
        UUID me = principal.userId();
        return profilesPage(social.followers(me, page, size(s)),
                social.followerCount(me), page, size(s));
    }

    @GetMapping("/following")
    public Map<String, Object> following(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int s) {
        UUID me = principal.userId();
        return profilesPage(social.following(me, page, size(s)),
                social.followingCount(me), page, size(s));
    }

    // friends
    @PostMapping("/friends/{t}")
    public Map<String, Object> addFriend(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable("t") UUID t) {
        social.addFriend(principal.userId(), t);
        return Map.of("friends", true);
    }

    @DeleteMapping("/friends/{t}")
    public void removeFriend(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable("t") UUID t) {
        social.removeFriend(principal.userId(), t);
    }

    @GetMapping("/friends")
    public Map<String, Object> friends(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int s) {
        UUID me = principal.userId();
        return profilesPage(social.friends(me, page, size(s)),
                social.friendCount(me), page, size(s));
    }

    // blocks
    @PostMapping("/blocks/{t}")
    public Map<String, Object> block(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable("t") UUID t) {
        social.block(principal.userId(), t);
        return Map.of("blocked", true);
    }

    @DeleteMapping("/blocks/{t}")
    public void unblock(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable("t") UUID t) {
        social.unblock(principal.userId(), t);
    }

    @GetMapping("/blocks")
    public Map<String, Object> blocked(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int s) {
        return list(social.blocked(principal.userId(), page, size(s)), page, size(s));
    }

    /** Parent-authorized avatar URL for another user's profile photo —
     * enforces blocks; generic /media download URLs are owner-scoped. */
    @GetMapping("/profiles/{t}/avatar/download-url")
    public Map<String, String> avatarDownloadUrl(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable("t") UUID t) {
        return Map.of("downloadUrl", social.avatarDownloadUrl(principal.userId(), t));
    }

    // relationship
    @GetMapping("/relationship/{t}")
    public RelationshipView relationship(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable("t") UUID t) {
        return social.relationship(principal.userId(), t);
    }
}
