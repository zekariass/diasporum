package com.diasporum.backend.feed;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Public API of the feed module: post metadata, visibility checks, and
 * engagement counts for other modules. Never {@code feed.internal.*}.
 * Feed owns posts/reels/help/polls; external categories (events, jobs, etc.)
 * are referenced by their source modules — not duplicated here.
 */
public interface FeedApi {

    /** Public-safe post view — no internals. */
    Optional<PostView> post(UUID postId);

    List<PostView> posts(java.util.Collection<UUID> postIds);

    /** True if {@code viewer} may see the post (exists, published, visible,
     * not blocked/muted by viewer's relationship). */
    boolean canView(UUID viewerId, UUID postId);

    int commentCount(UUID postId);

    int reactionCount(UUID postId);

    record PostView(UUID id, UUID authorId, UUID communityId, UUID countryId,
            String postType, String status, String visibilityScope,
            String title, java.time.Instant publishedAt) {
    }
}
