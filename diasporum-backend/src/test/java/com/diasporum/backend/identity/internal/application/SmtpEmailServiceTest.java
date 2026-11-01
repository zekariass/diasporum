package com.diasporum.backend.identity.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSender;

/**
 * SMTP adapter delivery semantics: correct recipient/subject/link content and
 * startup failure when the SMTP host is missing. Uses a stubbed
 * {@link JavaMailSender} — no network required.
 */
class SmtpEmailServiceTest {

    private static final String FROM = "no-reply@diasporum.test";
    private static final String BASE = "https://app.diasporum.test";

    private record Fixture(SmtpEmailService service, MimeMessage captured,
            JavaMailSender sender) {}

    private Fixture fixture() {
        JavaMailSender sender = mock(JavaMailSender.class);
        MimeMessage message = new MimeMessage(Session.getInstance(new Properties()));
        when(sender.createMimeMessage()).thenReturn(message);
        return new Fixture(
                new SmtpEmailService(sender, FROM, BASE, "smtp.diasporum.test"),
                message, sender);
    }

    @Test
    void verificationEmailContainsConfirmLinkWithToken() throws Exception {
        var f = fixture();
        f.service().sendVerification("new@user.test", "VERIFY-TOKEN-123");
        verify(f.sender()).send(f.captured());
        var rcpts = f.captured().getRecipients(MimeMessage.RecipientType.TO);
        assertEquals("new@user.test", ((InternetAddress) rcpts[0]).getAddress());
        assertEquals("Verify your Diasporum email", f.captured().getSubject());
        String body = (String) f.captured().getContent();
        assertTrue(body.contains(BASE + "/verify-email?token=VERIFY-TOKEN-123"));
    }

    @Test
    void passwordResetEmailContainsResetLinkWithToken() throws Exception {
        var f = fixture();
        f.service().sendPasswordReset("user@test.example", "RESET-TOKEN-456");
        verify(f.sender()).send(f.captured());
        var rcpts = f.captured().getRecipients(MimeMessage.RecipientType.TO);
        assertEquals("user@test.example", ((InternetAddress) rcpts[0]).getAddress());
        String body = (String) f.captured().getContent();
        assertTrue(body.contains(BASE + "/reset-password?token=RESET-TOKEN-456"));
    }

    @Test
    void missingSmtpHostFailsStartup() {
        // provider=smtp with no host configured → bean construction fails
        assertThrows(IllegalStateException.class,
                () -> new SmtpEmailService(mock(JavaMailSender.class), FROM, BASE, ""));
    }
}
