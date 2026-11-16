package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfilePhotoListView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfilePhotoRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfilePhotoView;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import com.diasporum.backend.media.MediaApi;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owner-side gallery management. All mutations run in one transaction; the
 * configured limit ({@code diasporum.matchmaking.max-profile-photos}) is
 * enforced here — never by the client. Media ownership, purpose and READY
 * status are validated through {@link MediaApi} and the
 * {@code validate_matchmaking_profile_photo} trigger.
 */
@Service
@EnableConfigurationProperties(MatchmakingProperties.class)
public class MatchmakingPhotoService {

    private static final Set<String> BLOCKED_STATUSES = Set.of("SUSPENDED", "DELETED");

    private final MatchmakingRepository repository;
    private final MatchmakingAccess access;
    private final MediaApi media;
    private final MatchmakingProperties properties;

    public MatchmakingPhotoService(MatchmakingRepository repository,
            MatchmakingAccess access, MediaApi media,
            MatchmakingProperties properties) {
        this.repository = repository;
        this.access = access;
        this.media = media;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public ProfilePhotoListView photos(UUID actor) {
        access.requireAdult(actor);
        repository.profile(actor).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND"));
        return view(actor);
    }

    @Transactional
    public ProfilePhotoListView add(UUID actor, UUID mediaId) {
        access.requireAdult(actor);
        var profile = repository.profile(actor).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND"));
        if (BLOCKED_STATUSES.contains(profile.status())) {
            throw MatchmakingSupport.conflict("MATCHMAKING_PROFILE_NOT_EDITABLE");
        }
        if (mediaId == null) {
            throw MatchmakingSupport.bad("INVALID_MATCHMAKING_MEDIA");
        }
        if (repository.photoCount(actor) >= properties.maxProfilePhotos()) {
            throw MatchmakingSupport.conflict("MATCHMAKING_PHOTO_LIMIT_REACHED");
        }
        if (!media.validateForAttach(mediaId, actor, "MATCHMAKING_PROFILE_PHOTO")
                || !media.isReady(mediaId)) {
            throw MatchmakingSupport.bad("INVALID_MATCHMAKING_MEDIA");
        }
        if (repository.photos(actor).stream()
                .anyMatch(p -> p.mediaId().equals(mediaId))) {
            throw MatchmakingSupport.conflict("MATCHMAKING_PHOTO_ALREADY_ATTACHED");
        }
        boolean first = repository.photoCount(actor) == 0;
        repository.insertPhoto(actor, mediaId, first);
        // Eagerly produce the blurred derivative so restricted views are fast;
        // derivation failures degrade lazily at read time instead of blocking
        // the owner's upload.
        media.blurredImageDerivative(mediaId, "MATCHMAKING_PROFILE_BLURRED");
        return view(actor);
    }

    @Transactional
    public ProfilePhotoListView setPrimary(UUID actor, UUID photoId) {
        access.requireAdult(actor);
        repository.photo(actor, photoId).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_PHOTO_NOT_FOUND"));
        repository.setPrimaryPhoto(actor, photoId);
        return view(actor);
    }

    @Transactional
    public ProfilePhotoListView reorder(UUID actor, List<UUID> photoIds) {
        access.requireAdult(actor);
        var existing = repository.photos(actor);
        var existingIds = existing.stream().map(ProfilePhotoRow::id)
                .collect(Collectors.toSet());
        if (photoIds == null || photoIds.size() != existing.size()
                || !existingIds.containsAll(photoIds)
                || photoIds.size() != Set.copyOf(photoIds).size()) {
            throw MatchmakingSupport.bad("INVALID_MATCHMAKING_PHOTO_ORDER");
        }
        repository.reorderPhotos(actor, photoIds);
        return view(actor);
    }

    @Transactional
    public ProfilePhotoListView delete(UUID actor, UUID photoId) {
        access.requireAdult(actor);
        var profile = repository.profile(actor).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_PROFILE_NOT_FOUND"));
        repository.photo(actor, photoId).orElseThrow(
                () -> MatchmakingSupport.notFound("MATCHMAKING_PHOTO_NOT_FOUND"));
        // The media object stays under the owner's account; only the gallery
        // attachment is removed. The AFTER DELETE trigger promotes the next
        // photo when the primary is deleted.
        repository.deletePhoto(actor, photoId);
        if ("ACTIVE".equals(profile.status()) && !repository.hasReadyPrimaryPhoto(actor)) {
            throw MatchmakingSupport.conflict("MATCHMAKING_PRIMARY_PHOTO_REQUIRED");
        }
        return view(actor);
    }

    private ProfilePhotoListView view(UUID actor) {
        var rows = repository.photos(actor);
        // Only READY assets are presignable; photos still processing return a
        // null url so the client can show its pending state.
        var readyIds = media.assets(rows.stream().map(ProfilePhotoRow::mediaId).toList())
                .stream().filter(a -> "READY".equals(a.status()))
                .map(MediaApi.AssetView::id).toList();
        var urls = media.authorizedDownloadUrls(readyIds);
        var views = rows.stream()
                .map(row -> new ProfilePhotoView(row.id(), row.mediaId(),
                        row.sortOrder(), row.isPrimary(), urls.get(row.mediaId())))
                .toList();
        return new ProfilePhotoListView(views, properties.maxProfilePhotos());
    }
}
