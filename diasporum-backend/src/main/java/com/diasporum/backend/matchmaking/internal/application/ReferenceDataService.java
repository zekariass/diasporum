package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ReferenceDataView;
import com.diasporum.backend.matchmaking.internal.infrastructure.persistence.MatchmakingRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Active form catalogs and the caller's non-coordinate private address choices. */
@Service
public class ReferenceDataService {

    private final MatchmakingRepository repository;

    public ReferenceDataService(MatchmakingRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public ReferenceDataView referenceData(UUID actor) {
        return repository.referenceData(actor);
    }
}
