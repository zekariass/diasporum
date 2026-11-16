package com.diasporum.backend.events.internal.application.ticketing;

import java.security.SecureRandom;
import java.util.Base64;

/**
 * Opaque random ticket identifiers. Neither encodes the event, holder or type —
 * a scan is resolved server-side only. ticket_code is human-typeable (Crockford
 * base32, 60 bits); qr_payload is 256 bits base64url for the mobile QR.
 */
final class TicketCodes {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final char[] CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toCharArray();

    private TicketCodes() {
    }

    static String ticketCode() {
        StringBuilder sb = new StringBuilder("TK-");
        for (int i = 0; i < 12; i++) {
            sb.append(CROCKFORD[RANDOM.nextInt(CROCKFORD.length)]);
        }
        return sb.toString();
    }

    static String qrPayload() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String orderNumber() {
        StringBuilder sb = new StringBuilder("TO-");
        for (int i = 0; i < 10; i++) {
            sb.append(CROCKFORD[RANDOM.nextInt(CROCKFORD.length)]);
        }
        return sb.toString();
    }
}
