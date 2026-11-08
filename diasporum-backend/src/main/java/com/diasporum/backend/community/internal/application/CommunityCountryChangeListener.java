package com.diasporum.backend.community.internal.application;

import com.diasporum.backend.identity.IdentityApi.CountriesChangedEvent;
import java.util.UUID;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Reconciles community context synchronously with a completed profile country change. */
@Component
public class CommunityCountryChangeListener {

    private final JdbcTemplate jdbc;
    private final CommunityService communities;

    public CommunityCountryChangeListener(JdbcTemplate jdbc, CommunityService communities) {
        this.jdbc = jdbc;
        this.communities = communities;
    }

    @EventListener
    @Transactional
    public void onCountriesChanged(CountriesChangedEvent event) {
        UUID userId = event.profileId();
        if (!java.util.Objects.equals(event.previousOriginCountryId(), event.originCountryId())) {
            jdbc.update("UPDATE community_memberships m SET status='LEFT',left_at=now(),"
                    + "updated_at=now() FROM communities c WHERE m.community_id=c.id "
                    + "AND m.user_id=? AND m.status='ACTIVE' AND c.origin_country_id<>?",
                    userId, event.originCountryId());
        }
        // join() reactivates a prior LEFT membership and completeOnboarding
        // atomically stores both default and active context. Missing/inactive
        // catalogue configuration aborts the profile update without data loss.
        communities.completeOnboarding(userId);
    }
}
