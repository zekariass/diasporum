package com.diasporum.backend.events.internal.infrastructure.crypto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class PayoutDataCipherTest {

    private static final String KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

    @Test
    void roundTripsWithRandomIvAndVersionPrefix() {
        PayoutDataCipher cipher = PayoutDataCipher.forKey(KEY);
        String a = cipher.encrypt("DE89370400440532013000");
        String b = cipher.encrypt("DE89370400440532013000");
        assertTrue(a.startsWith("v1:"));
        assertNotEquals(a, b); // fresh IV per value
        assertFalse(a.contains("0532013000"));
        assertEquals("DE89370400440532013000", cipher.decrypt(a));
        assertNull(cipher.encrypt(null));
    }

    @Test
    void tamperedOrForeignKeyCiphertextIsRejected() {
        PayoutDataCipher cipher = PayoutDataCipher.forKey(KEY);
        String ct = cipher.encrypt("12345678");
        char last = ct.charAt(ct.length() - 2);
        String tampered = ct.substring(0, ct.length() - 2) + (last == 'A' ? 'B' : 'A')
                + ct.charAt(ct.length() - 1);
        assertThrows(IllegalStateException.class, () -> cipher.decrypt(tampered));
        PayoutDataCipher other = PayoutDataCipher.forKey(
                "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=");
        assertThrows(IllegalStateException.class, () -> other.decrypt(ct));
    }

    @Test
    void missingKeyFailsClosedAndMaskHidesAllButLastFour() {
        PayoutDataCipher none = PayoutDataCipher.forKey("");
        var ex = assertThrows(ResponseStatusException.class, () -> none.encrypt("x"));
        assertEquals("PAYOUT_ENCRYPTION_UNAVAILABLE", ex.getReason());
        assertThrows(IllegalStateException.class, () -> PayoutDataCipher.forKey("c2hvcnQ="));
        assertEquals("****3000", PayoutDataCipher.mask("DE89 3704 0044 0532 0130 00".replace(" ", "")
                .replaceAll("00$", "3000")));
        assertEquals("****", PayoutDataCipher.mask("123"));
    }
}
