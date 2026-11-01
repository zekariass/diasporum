package com.diasporum.backend.messaging.internal.realtime;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Scheduled trigger for the transactional outbox. Split from
 * {@link OutboxDispatcher} so tests (and maintenance windows) can disable the
 * polling loop via {@code diasporum.messaging.outbox.scheduling-enabled=false}
 * while keeping the dispatcher bean available for direct invocation.
 */
@Component
@ConditionalOnProperty(
        name = "diasporum.messaging.outbox.scheduling-enabled",
        havingValue = "true", matchIfMissing = true)
class OutboxScheduler {

    private final OutboxDispatcher dispatcher;

    OutboxScheduler(OutboxDispatcher dispatcher) {
        this.dispatcher = dispatcher;
    }

    @Scheduled(fixedDelayString =
            "${diasporum.messaging.outbox.poll-interval:PT2S}")
    void poll() {
        dispatcher.dispatch();
    }
}
