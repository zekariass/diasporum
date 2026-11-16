package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ReferenceDataView;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import java.util.UUID;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Active form catalogs and the caller's non-coordinate private address choices. */
@Service
@EnableConfigurationProperties(MatchmakingProperties.class)
public class ReferenceDataService {

    private final MatchmakingRepository repository;
    private final MatchmakingAccess access;
    private final MatchmakingProperties properties;

    public ReferenceDataService(MatchmakingRepository repository, MatchmakingAccess access,
            MatchmakingProperties properties) {
        this.repository = repository;
        this.access = access;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public ReferenceDataView referenceData(UUID actor) {
        access.requireAdult(actor);
        var data = repository.referenceData(actor);
        return new ReferenceDataView(data.genders(), data.religions(), data.countries(),
                data.languages(), data.addresses(), MatchmakingProfileService.profileOptions(),
                properties.maxProfilePhotos());
    }
}
