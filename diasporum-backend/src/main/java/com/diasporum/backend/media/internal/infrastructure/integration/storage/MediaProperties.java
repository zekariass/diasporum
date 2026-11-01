package com.diasporum.backend.media.internal.infrastructure.integration.storage;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Cloudflare R2 settings — env-driven, no hardcoded credentials.
 * The storage bean is created only when {@code enabled=true} AND
 * {@link #configured()} passes — empty env placeholders never activate it.
 */
@ConfigurationProperties(prefix = "diasporum.media.r2")
public record MediaProperties(boolean enabled, String endpoint,
        String accessKeyId, String secretAccessKey, String bucket,
        String region, Duration uploadUrlTtl, Duration downloadUrlTtl,
        Duration sessionTtl, long maxUploadBytes) {

    public MediaProperties {
        if (isBlank(region)) {
            region = "auto";                        // R2's required S3 region
        }
        if (uploadUrlTtl == null) {
            uploadUrlTtl = Duration.ofMinutes(15);
        }
        if (downloadUrlTtl == null) {
            downloadUrlTtl = Duration.ofMinutes(2);
        }
        if (sessionTtl == null) {
            sessionTtl = Duration.ofMinutes(15);    // approved upload-session expiry
        }
        if (maxUploadBytes <= 0) {
            maxUploadBytes = 25L * 1024 * 1024;     // approved 25 MiB limit
        }
    }

    /** True only when every required R2 value is non-blank — empty
     * placeholders or unset env vars return false instead of activating. */
    public boolean configured() {
        return !isBlank(endpoint) && !isBlank(accessKeyId)
                && !isBlank(secretAccessKey) && !isBlank(bucket);
    }

    private static boolean isBlank(String v) {
        return v == null || v.isBlank();
    }
}
