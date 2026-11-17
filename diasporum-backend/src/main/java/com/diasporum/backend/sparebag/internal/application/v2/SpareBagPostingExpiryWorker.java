package com.diasporum.backend.sparebag.internal.application.v2;

import com.diasporum.backend.notifications.NotificationsApi;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.Touched;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.JourneyRepository;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.MatchRequestRepository;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.SenderRequestRepository;
import java.util.List;
import java.util.function.Supplier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Expiry for the v10.15 model, parallel to (and independent of) the legacy
 * {@code SpareBagExpiryWorker}. Every step is one guarded UPDATE in its own
 * transaction, so re-runs and concurrent runs change nothing twice; owner
 * notifications carry dedupe keys so they are not repeated either.
 * <ol>
 * <li>journeys (PENDING_REVIEW/PUBLISHED/PAUSED) past closes_at or past their
 * last travel date -&gt; EXPIRED</li>
 * <li>sender requests (PENDING_REVIEW/PUBLISHED/PAUSED) past closes_at -&gt;
 * EXPIRED (MATCHED requests never expire)</li>
 * <li>PENDING match requests whose request or journey is no longer matchable
 * -&gt; EXPIRED</li>
 * <li>open moderation_queue rows for content no longer PENDING_REVIEW -&gt;
 * AUTO_RESOLVED</li>
 * </ol>
 */
@Component
public class SpareBagPostingExpiryWorker {

    private final JourneyRepository journeys;
    private final SenderRequestRepository requests;
    private final MatchRequestRepository matches;
    private final SpareBagModeration moderation;
    private final NotificationsApi notifications;
    private final TransactionTemplate tx;

    public SpareBagPostingExpiryWorker(JourneyRepository journeys,
            SenderRequestRepository requests, MatchRequestRepository matches,
            SpareBagModeration moderation, NotificationsApi notifications,
            PlatformTransactionManager transactionManager) {
        this.journeys = journeys;
        this.requests = requests;
        this.matches = matches;
        this.moderation = moderation;
        this.notifications = notifications;
        this.tx = new TransactionTemplate(transactionManager);
    }

    public record RunResult(int journeysExpired, int requestsExpired, int matchesExpired,
            int queueRowsResolved) {
    }

    @Scheduled(fixedDelayString = "${diasporum.spare-bag.v2.expiry-interval:PT15M}")
    public RunResult expire() {
        int journeyCount = step(() -> notifyAll(journeys.expire(),
                SpareBagModeration.TRAVELLER_JOURNEY, "Journey expired",
                "Your Spare Bag journey has expired."));
        int requestCount = step(() -> notifyAll(requests.expire(),
                SpareBagModeration.SENDER_REQUEST, "Request expired",
                "Your Spare Bag request has expired."));
        int matchCount = step(() -> {
            List<Touched> expired = matches.expireStale();
            for (Touched t : expired) {
                notifications.notify(t.ownerUserId(), "SPARE_BAG_CONTACT_REQUEST",
                        "Match request expired",
                        "The request or journey is no longer available.",
                        "SPARE_BAG_MATCH_REQUEST", t.id(), "spare-bag-match-expired:" + t.id());
            }
            return expired.size();
        });
        int queueCount = step(moderation::autoResolveStale);
        return new RunResult(journeyCount, requestCount, matchCount, queueCount);
    }

    private int notifyAll(List<Touched> expired, String targetType, String title,
            String body) {
        for (Touched t : expired) {
            notifications.notify(t.ownerUserId(), "SPARE_BAG_LISTING_UPDATE", title, body,
                    targetType, t.id(), "spare-bag-v2-expired:" + t.id());
        }
        return expired.size();
    }

    private int step(Supplier<Integer> work) {
        Integer n = tx.execute(status -> work.get());
        return n == null ? 0 : n;
    }
}
