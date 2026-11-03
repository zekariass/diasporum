package com.diasporum.backend.servicemarketplace.internal.application;

import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceRequestRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Idempotent lifecycle expiry for open and paused service requests. */
@Component
public class ServiceRequestExpiryWorker {
    private final ServiceRequestRepository repository;

    public ServiceRequestExpiryWorker(ServiceRequestRepository repository) {
        this.repository = repository;
    }

    @Scheduled(fixedDelayString = "${diasporum.service-marketplace.expiry-interval:PT15M}")
    @Transactional
    public int expire() {
        return repository.expireRequests();
    }
}
