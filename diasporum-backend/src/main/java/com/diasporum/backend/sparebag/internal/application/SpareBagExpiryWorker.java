package com.diasporum.backend.sparebag.internal.application;

import com.diasporum.backend.sparebag.internal.infrastructure.persistence.SpareBagListingRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Idempotent expiry of stale published/paused listings and pending contacts. */
@Component
public class SpareBagExpiryWorker {

    private final SpareBagListingRepository listings;
    private final SpareBagContactService contacts;

    public SpareBagExpiryWorker(SpareBagListingRepository listings,
            SpareBagContactService contacts) {
        this.listings = listings;
        this.contacts = contacts;
    }

    @Scheduled(fixedDelayString = "${diasporum.spare-bag.expiry-interval:PT15M}")
    @Transactional
    public void expire() {
        listings.expireListings();
        contacts.expirePending();
    }
}
