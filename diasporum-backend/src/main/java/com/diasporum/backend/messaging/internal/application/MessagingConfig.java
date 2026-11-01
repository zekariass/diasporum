package com.diasporum.backend.messaging.internal.application;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** Messaging module wiring — binds {@link MessagingProperties}. */
@Configuration
@EnableConfigurationProperties(MessagingProperties.class)
class MessagingConfig {
}
