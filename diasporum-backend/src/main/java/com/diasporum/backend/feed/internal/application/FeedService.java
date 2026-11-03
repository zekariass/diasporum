package com.diasporum.backend.feed.internal.application;

import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.feed.internal.api.rest.PollResponses.PollOptionResponse;
import com.diasporum.backend.feed.internal.api.rest.PollResponses.PollResponse;
import com.diasporum.backend.feed.internal.api.rest.PollResponses.ResultsVisibility;
import com.diasporum.backend.feed.internal.domain.PollRules;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.moderation.ModerationApi;
import com.diasporum.backend.social.SocialApi;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Feed core: post lifecycle (GENERAL/ANNOUNCEMENT/REEL/COMMUNITY_HELP/POLL +
 * remaining feed_posts types), comments, reactions, saves, view tracking and
 * unified feed composition. External content categories stay with their
 * source modules — the feed item id is an opaque {@code TYPE:uuid} reference.
 */
@Service
public class FeedService {

    private static final Set<String> POST_TYPES = Set.of("GENERAL", "ANNOUNCEMENT",
            "RECOMMENDATION", "RESOURCE", "WARNING", "OPPORTUNITY", "EVENT_NOTICE",
            "POLL", "REEL", "COMMUNITY_HELP");
    private static final Set<String> VISIBILITIES = Set.of("COMMUNITY", "COUNTRY");
    private static final Set<String> REACTIONS = Set.of("LIKE", "LOVE", "HELPFUL",
            "SUPPORT", "THANKS");
    private static final Set<String> HELP_KINDS = Set.of("REQUEST", "OFFER");
    private static final Set<String> OPEN_HELP_TRANSITIONS = Set.of("PAUSED",
            "RESOLVED", "CLOSED");
    private static final int DEFAULT_PAGE = 20;
    private static final int MAX_PAGE = 50;

    private final JdbcTemplate jdbc;
    private final IdentityApi identity;
    private final CommunityApi community;
    private final SocialApi social;
    private final MediaApi media;
    private final TaxonomyApi taxonomy;
    private final ModerationApi moderation;
    private final int pollCreatePerHour;
    private final int pollVotePerMinute;

    public FeedService(JdbcTemplate jdbc, IdentityApi identity,
            CommunityApi community, SocialApi social, MediaApi media,
            TaxonomyApi taxonomy, ModerationApi moderation,
            @Value("${diasporum.feed.polls.create-per-hour:10}") int pollCreatePerHour,
            @Value("${diasporum.feed.polls.vote-per-minute:120}") int pollVotePerMinute) {
        this.jdbc = jdbc;
        this.identity = identity;
        this.community = community;
        this.social = social;
        this.media = media;
        this.taxonomy = taxonomy;
        this.moderation = moderation;
        this.pollCreatePerHour = Math.max(1, pollCreatePerHour);
        this.pollVotePerMinute = Math.max(1, pollVotePerMinute);
    }

    // =================== row types ===================

    public record PostRow(UUID id, UUID authorId, UUID communityId,
            UUID countryId, String postType, String status, String scope,
            String title, String body, String linkUrl, UUID categoryId,
            boolean commentsEnabled,
            int commentCount, int reactionCount, Instant publishedAt,
            Instant createdAt) {
    }

    public record CommentRow(UUID id, UUID postId, UUID authorId,
            UUID parentId, String body, Instant createdAt) {
    }

    private static PostRow post(java.sql.ResultSet rs, int i)
            throws java.sql.SQLException {
        return new PostRow(rs.getObject("id", UUID.class),
                rs.getObject("author_id", UUID.class),
                rs.getObject("community_id", UUID.class),
                rs.getObject("country_id", UUID.class),
                rs.getString("post_type"), rs.getString("status"),
                rs.getString("visibility_scope"), rs.getString("title"),
                rs.getString("body"), rs.getString("link_url"),
                rs.getObject("category_id", UUID.class),
                rs.getBoolean("comments_enabled"),
                rs.getInt("comment_count"), rs.getInt("reaction_count"),
                ts(rs, "published_at"), ts(rs, "created_at"));
    }

    private static Instant ts(java.sql.ResultSet rs, String col)
            throws java.sql.SQLException {
        var t = rs.getTimestamp(col);
        return t == null ? null : t.toInstant();
    }

    private static final String POST_COLS = "id,author_id,community_id,country_id,"
            + "post_type,status::text,visibility_scope::text,title,body,link_url,"
            + "category_id,comments_enabled,comment_count,reaction_count,published_at,created_at";

    private PostRow requirePost(UUID id) {
        return jdbc.query("SELECT " + POST_COLS + " FROM feed_posts WHERE id=?",
                        FeedService::post, id).stream().findFirst()
                .filter(p -> !"DELETED".equals(p.status()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "POST_NOT_FOUND"));
    }

    private static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    private static ResponseStatusException forbidden(String code) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, code);
    }

    private static ResponseStatusException conflict(String code) {
        return new ResponseStatusException(HttpStatus.CONFLICT, code);
    }

    private static ResponseStatusException tooMany(String code) {
        return new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, code);
    }

    private static <T> T validated(Supplier<T> validation) {
        try {
            return validation.get();
        } catch (IllegalArgumentException e) {
            throw bad(e.getMessage());
        }
    }

    // =================== post lifecycle ===================

    @Transactional
    public PostRow createPost(UUID authorId, UUID communityId, String type,
            String title, String body, String linkUrl, String scope,
            UUID categoryId, List<UUID> mediaIds) {
        return createPost(authorId, communityId, type, title, body, linkUrl,
                scope, categoryId, mediaIds, false);
    }

    private PostRow createPost(UUID authorId, UUID communityId, String type,
            String title, String body, String linkUrl, String scope,
            UUID categoryId, List<UUID> mediaIds, boolean pollWorkflow) {
        if (!POST_TYPES.contains(type)) {
            throw bad("INVALID_POST_TYPE");
        }
        if ("POLL".equals(type) && !pollWorkflow) {
            throw bad("POLL_USE_POLL_ENDPOINT");
        }
        if (!VISIBILITIES.contains(scope)) {
            throw bad("INVALID_VISIBILITY");
        }
        if ("ANNOUNCEMENT".equals(type)
                && !community.isModeratorOrAbove(authorId, communityId)) {
            throw forbidden("MODERATOR_REQUIRED");
        }
        if (!community.isActiveMember(authorId, communityId)) {
            throw forbidden("NOT_A_MEMBER");
        }
        var c = taxonomy.findCommunityById(communityId).orElseThrow(
                () -> bad("COMMUNITY_NOT_FOUND"));
        if (categoryId == null || !taxonomy.isCategoryActiveInCountry(categoryId,
                c.destinationCountryId(),
                "COMMUNITY_HELP".equals(type) ? "COMMUNITY_HELP" : "FEED")) {
            throw bad("INVALID_CATEGORY");
        }
        if ("REEL".equals(type) && (mediaIds == null || mediaIds.isEmpty())) {
            throw bad("REEL_REQUIRES_VIDEO");
        }
        UUID id = UUID.randomUUID();
        // POLL/COMMUNITY_HELP must start DRAFT: the publish trigger requires
        // their child rows (options / help metadata) to already exist.
        boolean draftFirst = "POLL".equals(type) || "COMMUNITY_HELP".equals(type);
        jdbc.update("INSERT INTO feed_posts(id,country_id,community_id,"
                        + "visibility_scope,author_id,category_id,post_type,title,"
                        + "body,link_url,status,published_at) VALUES(?,?,?,?::"
                        + "visibility_scope,?,?,?,?,?,?,?::content_status,?)",
                id, c.destinationCountryId(), communityId, scope, authorId,
                categoryId, type, title, body == null ? "" : body, linkUrl,
                draftFirst ? "DRAFT" : "PUBLISHED",
                draftFirst ? null : java.sql.Timestamp.from(Instant.now()));
        attachMedia(id, authorId, type, mediaIds);
        return new PostRow(id, authorId, communityId, c.destinationCountryId(),
                type, draftFirst ? "DRAFT" : "PUBLISHED", scope, title, body,
                linkUrl, categoryId, true, 0, 0, draftFirst ? null : Instant.now(),
                Instant.now());
    }

    private void attachMedia(UUID postId, UUID ownerId, String postType,
            List<UUID> mediaIds) {
        if (mediaIds == null || mediaIds.isEmpty()) {
            return;
        }
        var seen = new java.util.HashSet<UUID>();
        int order = 0;
        for (UUID mid : mediaIds) {
            if (!seen.add(mid)) {
                continue;
            }
            var asset = media.asset(mid).orElseThrow(
                    () -> bad("MEDIA_NOT_FOUND"));
            if (!asset.ownerId().equals(ownerId)) {
                throw forbidden("MEDIA_NOT_OWNED");
            }
            if (!"READY".equals(asset.status())) {
                throw bad("MEDIA_NOT_READY");
            }
            boolean ok = "REEL".equals(postType)
                    ? "FEED_VIDEO".equals(asset.purpose())
                    : ("FEED_IMAGE".equals(asset.purpose())
                            || "FEED_VIDEO".equals(asset.purpose())
                            || "DOCUMENT".equals(asset.purpose()));
            if (!ok) {
                throw bad("MEDIA_WRONG_PURPOSE");
            }
            jdbc.update("INSERT INTO feed_post_media(post_id,media_id,sort_order)"
                    + " VALUES(?,?,?)", postId, mid, order++);
        }
    }

    public List<UUID> mediaIds(UUID postId) {
        return jdbc.queryForList("SELECT media_id FROM feed_post_media"
                + " WHERE post_id=? ORDER BY sort_order", UUID.class, postId);
    }

    @Transactional
    public PostRow updatePost(UUID actor, UUID postId, String title,
            String body, String linkUrl) {
        var p = requirePost(postId);
        if (!p.authorId().equals(actor)
                && !community.isModeratorOrAbove(actor, p.communityId())) {
            throw forbidden("NOT_AUTHOR");
        }
        String normalizedBody = body != null && "POLL".equals(p.postType())
                ? validated(() -> PollRules.question(body)) : body;
        jdbc.update("UPDATE feed_posts SET title=COALESCE(?,title),"
                + " body=COALESCE(?,body), link_url=COALESCE(?,link_url),"
                + " updated_at=now() WHERE id=?", title, normalizedBody, linkUrl, postId);
        return requirePost(postId);
    }

    @Transactional
    public void deletePost(UUID actor, UUID postId) {
        var p = requirePost(postId);
        if (!p.authorId().equals(actor)
                && !community.isModeratorOrAbove(actor, p.communityId())) {
            throw forbidden("NOT_AUTHOR");
        }
        jdbc.update("UPDATE feed_posts SET status='DELETED', deleted_at=now(),"
                + " updated_at=now() WHERE id=?", postId);
    }

    // =================== eligibility + feeds ===================

    /** Eligible = published + viewer not blocked with author + (scope
     * COUNTRY or viewer is member of post's community). */
    private boolean eligible(UUID viewer, PostRow p,
            Map<UUID, Boolean> membershipCache) {
        if (!"PUBLISHED".equals(p.status())) {
            return false;
        }
        if (!"COUNTRY".equals(p.scope())
                && !membershipCache.computeIfAbsent(p.communityId(),
                        c -> community.isActiveMember(viewer, c))) {
            return false;
        }
        return true;
    }

    public record FeedItem(String itemId, String contentType, String sourceModule,
            UUID sourceId, Object author, UUID communityId, Instant publishedAt,
            String title, String body, List<UUID> mediaIds, int commentCount,
            int reactionCount, String viewerReaction, boolean viewed,
            boolean saved, Map<String, Object> payload) {
    }

    private List<FeedItem> toItems(UUID viewer, List<PostRow> posts) {
        if (posts.isEmpty()) {
            return List.of();
        }
        var authorIds = posts.stream().map(p -> p.authorId()).toList();
        var hidden = social.blockedWith(viewer, authorIds);
        var postIds = posts.stream().map(p -> p.id()).toList();
        var postPh = String.join(",", java.util.Collections.nCopies(
                postIds.size(), "?::uuid"));
        var reactions = jdbc.query("SELECT post_id,reaction_key"
                        + " FROM feed_post_reactions WHERE user_id=? AND post_id IN ("
                        + postPh + ")",
                (rs, i) -> Map.of("p", rs.getObject(1, UUID.class),
                        "r", rs.getString(2)),
                concat(viewer, postIds));
        var viewed = new java.util.HashSet<>(jdbc.queryForList(
                "SELECT content_id FROM user_content_views WHERE user_id=?"
                        + " AND content_type='FEED_POST' AND content_id IN ("
                        + postPh + ")",
                UUID.class, concat(viewer, postIds)));
        var saved = new java.util.HashSet<>(jdbc.queryForList(
                "SELECT post_id FROM post_saves WHERE user_id=? AND post_id IN ("
                        + postPh + ")",
                UUID.class, concat(viewer, postIds)));
        var authors = new java.util.HashMap<UUID, Object>();
        identity.profileSummaries(authorIds).forEach(a -> authors.put(a.id(), a));
        // Batch-resolve category names — one query per page, not per post.
        var catIds = posts.stream().map(PostRow::categoryId)
                .filter(java.util.Objects::nonNull).distinct().toList();
        var catNames = new java.util.HashMap<UUID, String>();
        if (!catIds.isEmpty()) {
            var catPh = String.join(",", java.util.Collections.nCopies(
                    catIds.size(), "?::uuid"));
            jdbc.query("SELECT id,name FROM country_categories WHERE id IN ("
                            + catPh + ")",
                    (rs, i) -> Map.entry(rs.getObject("id", UUID.class),
                            rs.getString("name")), catIds.toArray())
                    .forEach(e -> catNames.put(e.getKey(), e.getValue()));
        }
        var pollIds = posts.stream().filter(p -> "POLL".equals(p.postType()))
                .map(PostRow::id).toList();
        var polls = pollResponses(viewer, pollIds);
        var cache = new java.util.HashMap<UUID, Boolean>();
        var out = new ArrayList<FeedItem>();
        for (var p : posts) {
            if (hidden.contains(p.authorId()) || !eligible(viewer, p, cache)) {
                continue;
            }
            var reaction = reactions.stream()
                    .filter(r -> p.id().equals(r.get("p"))).findFirst()
                    .map(r -> (String) r.get("r")).orElse(null);
            var payload = new java.util.HashMap<String, Object>();
            if (p.categoryId() != null) {
                payload.put("categoryId", p.categoryId().toString());
                var cn = catNames.get(p.categoryId());
                if (cn != null) {
                    payload.put("categoryName", cn);
                }
            }
            if ("POLL".equals(p.postType()) && polls.containsKey(p.id())) {
                payload.put("poll", polls.get(p.id()));
            }
            out.add(new FeedItem("FEED_POST:" + p.id(), p.postType(), "feed",
                    p.id(), authors.get(p.authorId()), p.communityId(),
                    p.publishedAt(), p.title(), p.body(), mediaIds(p.id()),
                    p.commentCount(), p.reactionCount(), reaction,
                    viewed.contains(p.id()), saved.contains(p.id()), payload));
        }
        return out;
    }

    private static Object[] concat(UUID first, List<UUID> rest) {
        var a = new ArrayList<Object>(rest.size() + 1);
        a.add(first);
        a.addAll(rest);
        return a.toArray();
    }

    /** Cursor "ts|id" → base64; orders unviewed first then newest. */
    public record FeedPage(List<FeedItem> items, String nextCursor) {
    }

    /**
     * Community feed. mode=FOR_YOU: eligible unseen first, newest first,
     * then seen newest first (view-aware ordering). mode=LATEST: strict
     * reverse-chronological, never reordered by view status. Optional
     * categoryId filters to a country practical category.
     */
    public FeedPage communityFeed(UUID viewer, UUID communityId, String mode,
            UUID categoryId, String cursor, int size) {
        if (!community.isActiveMember(viewer, communityId)) {
            throw forbidden("NOT_A_MEMBER");
        }
        boolean latest = "LATEST".equalsIgnoreCase(mode);
        int limit = clamp(size);
        var args = new ArrayList<Object>();
        args.add(viewer);                                   // ucv.user_id=?
        args.add(communityId);                              // fp.community_id=?
        // CAST(0 AS int) — a constant for LATEST; a bare "0" is read by
        // Postgres as ORDER-BY column position and is invalid SQL.
        String flag = latest ? "CAST(0 AS int)"
                : "CASE WHEN ucv.user_id IS NULL THEN 0 ELSE 1 END";
        String extra = "";
        if (categoryId != null) {
            extra += " AND fp.category_id=?";
            args.add(categoryId);
        }
        if (cursor != null) {
            var c = decode(cursor);                         // (flag, tsMs, id)
            // Keyset: flag ASC, then published_at DESC, then id DESC.
            extra += " AND (" + flag + " > ?"
                    + " OR (" + flag + " = ? AND fp.published_at < ?)"
                    + " OR (" + flag + " = ? AND fp.published_at = ?"
                    + "      AND fp.id < ?))";
            args.add(c.flag());
            args.add(c.flag());
            args.add(java.sql.Timestamp.from(c.ts()));
            args.add(c.flag());
            args.add(java.sql.Timestamp.from(c.ts()));
            args.add(c.id());
        }
        args.add(limit + 1);
        var rows = jdbc.query("SELECT " + prefix(POST_COLS) + ", " + flag + " AS flag"
                        + " FROM feed_posts fp"
                        + " LEFT JOIN user_content_views ucv ON ucv.user_id=?"
                        + " AND ucv.content_type='FEED_POST' AND ucv.content_id=fp.id"
                        + " WHERE fp.community_id=? AND fp.status='PUBLISHED'"
                        + " AND fp.deleted_at IS NULL" + extra
                        + " ORDER BY " + flag + ", fp.published_at DESC,"
                        + " fp.id DESC LIMIT ?",
                (rs, i) -> new Ranked(post(rs, i), rs.getInt("flag")),
                args.toArray());
        List<PostRow> posts = new ArrayList<>(rows.size());
        for (var r : rows) {
            posts.add(r.post());
        }
        String next = null;
        if (posts.size() > limit) {
            posts = posts.subList(0, limit);
            // Cursor from the LAST DISPLAYED row — not the +1 lookahead row.
            var tail = rows.get(posts.size() - 1);
            next = encode(tail.flag(), tail.post().publishedAt(),
                    tail.post().id());
        }
        return new FeedPage(toItems(viewer, posts), next);
    }

    private record Ranked(PostRow post, int flag) {
    }

    public FeedPage followingFeed(UUID viewer, String cursor, int size) {
        var following = social.followingIds(viewer);
        if (following.isEmpty()) {
            return new FeedPage(List.of(), null);
        }
        int limit = clamp(size);
        var params = new ArrayList<Object>();
        params.addAll(following);
        String ph = String.join(",", java.util.Collections.nCopies(
                following.size(), "?::uuid"));
        String extra = "";
        if (cursor != null) {
            var c = decode(cursor);
            extra = " AND (fp.published_at, fp.id) < (?, ?)";
            params.add(java.sql.Timestamp.from(c.ts()));
            params.add(c.id());
        }
        var rows = jdbc.query("SELECT " + POST_COLS + " FROM feed_posts fp"
                        + " WHERE fp.author_id IN (" + ph + ")"
                        + " AND fp.status='PUBLISHED' AND fp.deleted_at IS NULL"
                        + extra
                        + " ORDER BY fp.published_at DESC, fp.id DESC LIMIT ?",
                FeedService::post, append(params, limit + 1));
        return page(viewer, rows, limit, 0);
    }

    /** Reels — same feed modes, post_type filter. Nearby deferred (no geo col). */
    public FeedPage reelsFeed(UUID viewer, UUID communityId, String mode,
            String cursor, int size) {
        var page = communityFeed(viewer, communityId, "FOR_YOU", null, cursor, size);
        return new FeedPage(page.items().stream()
                .filter(i -> "REEL".equals(i.contentType())).toList(),
                page.nextCursor());
    }

    private static Object[] append(List<Object> params, int limit) {
        var a = new ArrayList<>(params);
        a.add(limit);
        return a.toArray();
    }

    private static String prefix(String cols) {
        return "fp." + cols.replace(",", ",fp.");
    }

    private static int clamp(int size) {
        return size <= 0 ? DEFAULT_PAGE : Math.min(size, MAX_PAGE);
    }

    private FeedPage page(UUID viewer, List<PostRow> rows, int limit, int flag) {
        String next = null;
        if (rows.size() > limit) {
            rows = rows.subList(0, limit);
            var last = rows.get(rows.size() - 1);
            next = encode(flag, last.publishedAt(), last.id());
        }
        return new FeedPage(toItems(viewer, rows), next);
    }

    private static String encode(int flag, Instant ts, UUID id) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (flag + "|" + ts + "|" + id).getBytes());
    }

    private record CursorParts(int flag, Instant ts, UUID id) {
    }

    private static CursorParts decode(String cursor) {
        try {
            var parts = new String(Base64.getUrlDecoder().decode(cursor))
                    .split("\\|");
            if (parts.length != 3) {
                throw bad("INVALID_CURSOR");
            }
            return new CursorParts(Integer.parseInt(parts[0]),
                    Instant.parse(parts[1]), UUID.fromString(parts[2]));
        } catch (IllegalArgumentException | NullPointerException e) {
            throw bad("INVALID_CURSOR");
        }
    }

    private void publish(UUID postId) {
        jdbc.update("UPDATE feed_posts SET status='PUBLISHED',"
                + " published_at=now(), updated_at=now() WHERE id=?", postId);
    }

    // =================== view tracking ===================

    @Transactional
    public void recordView(UUID userId, String contentType, UUID contentId) {
        if ("FEED_POST".equals(contentType)) {
            // Existence AND accessibility — a user cannot record views on
            // content they are not allowed to see (view-tracking abuse).
            requireViewable(userId, requirePost(contentId));
        }
        jdbc.update("INSERT INTO user_content_views(user_id,content_type,"
                        + "content_id) VALUES(?,?::content_reference_type,?)"
                        + " ON CONFLICT (user_id,content_type,content_id) DO UPDATE"
                        + " SET last_viewed_at=now(), view_count=user_content_views"
                        + ".view_count+1", userId, contentType, contentId);
    }

    // =================== reactions + saves ===================

    @Transactional
    public void react(UUID userId, UUID postId, String reaction) {
        var p = requirePost(postId);
        if (!REACTIONS.contains(reaction)) {
            throw bad("INVALID_REACTION");
        }
        requireViewable(userId, p);
        jdbc.update("INSERT INTO feed_post_reactions(post_id,user_id,reaction_key)"
                        + " VALUES(?,?,?) ON CONFLICT (post_id,user_id) DO UPDATE"
                        + " SET reaction_key=EXCLUDED.reaction_key",
                postId, userId, reaction);
    }

    @Transactional
    public void unreact(UUID userId, UUID postId) {
        requirePost(postId);
        jdbc.update("DELETE FROM feed_post_reactions WHERE post_id=? AND user_id=?",
                postId, userId);
    }

    @Transactional
    public void save(UUID userId, UUID postId) {
        requireViewable(userId, requirePost(postId));
        jdbc.update("INSERT INTO post_saves(user_id,post_id) VALUES(?,?)"
                + " ON CONFLICT DO NOTHING", userId, postId);
    }

    @Transactional
    public void unsave(UUID userId, UUID postId) {
        jdbc.update("DELETE FROM post_saves WHERE user_id=? AND post_id=?",
                userId, postId);
    }

    private void requireViewable(UUID viewer, PostRow p) {
        // Non-published content is only visible to its author and community
        // moderators — direct lookup must not leak drafts/deleted items.
        if (!"PUBLISHED".equals(p.status())) {
            if (!p.authorId().equals(viewer)
                    && !community.isModeratorOrAbove(viewer, p.communityId())) {
                throw forbidden("POST_NOT_VISIBLE");
            }
        }
        if (social.blockedWith(viewer, List.of(p.authorId())).contains(p.authorId())) {
            throw forbidden("BLOCKED");
        }
        if (!"COUNTRY".equals(p.scope())
                && !community.isActiveMember(viewer, p.communityId())) {
            throw forbidden("NOT_A_MEMBER");
        }
    }

    // =================== comments ===================

    @Transactional
    public CommentRow comment(UUID author, UUID postId, UUID parentId,
            String body) {
        var p = requirePost(postId);
        if (!p.commentsEnabled()) {
            throw bad("COMMENTS_DISABLED");
        }
        requireViewable(author, p);
        if (body == null || body.isBlank() || body.length() > 5000) {
            throw bad("INVALID_COMMENT");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO feed_post_comments(id,post_id,author_id,"
                        + "parent_comment_id,body) VALUES(?,?,?,?,?)",
                id, postId, author, parentId, body.trim());
        return new CommentRow(id, postId, author, parentId, body.trim(),
                Instant.now());
    }

    public record CommentPage(List<CommentRow> items, String nextCursor) {
    }

    public CommentPage comments(UUID viewer, UUID postId, int page, int size) {
        var p = requirePost(postId);
        requireViewable(viewer, p);
        int limit = clamp(size);
        var rows = jdbc.query("SELECT id,post_id,author_id,parent_comment_id,body,"
                        + "created_at FROM feed_post_comments WHERE post_id=?"
                        + " AND deleted_at IS NULL AND status='PUBLISHED'"
                        + " ORDER BY created_at,id LIMIT ? OFFSET ?",
                (rs, i) -> new CommentRow(rs.getObject("id", UUID.class),
                        rs.getObject("post_id", UUID.class),
                        rs.getObject("author_id", UUID.class),
                        rs.getObject("parent_comment_id", UUID.class),
                        rs.getString("body"), ts(rs, "created_at")),
                postId, limit, page * limit);
        return new CommentPage(rows, null);
    }

    @Transactional
    public CommentRow updateComment(UUID actor, UUID commentId, String body) {
        var c = requireComment(commentId);
        if (!c.authorId().equals(actor)) {
            throw forbidden("NOT_AUTHOR");
        }
        jdbc.update("UPDATE feed_post_comments SET body=?, updated_at=now()"
                + " WHERE id=?", body.trim(), commentId);
        return new CommentRow(c.id(), c.postId(), c.authorId(), c.parentId(),
                body.trim(), c.createdAt());
    }

    @Transactional
    public void deleteComment(UUID actor, UUID commentId) {
        var c = requireComment(commentId);
        var p = requirePost(c.postId());
        if (!c.authorId().equals(actor)
                && !community.isModeratorOrAbove(actor, p.communityId())) {
            throw forbidden("NOT_AUTHOR");
        }
        jdbc.update("UPDATE feed_post_comments SET status='DELETED',"
                + " deleted_at=now(), updated_at=now() WHERE id=?", commentId);
    }

    private CommentRow requireComment(UUID id) {
        return jdbc.query("SELECT id,post_id,author_id,parent_comment_id,body,"
                        + "created_at FROM feed_post_comments WHERE id=?"
                        + " AND deleted_at IS NULL",
                (rs, i) -> new CommentRow(rs.getObject("id", UUID.class),
                        rs.getObject("post_id", UUID.class),
                        rs.getObject("author_id", UUID.class),
                        rs.getObject("parent_comment_id", UUID.class),
                        rs.getString("body"), ts(rs, "created_at")), id)
                .stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "COMMENT_NOT_FOUND"));
    }

    // =================== community help ===================

    @Transactional
    public Map<String, Object> createHelpPost(UUID author, UUID communityId,
            UUID categoryId, String kind, String title, String body,
            Instant expiresAt) {
        if (!HELP_KINDS.contains(kind)) {
            throw bad("INVALID_HELP_KIND");
        }
        var p = createPost(author, communityId, "COMMUNITY_HELP", title, body,
                null, "COMMUNITY", categoryId, null);
        jdbc.update("INSERT INTO community_help_posts(post_id,help_kind,"
                        + "expires_at) VALUES(?,?,?)", p.id(), kind,
                expiresAt == null ? null : java.sql.Timestamp.from(expiresAt));
        publish(p.id());
        return Map.of("post", requirePost(p.id()), "helpKind", kind,
                "helpStatus", "OPEN");
    }

    public Map<String, Object> helpStatus(UUID postId) {
        // Lazy expiry: an OPEN post past expires_at transitions to EXPIRED on
        // first read — avoids a scheduler for now (documented in the report).
        jdbc.update("UPDATE community_help_posts SET help_status='EXPIRED',"
                + " expired_at=now(), updated_at=now() WHERE post_id=?"
                + " AND help_status='OPEN' AND expires_at IS NOT NULL"
                + " AND expires_at < now()", postId);
        return jdbc.query("SELECT help_kind,help_status,expires_at,resolved_at,"
                        + "closed_at,expired_at FROM community_help_posts"
                        + " WHERE post_id=?", (rs, i) -> Map.<String,Object>of(
                        "helpKind", rs.getString("help_kind"),
                        "helpStatus", rs.getString("help_status"),
                        "expiresAt", rs.getTimestamp("expires_at") == null ? ""
                                : rs.getTimestamp("expires_at").toInstant().toString()),
                postId).stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "HELP_POST_NOT_FOUND"));
    }

    @Transactional
    public Map<String, Object> setHelpStatus(UUID actor, UUID postId,
            String status) {
        var p = requirePost(postId);
        var cur = helpStatus(postId);
        var current = (String) cur.get("helpStatus");
        if (!p.authorId().equals(actor)
                && !community.isModeratorOrAbove(actor, p.communityId())) {
            throw forbidden("NOT_AUTHOR");
        }
        boolean valid = switch (current) {
            case "OPEN" -> OPEN_HELP_TRANSITIONS.contains(status);
            case "PAUSED" -> Set.of("OPEN", "RESOLVED", "CLOSED").contains(status);
            default -> false;                       // terminal states
        };
        if (!valid) {
            throw bad("INVALID_STATUS_TRANSITION");
        }
        String ts = switch (status) {
            case "RESOLVED" -> "resolved_at";
            case "CLOSED" -> "closed_at";
            case "EXPIRED" -> "expired_at";
            default -> null;
        };
        jdbc.update("UPDATE community_help_posts SET help_status=?,"
                        + (ts == null ? "" : ts + "=now(),")
                        + " updated_at=now() WHERE post_id=?", status, postId);
        return helpStatus(postId);
    }

    // =================== polls ===================

    private record LockedPoll(Instant closesAt, Instant closedAt,
            boolean allowMultiple, boolean allowVoteChange,
            boolean allowVoteWithdraw, boolean anonymousVoting,
            String resultsVisibility, int maxOptions, Instant databaseNow,
            PollRules.Status status) {
    }

    private record PollOptionSnapshot(UUID id, String text, int sortOrder,
            long voteCount, boolean myVote) {
    }

    private static final class PollBuilder {
        private UUID postId;
        private String question;
        private Instant closesAt;
        private Instant closedAt;
        private boolean allowMultiple;
        private boolean allowVoteChange;
        private boolean allowVoteWithdraw;
        private boolean anonymousVoting;
        private int maxOptions;
        private String visibility;
        private long totalVoters;
        private long totalVotes;
        private PollRules.Status status;
        private final List<PollOptionSnapshot> options = new ArrayList<>();

        private PollResponse build() {
            var myVotes = options.stream().filter(PollOptionSnapshot::myVote)
                    .map(PollOptionSnapshot::id).toList();
            boolean visible = PollRules.resultsVisible(visibility,
                    !myVotes.isEmpty(), status);
            var responseOptions = options.stream().map(o ->
                    new PollOptionResponse(o.id(), o.text(), o.sortOrder(),
                            visible ? o.voteCount() : null,
                            visible ? PollRules.percentage(o.voteCount(), totalVoters)
                                    : null)).toList();
            return new PollResponse(postId, question, status, closesAt, closedAt,
                    allowMultiple, allowVoteChange, allowVoteWithdraw,
                    anonymousVoting, maxOptions, ResultsVisibility.valueOf(visibility),
                    visible, visible ? totalVoters : null,
                    visible ? totalVotes : null, myVotes, responseOptions);
        }
    }

    private Instant databaseNow() {
        return jdbc.queryForObject("SELECT now()", Instant.class);
    }

    private void lockActor(String namespace, UUID actor) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended("
                + "? || ?::text, 0))", Object.class, namespace, actor);
    }

    private void checkCreateRate(UUID author) {
        lockActor("diasporum.feed.polls.create.", author);
        int created = Optional.ofNullable(jdbc.queryForObject(
                "SELECT count(*) FROM feed_posts WHERE author_id=?"
                        + " AND post_type='POLL'"
                        + " AND created_at > now() - interval '1 hour'",
                Integer.class, author)).orElse(0);
        if (created >= pollCreatePerHour) {
            throw tooMany("POLL_CREATE_RATE_LIMIT");
        }
    }

    private void checkVoteRate(UUID voter) {
        lockActor("diasporum.feed.polls.vote.", voter);
        int votes = Optional.ofNullable(jdbc.queryForObject(
                "SELECT count(*) FROM feed_poll_votes WHERE user_id=?"
                        + " AND created_at > now() - interval '1 minute'",
                Integer.class, voter)).orElse(0);
        if (votes >= pollVotePerMinute) {
            throw tooMany("POLL_VOTE_RATE_LIMIT");
        }
    }

    @Transactional
    public PollResponse createPoll(UUID author, UUID communityId, UUID categoryId,
            String question, List<String> options, Instant closesAt) {
        return createPoll(author, communityId, categoryId, question, options, null,
                closesAt, false, false, false, false, "AFTER_VOTING");
    }

    @Transactional
    public PollResponse createPoll(UUID author, UUID communityId, UUID categoryId,
            String question, List<String> options, Integer maxOptions,
            Instant closesAt, boolean allowMultiple, boolean allowVoteChange,
            boolean allowVoteWithdraw, boolean anonymousVoting,
            String resultsVisibility) {
        checkCreateRate(author);
        String normalizedQuestion = validated(() -> PollRules.question(question));
        var normalizedOptions = validated(
                () -> PollRules.options(options, maxOptions));
        Instant deadline = validated(
                () -> PollRules.futureDeadline(closesAt, databaseNow()));
        String visibility = validated(() -> ResultsVisibility.valueOf(
                resultsVisibility == null ? "AFTER_VOTING" : resultsVisibility).name());
        var parent = createPost(author, communityId, "POLL", null,
                normalizedQuestion, null, "COMMUNITY", categoryId, null, true);
        jdbc.update("INSERT INTO feed_polls(post_id,closes_at,max_options,"
                        + "allow_multiple,allow_vote_change,allow_vote_withdraw,"
                        + "anonymous_voting,results_visibility) VALUES(?,?,?,?,?,?,?,?)",
                parent.id(), deadline == null ? null : java.sql.Timestamp.from(deadline),
                normalizedOptions.maxOptions(), allowMultiple, allowVoteChange,
                allowVoteWithdraw, anonymousVoting, visibility);
        int order = 0;
        for (String option : normalizedOptions.values()) {
            jdbc.update("INSERT INTO feed_poll_options(id,post_id,option_text,"
                    + "sort_order) VALUES(?,?,?,?)", UUID.randomUUID(), parent.id(),
                    option, order++);
        }
        publish(parent.id());
        return poll(parent.id(), author);
    }

    public PollResponse poll(UUID postId, UUID viewer) {
        requireViewable(viewer, requirePost(postId));
        var response = pollResponses(viewer, List.of(postId)).get(postId);
        if (response == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "POLL_NOT_FOUND");
        }
        return response;
    }

    /** One statement provides a consistent metadata/vote snapshot for every Poll. */
    private Map<UUID, PollResponse> pollResponses(UUID viewer, List<UUID> postIds) {
        if (postIds.isEmpty()) {
            return Map.of();
        }
        String placeholders = String.join(",", java.util.Collections.nCopies(
                postIds.size(), "?::uuid"));
        String sql = "WITH current_votes AS MATERIALIZED ("
                + " SELECT v.option_id,v.user_id,o.post_id FROM feed_poll_votes v"
                + " JOIN feed_poll_options o ON o.id=v.option_id"
                + " WHERE o.post_id IN (" + placeholders + ")),"
                + " totals AS (SELECT post_id,count(DISTINCT user_id) total_voters,"
                + " count(*) total_votes FROM current_votes GROUP BY post_id)"
                + " SELECT p.post_id,f.body question,p.closes_at,p.closed_at,"
                + " p.allow_multiple,p.allow_vote_change,p.allow_vote_withdraw,"
                + " p.anonymous_voting,p.max_options,p.results_visibility,now() db_now,"
                + " o.id option_id,o.option_text,o.sort_order,"
                + " (SELECT count(*) FROM current_votes cv WHERE cv.option_id=o.id) vote_count,"
                + " COALESCE(t.total_voters,0) total_voters,"
                + " COALESCE(t.total_votes,0) total_votes,"
                + " EXISTS(SELECT 1 FROM current_votes cv WHERE cv.option_id=o.id"
                + " AND cv.user_id=?) my_vote"
                + " FROM feed_polls p JOIN feed_posts f ON f.id=p.post_id"
                + " LEFT JOIN feed_poll_options o ON o.post_id=p.post_id"
                + " LEFT JOIN totals t ON t.post_id=p.post_id"
                + " WHERE p.post_id IN (" + placeholders + ")"
                + " ORDER BY p.post_id,o.sort_order";
        var args = new ArrayList<>();
        args.addAll(postIds);
        args.add(viewer);
        args.addAll(postIds);
        Map<UUID, PollBuilder> builders = jdbc.query(sql, rs -> {
            Map<UUID, PollBuilder> result = new LinkedHashMap<>();
            while (rs.next()) {
                UUID postId = rs.getObject("post_id", UUID.class);
                var b = result.computeIfAbsent(postId, ignored -> new PollBuilder());
                if (b.postId == null) {
                    b.postId = postId;
                    b.question = rs.getString("question");
                    b.closesAt = ts(rs, "closes_at");
                    b.closedAt = ts(rs, "closed_at");
                    b.allowMultiple = rs.getBoolean("allow_multiple");
                    b.allowVoteChange = rs.getBoolean("allow_vote_change");
                    b.allowVoteWithdraw = rs.getBoolean("allow_vote_withdraw");
                    b.anonymousVoting = rs.getBoolean("anonymous_voting");
                    b.maxOptions = rs.getInt("max_options");
                    b.visibility = rs.getString("results_visibility");
                    b.totalVoters = rs.getLong("total_voters");
                    b.totalVotes = rs.getLong("total_votes");
                    b.status = PollRules.status(b.closesAt, b.closedAt,
                            ts(rs, "db_now"));
                }
                UUID optionId = rs.getObject("option_id", UUID.class);
                if (optionId != null) {
                    b.options.add(new PollOptionSnapshot(optionId,
                            rs.getString("option_text"), rs.getInt("sort_order"),
                            rs.getLong("vote_count"), rs.getBoolean("my_vote")));
                }
            }
            return result;
        }, args.toArray());
        Map<UUID, PollResponse> responses = new LinkedHashMap<>();
        builders.forEach((id, builder) -> responses.put(id, builder.build()));
        return responses;
    }

    private LockedPoll lockPoll(UUID postId) {
        return jdbc.query("SELECT closes_at,closed_at,allow_multiple,"
                        + "allow_vote_change,allow_vote_withdraw,anonymous_voting,"
                        + "results_visibility,max_options,now() db_now"
                        + " FROM feed_polls WHERE post_id=? FOR UPDATE",
                (rs, i) -> {
                    Instant closesAt = ts(rs, "closes_at");
                    Instant closedAt = ts(rs, "closed_at");
                    Instant now = ts(rs, "db_now");
                    return new LockedPoll(closesAt, closedAt,
                            rs.getBoolean("allow_multiple"),
                            rs.getBoolean("allow_vote_change"),
                            rs.getBoolean("allow_vote_withdraw"),
                            rs.getBoolean("anonymous_voting"),
                            rs.getString("results_visibility"), rs.getInt("max_options"),
                            now, PollRules.status(closesAt, closedAt, now));
                }, postId).stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "POLL_NOT_FOUND"));
    }

    private void requirePollManager(UUID actor, PostRow post) {
        if (!post.authorId().equals(actor)
                && !community.isModeratorOrAbove(actor, post.communityId())) {
            throw forbidden("NOT_POLL_MANAGER");
        }
    }

    private boolean hasVotes(UUID postId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM feed_poll_votes v"
                        + " JOIN feed_poll_options o ON o.id=v.option_id"
                        + " WHERE o.post_id=?)", Boolean.class, postId));
    }

    private List<UUID> currentVotes(UUID postId, UUID voter) {
        return jdbc.queryForList("SELECT v.option_id FROM feed_poll_votes v"
                + " JOIN feed_poll_options o ON o.id=v.option_id"
                + " WHERE o.post_id=? AND v.user_id=? ORDER BY o.sort_order",
                UUID.class, postId, voter);
    }

    @Transactional
    public PollResponse updatePoll(UUID actor, UUID postId, String question,
            List<String> options, Integer maxOptions, Instant closesAt,
            Boolean allowMultiple, Boolean allowVoteChange,
            Boolean allowVoteWithdraw, Boolean anonymousVoting,
            String resultsVisibility) {
        var parent = requirePost(postId);
        requirePollManager(actor, parent);
        var current = lockPoll(postId);
        boolean voted = hasVotes(postId);
        boolean policyChange = maxOptions != null || allowMultiple != null
                || allowVoteChange != null || allowVoteWithdraw != null
                || anonymousVoting != null || resultsVisibility != null;
        if (voted && options != null) {
            throw conflict("POLL_OPTIONS_LOCKED");
        }
        if (voted && policyChange) {
            throw conflict("POLL_POLICY_LOCKED");
        }
        if (closesAt != null && current.status() != PollRules.Status.ACTIVE) {
            throw conflict("POLL_NOT_ACTIVE");
        }
        String normalizedQuestion = question == null ? null
                : validated(() -> PollRules.question(question));
        int targetMax = maxOptions == null ? current.maxOptions() : maxOptions;
        PollRules.ValidatedOptions normalizedOptions = null;
        if (options != null) {
            normalizedOptions = validated(() -> PollRules.options(options, targetMax));
        } else {
            int optionCount = jdbc.queryForObject("SELECT count(*) FROM"
                    + " feed_poll_options WHERE post_id=?", Integer.class, postId);
            validated(() -> {
                PollRules.validateMaxOptions(targetMax, optionCount);
                return null;
            });
        }
        Instant deadline = closesAt == null ? null : validated(
                () -> PollRules.futureDeadline(closesAt, current.databaseNow()));
        String visibility = resultsVisibility == null ? null : validated(
                () -> ResultsVisibility.valueOf(resultsVisibility).name());
        if (normalizedQuestion != null) {
            jdbc.update("UPDATE feed_posts SET body=?,updated_at=now() WHERE id=?",
                    normalizedQuestion, postId);
        }
        List<UUID> existingIds = options == null ? List.of() : jdbc.queryForList(
                "SELECT id FROM feed_poll_options WHERE post_id=? ORDER BY sort_order",
                UUID.class, postId);
        if (normalizedOptions != null) {
            int common = Math.min(existingIds.size(), normalizedOptions.values().size());
            for (int i = 0; i < common; i++) {
                jdbc.update("UPDATE feed_poll_options SET option_text=? WHERE id=?",
                        normalizedOptions.values().get(i), existingIds.get(i));
            }
            for (int i = existingIds.size() - 1;
                    i >= normalizedOptions.values().size(); i--) {
                jdbc.update("DELETE FROM feed_poll_options WHERE id=?", existingIds.get(i));
            }
        }
        jdbc.update("UPDATE feed_polls SET max_options=?,"
                + "allow_multiple=COALESCE(?,allow_multiple),"
                + "allow_vote_change=COALESCE(?,allow_vote_change),"
                + "allow_vote_withdraw=COALESCE(?,allow_vote_withdraw),"
                + "anonymous_voting=COALESCE(?,anonymous_voting),"
                + "results_visibility=COALESCE(?,results_visibility),"
                + "closes_at=COALESCE(?::timestamptz,closes_at) WHERE post_id=?",
                targetMax, allowMultiple, allowVoteChange, allowVoteWithdraw,
                anonymousVoting, visibility,
                deadline == null ? null : java.sql.Timestamp.from(deadline), postId);
        if (normalizedOptions != null) {
            for (int i = existingIds.size(); i < normalizedOptions.values().size(); i++) {
                jdbc.update("INSERT INTO feed_poll_options(id,post_id,option_text,"
                        + "sort_order) VALUES(?,?,?,?)", UUID.randomUUID(), postId,
                        normalizedOptions.values().get(i), i);
            }
        }
        return poll(postId, actor);
    }

    @Transactional
    public PollResponse vote(UUID voter, UUID optionId, boolean withdraw) {
        UUID postId = jdbc.query("SELECT post_id FROM feed_poll_options WHERE id=?",
                (rs, i) -> rs.getObject(1, UUID.class), optionId).stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "OPTION_NOT_FOUND"));
        requireViewable(voter, requirePost(postId));
        var current = lockPoll(postId);
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended("
                + "?::text || ':' || ?::text, 0))", Object.class, postId, voter);
        if (current.status() != PollRules.Status.ACTIVE) {
            throw conflict("POLL_CLOSED");
        }
        var myVotes = currentVotes(postId, voter);
        if (withdraw) {
            if (!myVotes.contains(optionId)) {
                return poll(postId, voter);
            }
            if (!current.allowVoteWithdraw()) {
                throw conflict("WITHDRAW_NOT_ALLOWED");
            }
            jdbc.update("DELETE FROM feed_poll_votes WHERE option_id=? AND user_id=?",
                    optionId, voter);
            return poll(postId, voter);
        }
        if (myVotes.contains(optionId)) {
            return poll(postId, voter);
        }
        try {
            if (!current.allowMultiple() && !myVotes.isEmpty()) {
                if (!current.allowVoteChange()) {
                    throw conflict("ALREADY_VOTED");
                }
                jdbc.update("UPDATE feed_poll_votes SET option_id=?"
                        + " WHERE option_id=? AND user_id=?", optionId,
                        myVotes.get(0), voter);
            } else {
                checkVoteRate(voter);
                jdbc.update("INSERT INTO feed_poll_votes(option_id,user_id) VALUES(?,?)",
                        optionId, voter);
            }
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            throw conflict("VOTE_CONFLICT");
        }
        return poll(postId, voter);
    }

    @Transactional
    public PollResponse closePoll(UUID actor, UUID postId) {
        var parent = requirePost(postId);
        requirePollManager(actor, parent);
        var current = lockPoll(postId);
        if (current.closedAt() != null) {
            return poll(postId, actor);
        }
        if (current.status() != PollRules.Status.ACTIVE) {
            throw conflict("POLL_NOT_ACTIVE");
        }
        jdbc.update("UPDATE feed_polls SET closed_at=now(),closed_by=? WHERE post_id=?",
                actor, postId);
        return poll(postId, actor);
    }

    public UUID reportPost(UUID actor, UUID postId, String reason, String details) {
        var post = requirePost(postId);
        requireViewable(actor, post);
        return moderation.createReport(new ModerationApi.CreateReportCommand(actor,
                post.countryId(), post.communityId(), "FEED_POST", postId,
                reason, details));
    }

    // =================== FeedApi surface ===================

    public PostRow getPost(UUID viewer, UUID id) {
        var p = requirePost(id);
        requireViewable(viewer, p);
        return p;
    }

    public boolean canView(UUID viewer, UUID id) {
        try {
            requireViewable(viewer, requirePost(id));
            return true;
        } catch (ResponseStatusException e) {
            return false;
        }
    }

    public int commentCount(UUID postId) {
        Integer n = jdbc.queryForObject("SELECT comment_count FROM feed_posts"
                + " WHERE id=?", Integer.class, postId);
        return n == null ? 0 : n;
    }

    public int reactionCount(UUID postId) {
        Integer n = jdbc.queryForObject("SELECT reaction_count FROM feed_posts"
                + " WHERE id=?", Integer.class, postId);
        return n == null ? 0 : n;
    }

    public java.util.List<com.diasporum.backend.feed.FeedApi.PostView> apiPosts(
            java.util.Collection<UUID> ids) {
        if (ids == null || ids.isEmpty()) {
            return java.util.List.of();
        }
        String ph = String.join(",", java.util.Collections.nCopies(
                ids.size(), "?::uuid"));
        return jdbc.query("SELECT " + POST_COLS + " FROM feed_posts"
                        + " WHERE id IN (" + ph + ") AND status<>'DELETED'",
                FeedService::post, ids.toArray()).stream()
                .map(p -> new com.diasporum.backend.feed.FeedApi.PostView(p.id(),
                        p.authorId(), p.communityId(), p.countryId(),
                        p.postType(), p.status(), p.scope(), p.title(),
                        p.publishedAt()))
                .toList();
    }

    public Optional<com.diasporum.backend.feed.FeedApi.PostView> apiPost(UUID id) {
        return jdbc.query("SELECT " + POST_COLS + " FROM feed_posts WHERE id=?",
                        FeedService::post, id).stream().findFirst()
                .filter(p -> !"DELETED".equals(p.status()))
                .map(p -> new com.diasporum.backend.feed.FeedApi.PostView(p.id(),
                        p.authorId(), p.communityId(), p.countryId(),
                        p.postType(), p.status(), p.scope(), p.title(),
                        p.publishedAt()));
    }
}
