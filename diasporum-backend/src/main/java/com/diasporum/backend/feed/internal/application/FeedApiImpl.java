package com.diasporum.backend.feed.internal.application;

import com.diasporum.backend.feed.FeedApi;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Delegating implementation of {@link FeedApi}. */
@Service
public class FeedApiImpl implements FeedApi {

    private final FeedService service;

    public FeedApiImpl(FeedService service) {
        this.service = service;
    }

    @Override
    public Optional<PostView> post(UUID postId) {
        return service.apiPost(postId);
    }

    @Override
    public List<PostView> posts(java.util.Collection<UUID> postIds) {
        return service.apiPosts(postIds);
    }

    @Override
    public boolean canView(UUID viewerId, UUID postId) {
        return service.canView(viewerId, postId);
    }

    @Override
    public int commentCount(UUID postId) {
        return service.commentCount(postId);
    }

    @Override
    public int reactionCount(UUID postId) {
        return service.reactionCount(postId);
    }

    @Override
    public java.util.Optional<String> helpStatus(UUID postId) {
        try {
            return java.util.Optional.ofNullable(
                    (String) service.helpStatus(postId).get("helpStatus"));
        } catch (org.springframework.web.server.ResponseStatusException e) {
            return java.util.Optional.empty();
        }
    }
}
