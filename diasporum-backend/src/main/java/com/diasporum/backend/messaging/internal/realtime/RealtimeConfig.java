package com.diasporum.backend.messaging.internal.realtime;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Realtime wiring — binds properties and enables the outbox scheduler. */
@Configuration
@EnableScheduling
@EnableConfigurationProperties({AblyProperties.class, OutboxProperties.class})
class RealtimeConfig {
}
