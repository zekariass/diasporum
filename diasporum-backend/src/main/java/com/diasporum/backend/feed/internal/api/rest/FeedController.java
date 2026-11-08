package com.diasporum.backend.feed.internal.api.rest;

import com.diasporum.backend.feed.internal.application.FeedPublicationService;
import com.diasporum.backend.feed.internal.application.FeedService;
import com.diasporum.backend.feed.internal.application.FeedService.CommentPage;
import com.diasporum.backend.feed.internal.application.FeedService.CommentRow;
import com.diasporum.backend.feed.internal.application.FeedService.FeedPage;
import com.diasporum.backend.feed.internal.application.FeedService.PostRow;
import com.diasporum.backend.feed.internal.api.rest.PollRequests.CreatePollRequest;
import com.diasporum.backend.feed.internal.api.rest.PollRequests.ReportPostRequest;
import com.diasporum.backend.feed.internal.api.rest.PollRequests.UpdatePollRequest;
import com.diasporum.backend.feed.internal.api.rest.PollRequests.VoteRequest;
import com.diasporum.backend.feed.internal.api.rest.PollResponses.PollResponse;
import com.diasporum.backend.feed.internal.api.rest.PollResponses.ReportResponse;
import com.diasporum.backend.identity.IdentityApi;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.type.TypeReference;

/** Feed endpoints — actor always resolved from the JWT. */
@RestController
@RequestMapping("/api/v1/feed")
public class FeedController {

    private final IdentityApi identity;
    private final FeedService service;
    private final FeedPublicationService publications;

    public FeedController(IdentityApi identity, FeedService service,
            FeedPublicationService publications) {
        this.identity = identity;
        this.service = service;
        this.publications = publications;
    }

    private UUID me(DiasporumUserPrincipal principal) {
        return identity.findByExternalId("https://accounts.google.com", principal.userId().toString())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "PROFILE_NOT_PROVISIONED"))
                .profileId();
    }

    private static List<UUID> uuids(Map<String, Object> body, String key) {
        var raw = body.get(key);
        return raw instanceof List<?> l
                ? l.stream().map(o -> UUID.fromString(o.toString())).toList()
                : List.of();
    }

    /** Optional UUID field — null when absent or blank. */
    private static UUID uuid(Map<String, Object> body, String key) {
        var raw = body.get(key);
        return raw == null || raw.toString().isBlank()
                ? null : UUID.fromString(raw.toString());
    }

    /** Optional string list — null when absent (distinguishes "not sent" from []). */
    private static List<String> strings(Map<String, Object> body, String key) {
        var raw = body.get(key);
        return raw instanceof List<?> l
                ? l.stream().map(String::valueOf).toList()
                : null;
    }

    // ---- posts ----

    @PostMapping("/posts")
    public PostRow create(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> b) {
        return publications.execute(principal.userId(), "feed-post-create", b,
                new TypeReference<PostRow>() { }, () -> service.createPost(
                        principal.userId(), UUID.fromString((String) b.get("communityId")),
                        (String) b.get("postType"), (String) b.get("title"),
                        (String) b.get("body"), (String) b.get("linkUrl"),
                        (String) b.getOrDefault("visibilityScope", "COMMUNITY"),
                        uuid(b, "categoryId"), uuids(b, "mediaIds"), strings(b, "tags")));
    }

    @GetMapping("/posts/{postId}")
    public FeedService.PostDetail post(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID postId) {
        return service.postDetail(principal.userId(), postId);      // viewable-enforced
    }

    @PatchMapping("/posts/{postId}")
    public PostRow update(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID postId,
            @RequestBody Map<String, Object> b) {
        return service.updatePost(principal.userId(), postId, (String) b.get("title"),
                (String) b.get("body"), (String) b.get("linkUrl"),
                uuid(b, "categoryId"), strings(b, "tags"));
    }

    @DeleteMapping("/posts/{postId}")
    public void delete(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID postId) {
        service.deletePost(principal.userId(), postId);
    }

    @PostMapping("/posts/{postId}/reports")
    @ResponseStatus(HttpStatus.CREATED)
    public ReportResponse report(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID postId, @Valid @RequestBody ReportPostRequest request) {
        return new ReportResponse(service.reportPost(principal.userId(), postId,
                request.reason(), request.details()));
    }

    // ---- feeds ----

    @GetMapping("/community")
    public FeedPage community(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam UUID communityId,
            @RequestParam(defaultValue = "FOR_YOU") String mode,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) String tag,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return service.communityFeed(principal.userId(), communityId, mode,
                categoryId, tag, cursor, size);
    }

    // ---- hashtags ----

    /** Prefix suggestions for composer autocomplete. */
    @GetMapping("/tags/suggest")
    public List<FeedService.TagView> suggestTags(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam String q,
            @RequestParam(defaultValue = "10") int size) {
        principal.userId();                          // authenticated
        return service.suggestTags(q, size);
    }

    /** Community-scoped hashtag feed — same rules as the community feed. */
    @GetMapping("/tags/{tagKey}/posts")
    public FeedPage tagFeed(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable String tagKey,
            @RequestParam UUID communityId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return service.tagFeed(principal.userId(), communityId, tagKey, cursor,
                size);
    }

    /** Parent-authorized short-lived URL for media attached to a feed post. */
    @PostMapping("/media/{mediaId}/download-url")
    public Map<String, String> feedMediaDownloadUrl(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID mediaId) {
        return Map.of("downloadUrl",
                service.mediaDownloadUrl(principal.userId(), mediaId));
    }

    @GetMapping("/following")
    public FeedPage following(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return service.followingFeed(principal.userId(), cursor, size);
    }

    /** Own posts — profile Posts/Polls/Media tabs + post count. */
    @GetMapping("/mine")
    public FeedService.MinePage mine(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String postType,
            @RequestParam(defaultValue = "false") boolean hasMedia,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return service.myPosts(principal.userId(), postType, hasMedia,
                cursor, size);
    }

    @GetMapping("/reels/community")
    public FeedPage reels(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam UUID communityId,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return service.reelsFeed(principal.userId(), communityId, "community", cursor, size);
    }

    // ---- engagement ----

    @PutMapping("/posts/{postId}/reaction")
    public void react(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID postId,
            @RequestBody Map<String, Object> b) {
        service.react(principal.userId(), postId, (String) b.get("reaction"));
    }

    @DeleteMapping("/posts/{postId}/reaction")
    public void unreact(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID postId) {
        service.unreact(principal.userId(), postId);
    }

    @PutMapping("/posts/{postId}/save")
    public void save(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID postId) {
        service.save(principal.userId(), postId);
    }

    @DeleteMapping("/posts/{postId}/save")
    public void unsave(@AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID postId) {
        service.unsave(principal.userId(), postId);
    }

    /** Record a share event (post_shares row); returns the updated share_count. */
    @PostMapping("/posts/{postId}/share")
    public Map<String, Object> share(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID postId,
            @RequestBody(required = false) Map<String, Object> b) {
        return Map.of("shareCount",
                service.share(principal.userId(), postId,
                        b == null ? null : (String) b.get("target")));
    }

    @PostMapping("/views")
    public void recordView(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> b) {
        service.recordView(principal.userId(), (String) b.get("contentType"),
                UUID.fromString((String) b.get("contentId")));
    }

    // ---- comments ----

    @PostMapping("/posts/{postId}/comments")
    public CommentRow comment(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID postId, @RequestBody Map<String, Object> b) {
        var parent = b.get("parentCommentId");
        return service.comment(principal.userId(), postId,
                parent == null ? null : UUID.fromString(parent.toString()),
                (String) b.get("body"));
    }

    @GetMapping("/posts/{postId}/comments")
    public CommentPage comments(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID postId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return service.comments(principal.userId(), postId, page, size);
    }

    @PatchMapping("/comments/{commentId}")
    public CommentRow updateComment(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID commentId, @RequestBody Map<String, Object> b) {
        return service.updateComment(principal.userId(), commentId, (String) b.get("body"));
    }

    @DeleteMapping("/comments/{commentId}")
    public void deleteComment(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID commentId) {
        service.deleteComment(principal.userId(), commentId);
    }

    // ---- community help ----

    @PostMapping("/community-help")
    public Map<String, Object> createHelp(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestBody Map<String, Object> b) {
        return publications.execute(principal.userId(), "feed-help-create", b,
                new TypeReference<Map<String, Object>>() { }, () -> service.createHelpPost(
                        principal.userId(), UUID.fromString((String) b.get("communityId")),
                        uuid(b, "categoryId"), (String) b.get("helpKind"),
                        (String) b.get("title"), (String) b.get("body"),
                        b.get("expiresAt") == null ? null
                                : Instant.parse(b.get("expiresAt").toString()),
                        uuids(b, "mediaIds"), strings(b, "tags")));
    }

    @PatchMapping("/community-help/{postId}/status")
    public Map<String, Object> helpStatus(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID postId, @RequestBody Map<String, Object> b) {
        return service.setHelpStatus(principal.userId(), postId, (String) b.get("helpStatus"));
    }

    // ---- author resolution ----

    /** Batch profile summaries for post/comment author IDs — one call per page. */
    @GetMapping("/authors")
    public List<IdentityApi.ProfileSummary> authors(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam List<UUID> ids) {
        principal.userId(); // authenticated check — profileSummaries is already public-safe
        return identity.profileSummaries(ids);
    }

    // ---- polls ----

    @PostMapping("/polls")
    @ResponseStatus(HttpStatus.CREATED)
    public PollResponse createPoll(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody CreatePollRequest request) {
        return service.createPoll(principal.userId(), request.communityId(),
                request.categoryId(), request.question(), request.options(),
                request.maxOptions(), request.closesAt(), request.allowMultiple(),
                request.allowVoteChange(), request.allowVoteWithdraw(),
                request.anonymousVoting(), request.resultsVisibility().name());
    }

    @GetMapping("/polls/{postId}")
    public PollResponse poll(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID postId) {
        return service.poll(postId, principal.userId());
    }

    @PatchMapping("/polls/{postId}")
    public PollResponse updatePoll(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID postId, @Valid @RequestBody UpdatePollRequest request) {
        return service.updatePoll(principal.userId(), postId, request.question(),
                request.options(), request.maxOptions(), request.closesAt(),
                request.allowMultiple(), request.allowVoteChange(),
                request.allowVoteWithdraw(), request.anonymousVoting(),
                request.resultsVisibility() == null ? null
                        : request.resultsVisibility().name());
    }

    @PostMapping("/polls/options/{optionId}/vote")
    public PollResponse vote(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID optionId,
            @RequestBody(required = false) VoteRequest request) {
        return service.vote(principal.userId(), optionId,
                request != null && request.withdraw());
    }

    @PostMapping("/polls/{postId}/close")
    public PollResponse closePoll(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID postId) {
        return service.closePoll(principal.userId(), postId);
    }
}
