package com.diasporum.backend.identity.internal.application;

import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

/**
 * Production email delivery over SMTP (spring-boot-starter-mail /
 * JavaMailSender). Activated only when {@code diasporum.mail.provider=smtp}
 * and fails startup when the SMTP host is not configured — a production
 * deployment can never silently degrade to log-only delivery.
 *
 * Security: verification and password-reset tokens are only placed in the
 * email body — they are never written to logs.
 */
@Service
@ConditionalOnProperty(name = "diasporum.mail.provider", havingValue = "smtp")
class SmtpEmailService implements EmailService {

    private static final Logger log = LoggerFactory.getLogger(SmtpEmailService.class);

    private final JavaMailSender mailSender;
    private final String from;
    private final String appBaseUrl;

    SmtpEmailService(JavaMailSender mailSender,
            @Value("${diasporum.mail.from:no-reply@diasporum.local}") String from,
            @Value("${diasporum.mail.app-base-url}") String appBaseUrl,
            @Value("${spring.mail.host:}") String smtpHost) {
        if (smtpHost.isBlank()) {
            throw new IllegalStateException(
                "diasporum.mail.provider=smtp requires an SMTP host — set"
                + " DIASPORUM_SMTP_HOST (and credentials/TLS settings as needed).");
        }
        this.mailSender = mailSender;
        this.from = from;
        this.appBaseUrl = appBaseUrl.endsWith("/")
                ? appBaseUrl.substring(0, appBaseUrl.length() - 1) : appBaseUrl;
    }

    @Override
    public void sendVerification(String to, String token) {
        String link = appBaseUrl + "/verify-email?token=" + token;
        send(to, "Verify your Diasporum email",
            "Welcome to Diasporum.\n\n"
            + "Confirm this email address to activate your account:\n\n"
            + link + "\n\n"
            + "This link expires. If you did not create an account, ignore this"
            + " message.");
        log.info("Verification email sent to {}", to);
    }

    @Override
    public void sendPasswordReset(String to, String token) {
        String link = appBaseUrl + "/reset-password?token=" + token;
        send(to, "Reset your Diasporum password",
            "A password reset was requested for your Diasporum account.\n\n"
            + "Set a new password here:\n\n"
            + link + "\n\n"
            + "This link expires. If you did not request a reset, ignore this"
            + " message — your password is unchanged.");
        log.info("Password-reset email sent to {}", to);
    }

    @Override
    public void sendSecurityNotification(String to, String subject, String body) {
        send(to, subject, body);
        log.info("Security notification '{}' sent to {}", subject, to);
    }

    private void send(String to, String subject, String text) {
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, "UTF-8");
            helper.setFrom(from);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(text);
            mailSender.send(message);
        } catch (Exception e) {
            // Recipient + subject only — never log message bodies (they carry
            // one-time tokens).
            throw new IllegalStateException(
                "Email delivery failed (subject='" + subject + "', to=" + to + ")", e);
        }
    }
}
