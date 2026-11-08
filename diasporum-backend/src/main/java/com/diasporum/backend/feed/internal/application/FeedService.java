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
    private static final Set<String> SHARE_TARGETS = Set.of("COPY_LINK",
            "IN_APP", "SYSTEM_SHARE");
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
    private static final java.util.regex.Pattern HASHTAG =
            java.util.regex.Pattern.compile("#([\\p{L}\\p{N}_]{2,50})");
    private static final java.util.regex.Pattern TAG_KEY_OK =
            java.util.regex.Pattern.compile("[\\p{L}\\p{N}_]+");

    private final int pollCreatePerHour;
    private final int pollVotePerMinute;
    private final int tagMaxPerPost;
    private final int tagMaxLength;
    private final int tagCreatePerHour;
    private final int maxAttachments;

    public FeedService(JdbcTemplate jdbc, IdentityApi identity,
            CommunityApi community, SocialApi social, MediaApi media,
            TaxonomyApi taxonomy, ModerationApi moderation,
            @Value("${diasporum.feed.polls.create-per-hour:10}") int pollCreatePerHour,
            @Value("${diasporum.feed.polls.vote-per-minute:120}") int pollVotePerMinute,
            @Value("${diasporum.feed.tags.max-per-post:10}") int tagMaxPerPost,
            @Value("${diasporum.feed.tags.max-length:50}") int tagMaxLength,
            @Value("${diasporum.feed.tags.create-per-hour:60}") int tagCreatePerHour,
            @Value("${diasporum.feed.max-attachments:10}") int maxAttachments) {
        this.jdbc = jdbc;
        this.identity = identity;
        this.community = community;
        this.social = social;
        this.media = media;
        this.taxonomy = taxonomy;
        this.moderation = moderation;
        this.pollCreatePerHour = Math.max(1, pollCreatePerHour);
        this.pollVotePerMinute = Math.max(1, pollVotePerMinute);
        this.tagMaxPerPost = Math.max(1, tagMaxPerPost);
        this.tagMaxLength = Math.min(50, Math.max(2, tagMaxLength));
        this.tagCreatePerHour = Math.max(1, tagCreatePerHour);
        this.maxAttachments = Math.max(1, maxAttachments);
    }

    // =================== row types ===================

    public record PostRow(UUID id, UUID authorId, UUID communityId,
            UUID countryId, String postType, String status, String scope,
            String title, String body, String linkUrl, UUID categoryId,
            boolean commentsEnabled,
            int commentCount, int reactionCount, int shareCount,
            Instant publishedAt, Instant createdAt) {
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
                rs.getInt("share_count"),
                ts(rs, "published_at"), ts(rs, "created_at"));
    }

    private static Instant ts(java.sql.ResultSet rs, String col)
            throws java.sql.SQLException {
        var t = rs.getTimestamp(col);
        return t == null ? null : t.toInstant();
    }

    private static final String POST_COLS = "id,author_id,community_id,country_id,"
            + "post_type,status::text,visibility_scope::text,title,body,link_url,"
            + "category_id,comments_enabled,comment_count,reaction_count,share_count,published_at,created_at";

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
                scope, categoryId, mediaIds, null, false);
    }

    @Transactional
    public PostRow createPost(UUID authorId, UUID communityId, String type,
            String title, String body, String linkUrl, String scope,
            UUID categoryId, List<UUID> mediaIds, List<String> tags) {
        return createPost(authorId, communityId, type, title, body, linkUrl,
                scope, categoryId, mediaIds, tags, false);
    }

    private PostRow createPost(UUID authorId, UUID communityId, String type,
            String title, String body, String linkUrl, String scope,
            UUID categoryId, List<UUID> mediaIds, List<String> tags,
            boolean pollWorkflow) {
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
        String module = "COMMUNITY_HELP".equals(type) ? "COMMUNITY_HELP"
                : "REEL".equals(type) ? "REELS" : "FEED";
        community.requireModule(authorId, communityId, module);
        var c = taxonomy.findCommunityById(communityId).orElseThrow(
                () -> bad("COMMUNITY_NOT_FOUND"));
        if (categoryId != null && !taxonomy.isCategoryActiveInCountry(categoryId,
                c.destinationCountryId(),
                "COMMUNITY_HELP".equals(type) ? "COMMUNITY_HELP" : "FEED")) {
            throw bad("INVALID_CATEGORY");
        }
        if ("REEL".equals(type) && (mediaIds == null || mediaIds.isEmpty())) {
            throw bad("REEL_REQUIRES_VIDEO");
        }
        UUID id = UUID.randomUUID();
        // POLL/COMMUNITY_HELP must start DRAFT: the publish trigger requires
        // their child rows (options / help metadata) to already exist. REEL
        // starts DRAFT for the same reason — the reel integrity trigger needs
        // the FEED_VIDEO attachment row, which can only exist after the post.
        boolean draftFirst = "POLL".equals(type) || "COMMUNITY_HELP".equals(type)
                || "REEL".equals(type);
        jdbc.update("INSERT INTO feed_posts(id,country_id,community_id,"
                        + "visibility_scope,author_id,category_id,post_type,title,"
                        + "body,link_url,status,published_at) VALUES(?,?,?,?::"
                        + "visibility_scope,?,?,?,?,?,?,?::content_status,?)",
                id, c.destinationCountryId(), communityId, scope, authorId,
                categoryId, type, title, body == null ? "" : body, linkUrl,
                draftFirst ? "DRAFT" : "PUBLISHED",
                draftFirst ? null : java.sql.Timestamp.from(Instant.now()));
        attachMedia(id, authorId, type, mediaIds);
        syncTags(id, authorId, tags, body);
        if ("REEL".equals(type)) {
            publish(id);    // DRAFT -> PUBLISHED; the integrity trigger now
                            // sees the attached READY FEED_VIDEO asset
            community.consumeExtendedAction(authorId, communityId,
                    "EXTENDED_REEL_PUBLISH", "extended-reel-publish:" + id);
            return requirePost(id);
        }
        if ("GENERAL".equals(type)) {
            community.consumeExtendedAction(authorId, communityId,
                    "EXTENDED_FEED_POST_PUBLISH", "extended-feed-publish:" + id);
        }
        return new PostRow(id, authorId, communityId, c.destinationCountryId(),
                type, draftFirst ? "DRAFT" : "PUBLISHED", scope, title, body,
                linkUrl, categoryId, true, 0, 0, 0,
                draftFirst ? null : Instant.now(), Instant.now());
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
                            || "FEED_AUDIO".equals(asset.purpose())
                            || "DOCUMENT".equals(asset.purpose()));
            if (!ok) {
                throw bad("MEDIA_WRONG_PURPOSE");
            }
            if (order >= maxAttachments) {
                throw bad("TOO_MANY_ATTACHMENTS");
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
        return updatePost(actor, postId, title, body, linkUrl, null, null);
    }

    @Transactional
    public PostRow updatePost(UUID actor, UUID postId, String title,
            String body, String linkUrl, UUID categoryId, List<String> tags) {
        var p = requirePost(postId);
        if (!p.authorId().equals(actor)
                && !community.isModeratorOrAbove(actor, p.communityId())) {
            throw forbidden("NOT_AUTHOR");
        }
        String normalizedBody = body != null && "POLL".equals(p.postType())
                ? validated(() -> PollRules.question(body)) : body;
        if (categoryId != null && !taxonomy.isCategoryActiveInCountry(categoryId,
                p.countryId(),
                "COMMUNITY_HELP".equals(p.postType()) ? "COMMUNITY_HELP" : "FEED")) {
            throw bad("INVALID_CATEGORY");
        }
        jdbc.update("UPDATE feed_posts SET title=COALESCE(?,title),"
                + " body=COALESCE(?,body), link_url=COALESCE(?,link_url),"
                + " category_id=COALESCE(?,category_id),"
                + " updated_at=now() WHERE id=?", title, normalizedBody, linkUrl,
                categoryId, postId);
        if (tags != null || normalizedBody != null) {
            syncTags(postId, actor, tags,
                    normalizedBody != null ? normalizedBody : p.body());
        }
        return requirePost(postId);
    }

    @Transactional
    public void deletePost(UUID actor, UUID postId) {
        var p = requirePost(postId);
        if (!p.authorId().equals(actor)
                && !community.isModeratorOrAbove(actor, p.communityId())) {
            throw forbidden("NOT_AUTHOR");
        }
        jdbc.update("UPDATE feed_tags ft SET post_count=GREATEST(ft.post_count-1,0)"
                + " FROM feed_post_tags fpt WHERE fpt.tag_id=ft.id"
                + " AND fpt.post_id=?", postId);
        jdbc.update("UPDATE feed_posts SET status='DELETED', deleted_at=now(),"
                + " updated_at=now() WHERE id=?", postId);
    }

    // =================== hashtags ===================

    /** Strip '#', trim, lowercase — null when outside the documented rules. */
    private String normalizeTag(String raw) {
        if (raw == null) {
            return null;
        }
        String t = raw.trim();
        while (t.startsWith("#")) {
            t = t.substring(1).trim();
        }
        String key = t.toLowerCase(java.util.Locale.ROOT);
        return key.length() >= 2 && key.length() <= tagMaxLength
                && TAG_KEY_OK.matcher(key).matches() ? key : null;
    }

    private void checkTagCreateRate(UUID author) {
        lockActor("diasporum.feed.tags.create.", author);
        int created = Optional.ofNullable(jdbc.queryForObject(
                "SELECT count(*) FROM feed_tags WHERE created_by=?"
                        + " AND created_at > now() - interval '1 hour'",
                Integer.class, author)).orElse(0);
        if (created >= tagCreatePerHour) {
            throw tooMany("TAG_CREATE_RATE_LIMIT");
        }
    }

    private UUID tagIdFor(String key, String display, UUID author) {
        var found = jdbc.query("SELECT id FROM feed_tags WHERE tag_key=?",
                (rs, i) -> rs.getObject(1, UUID.class), key)
                .stream().findFirst();
        if (found.isPresent()) {
            return found.get();
        }
        checkTagCreateRate(author);
        jdbc.update("INSERT INTO feed_tags(id,tag_key,display_name,created_by)"
                        + " VALUES(?,?,?,?) ON CONFLICT(tag_key) DO NOTHING",
                UUID.randomUUID(), key, display, author);
        return jdbc.queryForObject("SELECT id FROM feed_tags WHERE tag_key=?",
                UUID.class, key);
    }

    /**
     * Reconcile a post's tag set: explicit tags (null = keep existing) merged
     * with '#tag' tokens parsed from the effective body. Caps at
     * {@code tagMaxPerPost}; maintains feed_tags.post_count.
     */
    private void syncTags(UUID postId, UUID author, List<String> explicit,
            String body) {
        var keys = new java.util.LinkedHashSet<String>();
        var displays = new java.util.HashMap<String, String>();
        if (explicit != null) {
            for (String raw : explicit) {
                String key = normalizeTag(raw);
                if (key == null) {
                    throw bad("INVALID_TAG");
                }
                keys.add(key);
                String d = raw.trim();
                while (d.startsWith("#")) {
                    d = d.substring(1).trim();
                }
                displays.putIfAbsent(key, d);
            }
        }
        if (body != null) {
            var m = HASHTAG.matcher(body);
            while (m.find()) {
                String key = m.group(1).toLowerCase(java.util.Locale.ROOT);
                keys.add(key);
                displays.putIfAbsent(key, m.group(1)); // keep author's casing
            }
        }
        var existing = jdbc.queryForList("SELECT tag_id FROM feed_post_tags"
                + " WHERE post_id=? ORDER BY sort_order", UUID.class, postId);
        if (explicit == null && keys.isEmpty()) {
            return;                                     // nothing to reconcile
        }
        var desired = new ArrayList<UUID>();
        for (String key : keys) {
            desired.add(tagIdFor(key, displays.getOrDefault(key, key), author));
        }
        if (explicit == null) {
            // Body-only edit: keep existing explicit tags, union new tokens.
            for (UUID id : existing) {
                if (!desired.contains(id)) {
                    desired.add(id);
                }
            }
        }
        if (desired.size() > tagMaxPerPost) {
            throw bad("TOO_MANY_TAGS");
        }
        for (UUID id : existing) {
            if (!desired.contains(id)) {
                jdbc.update("UPDATE feed_tags SET post_count=GREATEST("
                        + "post_count-1,0) WHERE id=?", id);
            }
        }
        for (UUID id : desired) {
            if (!existing.contains(id)) {
                jdbc.update("UPDATE feed_tags SET post_count=post_count+1,"
                        + "last_used_at=now() WHERE id=?", id);
            }
        }
        // Rebuild join rows wholesale — UNIQUE(post_id,sort_order) can't be
        // updated in place when rows swap positions.
        jdbc.update("DELETE FROM feed_post_tags WHERE post_id=?", postId);
        int order = 0;
        for (UUID id : desired) {
            jdbc.update("INSERT INTO feed_post_tags(post_id,tag_id,sort_order)"
                    + " VALUES(?,?,?)", postId, id, order++);
        }
    }

    public record TagView(String tagKey, String displayName, long postCount) {
    }

    /** Prefix suggestions ordered by usage — powers composer autocomplete. */
    public List<TagView> suggestTags(String q, int size) {
        String key = q == null ? "" : q.trim()
                .toLowerCase(java.util.Locale.ROOT);
        while (key.startsWith("#")) {
            key = key.substring(1);
        }
        if (key.isBlank()) {
            return List.of();
        }
        String like = key.replace("\\", "\\\\").replace("%", "\\%")
                .replace("_", "\\_");
        return jdbc.query("SELECT tag_key,display_name,post_count FROM feed_tags"
                        + " WHERE tag_key LIKE ? || '%' ESCAPE '\\'"
                        + " ORDER BY post_count DESC,tag_key LIMIT ?",
                (rs, i) -> new TagView(rs.getString(1), rs.getString(2),
                        rs.getLong(3)),
                like, Math.min(Math.max(size, 1), 20));
    }

    /** Community-scoped hashtag feed — same visibility rules as communityFeed. */
    public FeedPage tagFeed(UUID viewer, UUID communityId, String tagKey,
            String cursor, int size) {
        String key = normalizeTag(tagKey);
        if (key == null) {
            throw bad("INVALID_TAG");
        }
        return communityFeed(viewer, communityId, "LATEST", null, key, cursor,
                size);
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

    public record MediaAttachment(UUID id, String purpose, String mimeType,
            Long durationMs, Long sizeBytes) {
    }

    public record FeedItem(String itemId, String contentType, String sourceModule,
            UUID sourceId, Object author, UUID communityId, Instant publishedAt,
            String title, String body, List<UUID> mediaIds,
            List<MediaAttachment> media, List<String> tags, int commentCount,
            int reactionCount, int shareCount, String viewerReaction,
            boolean viewed, boolean saved, Map<String, Object> payload) {
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
        // Batch media + tags — one query per page, not per post.
        var mediaRows = jdbc.query("SELECT post_id,media_id FROM feed_post_media"
                        + " WHERE post_id IN (" + postPh + ")"
                        + " ORDER BY post_id,sort_order",
                (rs, i) -> Map.of("p", rs.getObject(1, UUID.class),
                        "m", rs.getObject(2, UUID.class)), postIds.toArray());
        var mediaIdsByPost = new LinkedHashMap<UUID, List<UUID>>();
        var allMediaIds = new ArrayList<UUID>();
        for (var r : mediaRows) {
            mediaIdsByPost.computeIfAbsent((UUID) r.get("p"),
                    k -> new ArrayList<>()).add((UUID) r.get("m"));
            allMediaIds.add((UUID) r.get("m"));
        }
        var assetById = new java.util.HashMap<UUID, MediaApi.AssetView>();
        media.assets(allMediaIds).forEach(a -> assetById.put(a.id(), a));
        var tagsByPost = new LinkedHashMap<UUID, List<String>>();
        jdbc.query("SELECT fpt.post_id,ft.display_name FROM feed_post_tags fpt"
                        + " JOIN feed_tags ft ON ft.id=fpt.tag_id"
                        + " WHERE fpt.post_id IN (" + postPh + ")"
                        + " ORDER BY fpt.post_id,fpt.sort_order",
                (rs, i) -> Map.of("p", rs.getObject(1, UUID.class),
                        "t", rs.getString(2)), postIds.toArray())
                .forEach(r -> tagsByPost.computeIfAbsent((UUID) r.get("p"),
                        k -> new ArrayList<>()).add((String) r.get("t")));
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
            var ids = mediaIdsByPost.getOrDefault(p.id(), List.of());
            var attachments = ids.stream().map(assetById::get)
                    .filter(java.util.Objects::nonNull)
                    .map(a -> new MediaAttachment(a.id(), a.purpose(),
                            a.mimeType(), a.durationMs(), a.sizeBytes()))
                    .toList();
            out.add(new FeedItem("FEED_POST:" + p.id(), p.postType(), "feed",
                    p.id(), authors.get(p.authorId()), p.communityId(),
                    p.publishedAt(), p.title(), p.body(), ids, attachments,
                    tagsByPost.getOrDefault(p.id(), List.of()),
                    p.commentCount(), p.reactionCount(), p.shareCount(), reaction,
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

    /** Own-posts page — FeedPage plus a total count for profile stats. */
    public record MinePage(List<FeedItem> items, String nextCursor,
            long total) {
    }

    /**
     * Community feed. mode=FOR_YOU: eligible unseen first, newest first,
     * then seen newest first (view-aware ordering). mode=LATEST: strict
     * reverse-chronological, never reordered by view status. Optional
     * categoryId filters to a country practical category.
     */
    public FeedPage communityFeed(UUID viewer, UUID communityId, String mode,
            UUID categoryId, String cursor, int size) {
        return communityFeed(viewer, communityId, mode, categoryId, null,
                cursor, size);
    }

    public FeedPage communityFeed(UUID viewer, UUID communityId, String mode,
            UUID categoryId, String tag, String cursor, int size) {
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
        if (tag != null) {
            extra += " AND EXISTS (SELECT 1 FROM feed_post_tags fpt"
                    + " JOIN feed_tags ft ON ft.id=fpt.tag_id"
                    + " WHERE fpt.post_id=fp.id AND ft.tag_key=?)";
            args.add(tag.toLowerCase(java.util.Locale.ROOT));
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

    /**
     * Own posts across all communities — powers the profile Posts/Polls/Media
     * tabs. Optional postType and hasMedia filters; strict newest-first
     * keyset on (published_at, id). {@code total} counts the filtered set
     * (cursor excluded) for the profile stats row.
     */
    public MinePage myPosts(UUID viewer, String postType, boolean hasMedia,
            String cursor, int size) {
        if (postType != null && !POST_TYPES.contains(postType)) {
            throw bad("INVALID_POST_TYPE");
        }
        int limit = clamp(size);
        var filterParams = new ArrayList<Object>();
        filterParams.add(viewer);
        String filters = "";
        if (postType != null) {
            filters += " AND fp.post_type=?";
            filterParams.add(postType);
        }
        if (hasMedia) {
            filters += " AND EXISTS (SELECT 1 FROM feed_post_media fpm"
                    + " WHERE fpm.post_id=fp.id)";
        }
        long total = Optional.ofNullable(jdbc.queryForObject(
                "SELECT count(*) FROM feed_posts fp WHERE fp.author_id=?"
                        + " AND fp.status='PUBLISHED' AND fp.deleted_at IS NULL"
                        + filters, Long.class, filterParams.toArray()))
                .orElse(0L);
        var params = new ArrayList<>(filterParams);
        String page = filters;
        if (cursor != null) {
            var c = decode(cursor);
            page += " AND (fp.published_at, fp.id) < (?, ?)";
            params.add(java.sql.Timestamp.from(c.ts()));
            params.add(c.id());
        }
        var rows = jdbc.query("SELECT " + POST_COLS + " FROM feed_posts fp"
                        + " WHERE fp.author_id=? AND fp.status='PUBLISHED'"
                        + " AND fp.deleted_at IS NULL" + page
                        + " ORDER BY fp.published_at DESC, fp.id DESC LIMIT ?",
                FeedService::post, append(params, limit + 1));
        String next = null;
        if (rows.size() > limit) {
            rows = rows.subList(0, limit);
            var last = rows.get(rows.size() - 1);
            next = encode(0, last.publishedAt(), last.id());
        }
        return new MinePage(toItems(viewer, rows), next, total);
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

    /** Record a share event; each share inserts a post_shares row and the
     * share_count trigger keeps feed_posts.share_count in step. Returns the
     * updated count for immediate client display. */
    @Transactional
    public int share(UUID userId, UUID postId, String target) {
        var p = requirePost(postId);
        if (target != null && !SHARE_TARGETS.contains(target)) {
            throw bad("INVALID_SHARE_TARGET");
        }
        requireViewable(userId, p);
        jdbc.update("INSERT INTO post_shares(post_id,user_id,share_target)"
                        + " VALUES(?,?,?)", postId, userId, target);
        Integer count = jdbc.queryForObject(
                "SELECT share_count FROM feed_posts WHERE id=?",
                Integer.class, postId);
        return count == null ? 0 : count;
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
        if (!"COUNTRY".equals(p.scope())) {
            String module = "COMMUNITY_HELP".equals(p.postType()) ? "COMMUNITY_HELP"
                    : "REEL".equals(p.postType()) ? "REELS" : "FEED";
            community.requireModule(viewer, p.communityId(), module);
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
        return createHelpPost(author, communityId, categoryId, kind, title,
                body, expiresAt, null, null);
    }

    @Transactional
    public Map<String, Object> createHelpPost(UUID author, UUID communityId,
            UUID categoryId, String kind, String title, String body,
            Instant expiresAt, List<UUID> mediaIds, List<String> tags) {
        if (!HELP_KINDS.contains(kind)) {
            throw bad("INVALID_HELP_KIND");
        }
        var p = createPost(author, communityId, "COMMUNITY_HELP", title, body,
                null, "COMMUNITY", categoryId, mediaIds, tags);
        jdbc.update("INSERT INTO community_help_posts(post_id,help_kind,"
                        + "expires_at) VALUES(?,?,?)", p.id(), kind,
                expiresAt == null ? null : java.sql.Timestamp.from(expiresAt));
        publish(p.id());
        if ("REQUEST".equals(kind)) {
            community.consumeExtendedAction(author, communityId,
                    "EXTENDED_COMMUNITY_HELP_REQUEST_PUBLISH",
                    "extended-help-request-publish:" + p.id());
        }
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
                normalizedQuestion, null, "COMMUNITY", categoryId, null, null, true);
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

    /** Post detail plus its hashtags and attachment metadata. */
    public record PostDetail(PostRow post, List<String> tags,
            List<MediaAttachment> media, String viewerReaction, boolean saved) {
    }

    public PostDetail postDetail(UUID viewer, UUID id) {
        var p = requirePost(id);
        requireViewable(viewer, p);
        var tags = jdbc.queryForList("SELECT ft.display_name FROM feed_post_tags"
                + " fpt JOIN feed_tags ft ON ft.id=fpt.tag_id"
                + " WHERE fpt.post_id=? ORDER BY fpt.sort_order",
                String.class, id);
        var ids = mediaIds(id);
        var byId = new java.util.HashMap<UUID, MediaApi.AssetView>();
        media.assets(ids).forEach(a -> byId.put(a.id(), a));
        var attachments = ids.stream().map(byId::get)
                .filter(java.util.Objects::nonNull)
                .map(a -> new MediaAttachment(a.id(), a.purpose(), a.mimeType(),
                        a.durationMs(), a.sizeBytes()))
                .toList();
        var viewerReaction = jdbc.query("SELECT reaction_key FROM feed_post_reactions"
                        + " WHERE user_id=? AND post_id=?",
                (rs, i) -> rs.getString(1), viewer, id).stream().findFirst().orElse(null);
        var saved = !jdbc.queryForList("SELECT 1 FROM post_saves"
                + " WHERE user_id=? AND post_id=?", Integer.class, viewer, id).isEmpty();
        return new PostDetail(p, tags, attachments, viewerReaction, saved);
    }

    /**
     * Parent-authorized feed media delivery: the media must be attached to a
     * feed post the viewer can see (publication, membership, block,
     * moderation), then a short-lived URL is issued by the media module.
     */
    public String mediaDownloadUrl(UUID viewer, UUID mediaId) {
        var postIds = jdbc.query("SELECT post_id FROM feed_post_media WHERE media_id=?",
                (rs, i) -> rs.getObject(1, UUID.class), mediaId);
        if (postIds.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "MEDIA_NOT_FOUND");
        }
        // The same owned video may be attached to several posts. A deleted or
        // inaccessible parent must not mask another parent the viewer can see.
        if (postIds.stream().noneMatch(id -> canView(viewer, id))) {
            throw forbidden("MEDIA_NOT_ACCESSIBLE");
        }
        return media.authorizedDownloadUrl(mediaId);
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
