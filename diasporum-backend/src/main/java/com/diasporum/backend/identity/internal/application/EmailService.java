package com.diasporum.backend.identity.internal.application;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * Email delivery abstraction. Exactly one implementation is active per
 * environment, selected by {@code diasporum.mail.provider}:
 * {@code local} → {@link LocalEmailService} (log-only, dev/tests),
 * {@code smtp} → {@link SmtpEmailService}. No other value (or none) means no
 * bean — the application fails at startup rather than silently degrading to
 * log-only delivery.
 */
public interface EmailService {
    void sendVerification(String to, String token);
    void sendPasswordReset(String to, String token);
    void sendSecurityNotification(String to, String subject, String body);
}

@Service
@ConditionalOnProperty(name = "diasporum.mail.provider", havingValue = "local")
class LocalEmailService implements EmailService {
    private static final Logger log = LoggerFactory.getLogger(LocalEmailService.class);
    @Override public void sendVerification(String to, String token) {
        log.info("[EMAIL] Verification to {}: /verify-email?token={}", to, token);
    }
    @Override public void sendPasswordReset(String to, String token) {
        log.info("[EMAIL] Password reset to {}: /reset-password?token={}", to, token);
    }
    @Override public void sendSecurityNotification(String to, String subject, String body) {
        log.info("[EMAIL] {} to {}: {}", subject, to, body);
    }
}
