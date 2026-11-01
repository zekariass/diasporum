package com.diasporum.backend.security;

import java.security.*;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.*;
import java.util.Base64;

/**
 * Loads RSA key-pairs from PEM strings for JwtService.
 * Supports PKCS8 private keys and X.509/SPKI public keys.
 */
final class PemKeyLoader {

    private PemKeyLoader() {}

    static KeyPair load(String privatePem, String publicPem) throws Exception {
        return new KeyPair(loadPublic(publicPem), loadPrivate(privatePem));
    }

    private static RSAPublicKey loadPublic(String pem) throws Exception {
        String key = stripPem(pem, "PUBLIC KEY");
        return (RSAPublicKey) KeyFactory.getInstance("RSA")
            .generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(key)));
    }

    private static RSAPrivateKey loadPrivate(String pem) throws Exception {
        String key = stripPem(pem, "PRIVATE KEY");
        return (RSAPrivateKey) KeyFactory.getInstance("RSA")
            .generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(key)));
    }

    private static String stripPem(String pem, String label) {
        return pem.replace("-----BEGIN " + label + "-----", "")
                  .replace("-----END " + label + "-----", "")
                  .replaceAll("\\s", "");
    }
}
