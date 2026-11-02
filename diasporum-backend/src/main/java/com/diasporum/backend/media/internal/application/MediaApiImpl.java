package com.diasporum.backend.media.internal.application;

import com.diasporum.backend.media.MediaApi;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Delegating implementation of {@link MediaApi}. */
@Service
public class MediaApiImpl implements MediaApi {

    private final MediaService service;

    public MediaApiImpl(MediaService service) {
        this.service = service;
    }

    @Override
    public Optional<AssetView> asset(UUID assetId) {
        return service.asset(assetId).map(MediaApiImpl::toApi);
    }

    @Override
    public List<AssetView> assets(java.util.Collection<UUID> assetIds) {
        return service.assets(assetIds).stream().map(MediaApiImpl::toApi).toList();
    }

    @Override
    public boolean isReady(UUID assetId) {
        return service.asset(assetId).map(a -> "READY".equals(a.status()))
                .orElse(false);
    }

    @Override
    public boolean validateForAttach(UUID assetId, UUID ownerId, String purpose) {
        return service.asset(assetId)
                .map(a -> a.ownerId().equals(ownerId)
                        && a.purpose().equals(purpose)
                        && "READY".equals(a.status()))
                .orElse(false);
    }

    @Override
    public String authorizedDownloadUrl(UUID assetId) {
        return service.authorizedDownloadUrl(assetId);
    }

    @Override
    public Map<UUID, String> authorizedDownloadUrls(Collection<UUID> assetIds) {
        return service.authorizedDownloadUrls(assetIds);
    }

    @Override
    public void deleteAsset(UUID requesterId, UUID assetId) {
        service.delete(requesterId, assetId);
    }

    private static AssetView toApi(MediaService.AssetView v) {
        return new AssetView(v.id(), v.ownerId(), v.purpose(), v.status(),
                v.mimeType(), v.sizeBytes(), v.detectedMimeType());
    }
}
