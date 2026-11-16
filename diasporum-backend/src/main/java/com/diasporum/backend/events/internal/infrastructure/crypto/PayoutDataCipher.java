package com.diasporum.backend.events.internal.infrastructure.crypto;

import com.diasporum.backend.events.internal.application.ticketing.TicketingProperties;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * AES-256-GCM encryption at rest for organiser payout details (V31 §6d / V38).
 * Format: {@code "v1:" + base64(iv(12) || ciphertext+tag)}. The key comes only
 * from {@code PAYOUT_DATA_ENCRYPTION_KEY} (base64, 32 bytes). Without a key,
 * writes fail closed and reads degrade to fully-masked values.
 */
@Component
public class PayoutDataCipher {
    private static final String PREFIX = "v1:";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final SecretKey key;

    @org.springframework.beans.factory.annotation.Autowired
    public PayoutDataCipher(TicketingProperties properties) {
        this.key = parseKey(properties.payoutDataKey());
    }

    private PayoutDataCipher(SecretKey key) {
        this.key = key;
    }

    /** Standalone instance (tests, tooling). */
    public static PayoutDataCipher forKey(String base64Key) {
        return new PayoutDataCipher(parseKey(base64Key));
    }

    private static SecretKey parseKey(String base64Key) {
        if (base64Key == null || base64Key.isBlank()) {
            return null;
        }
        byte[] raw = Base64.getDecoder().decode(base64Key.trim());
        if (raw.length != 32) {
            throw new IllegalStateException("PAYOUT_DATA_ENCRYPTION_KEY must be 32 bytes (base64)");
        }
        return new SecretKeySpec(raw, "AES");
    }

    public boolean available() {
        return key != null;
    }

    public String encrypt(String plaintext) {
        if (plaintext == null) {
            return null;
        }
        requireKey();
        try {
            byte[] iv = new byte[IV_BYTES];
            RANDOM.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return PREFIX + Base64.getEncoder().encodeToString(
                    ByteBuffer.allocate(iv.length + ct.length).put(iv).put(ct).array());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("payout encryption failed", e);
        }
    }

    public String decrypt(String stored) {
        if (stored == null) {
            return null;
        }
        if (!stored.startsWith(PREFIX)) {
            throw new IllegalStateException("unencrypted payout value");
        }
        requireKey();
        try {
            byte[] all = Base64.getDecoder().decode(stored.substring(PREFIX.length()));
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, all, 0, IV_BYTES));
            return new String(cipher.doFinal(all, IV_BYTES, all.length - IV_BYTES),
                    StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new IllegalStateException("payout decryption failed", e);
        }
    }

    /** "****1234" (last four characters), or "****" when short/unavailable. */
    public static String mask(String plaintext) {
        if (plaintext == null) {
            return null;
        }
        String compact = plaintext.replaceAll("\\s", "");
        return compact.length() <= 4 ? "****" : "****" + compact.substring(compact.length() - 4);
    }

    private void requireKey() {
        if (key == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "PAYOUT_ENCRYPTION_UNAVAILABLE");
        }
    }
}
