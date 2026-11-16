package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfilePhotoRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PublicPhotoView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PublicProfileRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PublicProfileView;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import com.diasporum.backend.media.MediaApi;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Central viewer-relationship privacy policy. This is the only place that
 * decides what a viewer may see of a target matchmaking profile:
 *
 * <ul>
 *   <li>{@code SELF} / {@code ACTIVE_MATCH} — real display name and original
 *       renditions for the whole gallery.</li>
 *   <li>{@code INCOMING_LIKE} — the target sent the viewer an active LIKE: the
 *       primary photo is revealed (original rendition), the rest of the
 *       gallery stays blurred when the owner blurs; name follows
 *       {@code hide_name_until_match}.</li>
 *   <li>{@code DISCOVERY} — normal browsing: blurred renditions when
 *       {@code blur_photos_until_match} is set, the anonymous alias when
 *       {@code hide_name_until_match} is set.</li>
 * </ul>
 *
 * Original media ids and object keys are never exposed; URLs are presigned
 * against the specific authorised rendition only.
 */
@Component
public class MatchmakingProfileVisibilityService {

    /** Relationship between the viewer and the profile owner. */
    public enum Relationship {
        SELF, ACTIVE_MATCH, INCOMING_LIKE, DISCOVERY
    }

    private final MatchmakingRepository repository;
    private final MediaApi media;

    public MatchmakingProfileVisibilityService(MatchmakingRepository repository,
            MediaApi media) {
        this.repository = repository;
        this.media = media;
    }

    /** Directional relationship used for resolution. Caller enforces that a
     * block in either direction never reaches this point. */
    public Relationship relationship(UUID viewer, UUID owner) {
        if (viewer.equals(owner)) {
            return Relationship.SELF;
        }
        if (repository.activeMatchForPair(viewer, owner)) {
            return Relationship.ACTIVE_MATCH;
        }
        // Target → viewer active LIKE = the viewer's incoming-like queue.
        if (repository.swipe(owner, viewer).filter(
                s -> "ACTIVE".equals(s.status()) && "LIKE".equals(s.action())).isPresent()) {
            return Relationship.INCOMING_LIKE;
        }
        return Relationship.DISCOVERY;
    }

    /** Resolve one already-fetched row for {@code viewer}. */
    public PublicProfileView resolve(UUID viewer, PublicProfileRow row) {
        return resolve(viewer, row, repository.photos(row.userId()));
    }

    /** Batch resolution for page projections — one photo query for the page. */
    public List<PublicProfileView> resolveAll(UUID viewer,
            List<PublicProfileRow> rows) {
        Map<UUID, List<ProfilePhotoRow>> photos = repository.photosForUsers(
                rows.stream().map(PublicProfileRow::userId).toList());
        return rows.stream()
                .map(row -> resolve(viewer, row,
                        photos.getOrDefault(row.userId(), List.of())))
                .toList();
    }

    private PublicProfileView resolve(UUID viewer, PublicProfileRow row,
            List<ProfilePhotoRow> photos) {
        Relationship rel = relationship(viewer, row.userId());
        boolean matched = rel == Relationship.ACTIVE_MATCH || rel == Relationship.SELF;
        boolean revealName = matched || !row.hideNameUntilMatch();
        String displayName = revealName ? row.displayName() : row.anonymousAlias();
        var readyIds = media.assets(photos.stream().map(ProfilePhotoRow::mediaId).toList())
                .stream().filter(a -> "READY".equals(a.status()))
                .map(MediaApi.AssetView::id).collect(java.util.stream.Collectors.toSet());
        List<PublicPhotoView> resolved = new ArrayList<>(photos.size());
        for (ProfilePhotoRow photo : photos) {
            if (!readyIds.contains(photo.mediaId())) {
                continue; // not yet processed — never expose non-ready media
            }
            boolean reveal = switch (rel) {
                case SELF, ACTIVE_MATCH -> true;
                case INCOMING_LIKE -> photo.isPrimary() || !row.blurPhotosUntilMatch();
                case DISCOVERY -> !row.blurPhotosUntilMatch();
            };
            String url = reveal ? originalUrl(photo.mediaId()) : blurredUrl(photo.mediaId());
            if (url == null) {
                continue; // no authorised rendition available — omit entirely
            }
            resolved.add(new PublicPhotoView(url, photo.isPrimary(), photo.sortOrder(),
                    reveal ? "ORIGINAL" : "BLURRED"));
        }
        String primaryUrl = resolved.stream().filter(PublicPhotoView::isPrimary)
                .map(PublicPhotoView::url).findFirst()
                .orElse(resolved.isEmpty() ? null : resolved.get(0).url());
        return new PublicProfileView(row.userId(), displayName, primaryUrl, resolved,
                revealName, row.genderKey(), row.age(), row.nationalityCountryId(),
                row.religionId(), row.educationLevel(), row.occupation(),
                row.relationshipIntention(), row.maritalStatus(), row.hasChildren(),
                row.wantsChildren(), row.smoking(), row.drinking(), row.activityLevel(),
                row.heightCm(), row.marriageTimeline(), row.longDistanceRelationship(),
                row.religionImportance(), row.willingToRelocate(), row.verificationStatus(),
                row.bio(), row.publicLocation(), row.interests(), row.languages());
    }

    private String originalUrl(UUID mediaId) {
        return media.authorizedDownloadUrl(mediaId);
    }

    /**
     * Server-side blurred derivative URL, or {@code null} when the rendition
     * cannot be produced — never falls back to the original.
     */
    private String blurredUrl(UUID mediaId) {
        return media.blurredImageDerivative(mediaId, "MATCHMAKING_PROFILE_BLURRED")
                .map(media::authorizedDownloadUrl).orElse(null);
    }
}
