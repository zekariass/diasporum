package com.diasporum.backend.billing.internal.application;

import com.diasporum.backend.billing.internal.infrastructure.persistence.BillingPurchaseRepository;
import com.diasporum.backend.notifications.NotificationsApi;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Prepaid subscription lifecycle jobs.
 *
 * <p>Both operations are idempotent: rows are claimed with conditional status
 * and flag UPDATEs, so overlapping runs are safe. RECURRING subscriptions are
 * deliberately out of scope — PAST_DUE and dunning belong to provider webhooks,
 * which no adapter implements yet.
 *
 * <p>The project schedules work with Spring {@code @Scheduled} rather than
 * Quartz: {@code spring-boot-starter-quartz} is on the classpath but unused,
 * and {@code @EnableScheduling} is already active, so this follows the
 * existing worker pattern (see {@code VehicleExpiryWorker}).
 */
@Component
public class BillingSubscriptionJobs {

    private static final Logger log = LoggerFactory.getLogger(BillingSubscriptionJobs.class);
    private static final int REMINDER_BATCH = 200;

    private final BillingPurchaseRepository purchases;
    private final BillingSubscriptionService subscriptions;
    private final NotificationsApi notifications;
    private final int reminderLeadDays;

    public BillingSubscriptionJobs(BillingPurchaseRepository purchases,
            BillingSubscriptionService subscriptions, NotificationsApi notifications,
            @Value("${diasporum.billing.renewal-reminder-lead:P7D}") Duration reminderLead) {
        this.purchases = purchases;
        this.subscriptions = subscriptions;
        this.notifications = notifications;
        this.reminderLeadDays = Math.max(1, (int) reminderLead.toDays());
    }

    /**
     * Expires prepaid terms whose period has elapsed. The entitlement resolver
     * only recognizes live statuses, so an expired subscriber falls back to the
     * FREE plan without any entitlement rows being touched.
     */
    @Scheduled(fixedDelayString = "${diasporum.billing.expiry-interval:PT15M}")
    public int expirePrepaidTerms() {
        int expired = subscriptions.expireElapsedPrepaidTerms();
        if (expired > 0) {
            log.info("Expired {} prepaid billing subscriptions", expired);
        }
        return expired;
    }

    /**
     * Reminds subscribers whose term is ending and will not renew itself:
     * prepaid terms, and recurring subscriptions already set to cancel at
     * period end. Sent at most once per term — the reminder flag is claimed
     * before the notification and cleared when a new term is purchased.
     */
    @Scheduled(fixedDelayString = "${diasporum.billing.renewal-reminder-interval:PT6H}")
    public int sendRenewalReminders() {
        var due = purchases.remindableSubscriptions(reminderLeadDays, REMINDER_BATCH);
        int sent = 0;
        for (var subscription : due) {
            // Claim first: a failed send must not be retried forever, and a
            // concurrent run must not send twice.
            if (purchases.markReminderSent(subscription.id()) == 0) {
                continue;
            }
            try {
                notifications.notify(subscription.userId(), "BILLING_RENEWAL_REMINDER",
                        "Your subscription is ending soon",
                        "Your " + subscription.planKey() + " subscription ends on "
                                + subscription.currentPeriodEnd()
                                + ". Renew to keep your benefits.",
                        "BILLING_SUBSCRIPTION", subscription.id(),
                        "billing-renewal:" + subscription.id() + ":"
                                + subscription.currentPeriodEnd());
                sent++;
            } catch (RuntimeException e) {
                log.warn("Renewal reminder failed for subscription {}: {}",
                        subscription.id(), e.getMessage());
            }
        }
        if (sent > 0) {
            log.info("Sent {} subscription renewal reminders", sent);
        }
        return sent;
    }
}
