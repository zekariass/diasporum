package com.diasporum.backend.media;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Public API of the media module: asset metadata, readiness, and authorized
 * download URLs. Other modules consume this interface only — never
 * {@code media.internal.*}. No R2 keys, buckets, or SDK types leak here.
 */
public interface MediaApi {

    /** Public-safe metadata for one asset. */
    Optional<AssetView> asset(UUID assetId);

    /** Batch metadata — one query for attachment lists. */
    List<AssetView> assets(java.util.Collection<UUID> assetIds);

    /** True if the asset is verified READY — safe to attach. */
    boolean isReady(UUID assetId);

    /** True if the asset exists and belongs to {@code ownerId} with the
     * expected purpose — for cross-module attachment validation. */
    boolean validateForAttach(UUID assetId, UUID ownerId, String purpose);

    /**
     * Short-lived presigned GET URL for an authorized consumer module.
     * The caller owns the parent-resource authorization decision
     * (e.g. "can this user see this post").
     */
    String authorizedDownloadUrl(UUID assetId);

    /** Batch variant for parent-authorized list and detail enrichment. */
    Map<UUID, String> authorizedDownloadUrls(Collection<UUID> assetIds);

    /**
     * Server-side blurred derivative of a READY image asset, stored under the
     * given purpose and owned by the source asset's owner. Idempotent — the
     * same source always resolves to the same derivative asset. Empty when the
     * source is not a READY image or derivation is unavailable.
     */
    Optional<UUID> blurredImageDerivative(UUID sourceAssetId, String purpose);

    /** Delete after the consuming module has detached its reference. */
    void deleteAsset(UUID requesterId, UUID assetId);

    record AssetView(UUID id, UUID ownerId, String purpose, String status,
            String mimeType, Long sizeBytes, String detectedMimeType,
            Long durationMs) {
    }
}
