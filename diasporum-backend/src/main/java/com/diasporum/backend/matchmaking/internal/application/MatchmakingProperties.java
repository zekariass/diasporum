package com.diasporum.backend.matchmaking.internal.application;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Administrator-tunable matchmaking limits. {@code diasporum.matchmaking.max-
 * profile-photos} caps the gallery size; changing it requires no code change or
 * migration — profiles already above a lowered limit keep their photos but
 * cannot add more until they are within the limit.
 */
@ConfigurationProperties(prefix = "diasporum.matchmaking")
public record MatchmakingProperties(int maxProfilePhotos) {

    public MatchmakingProperties() {
        this(6);
    }

    public MatchmakingProperties {
        if (maxProfilePhotos < 1 || maxProfilePhotos > 20) {
            throw new IllegalArgumentException(
                    "diasporum.matchmaking.max-profile-photos must be between 1 and 20");
        }
    }
}
