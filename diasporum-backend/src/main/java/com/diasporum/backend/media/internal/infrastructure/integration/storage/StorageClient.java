package com.diasporum.backend.media.internal.infrastructure.integration.storage;

/** Internal abstraction over object storage (Cloudflare R2 via S3 API).
 * Application code never sees AWS SDK types. */
public interface StorageClient {

    /** Short-lived presigned PUT URL for direct client upload. */
    String presignPut(String key, String contentType, java.time.Duration ttl);

    /** Short-lived presigned GET URL for authorized download. */
    String presignGet(String key, java.time.Duration ttl);

    /** Actual stored object metadata, or empty if missing. */
    java.util.Optional<ObjectMeta> head(String key);

    void delete(String key);

    record ObjectMeta(long sizeBytes, String contentType) {
    }
}
