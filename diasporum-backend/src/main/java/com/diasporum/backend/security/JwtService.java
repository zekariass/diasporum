package com.diasporum.backend.security;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.*;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jwt.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.Map;
import java.util.UUID;

/**
 * Issues and validates Diasporum RS256 JWT access tokens.
 * Persistent keys: supply PEM via DIASPORUM_JWT_PRIVATE_KEY / DIASPORUM_JWT_PUBLIC_KEY
 * — the pair is validated at startup (a mismatch fails fast). Ephemeral
 * key-pairs are only generated when diasporum.auth.jwt.allow-ephemeral-keys=true
 * (local development and tests); any other environment fails to start without
 * configured keys so a misconfigured deployment can never silently sign with
 * disposable keys.
 */
@Service
public class JwtService {

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);
    private static final String ALG = "RS256";

    private final KeyPair keyPair;
    private final String issuer;
    private final String audience;
    private final String kid;
    private final long accessTokenTtlSeconds;

    public JwtService(
            @Value("${diasporum.auth.jwt.issuer}") String issuer,
            @Value("${diasporum.auth.jwt.audience}") String audience,
            @Value("${diasporum.auth.jwt.kid:local-1}") String kid,
            @Value("${diasporum.auth.jwt.access-token-ttl:PT15M}") java.time.Duration ttl,
            @Value("${diasporum.auth.jwt.private-key:}") String privateKeyPem,
            @Value("${diasporum.auth.jwt.public-key:}") String publicKeyPem,
            @Value("${diasporum.auth.jwt.allow-ephemeral-keys:false}") boolean allowEphemeral
    ) throws Exception {
        this.issuer = issuer;
        this.audience = audience;
        this.kid = kid;
        this.accessTokenTtlSeconds = ttl.getSeconds();
        boolean hasPrivate = !privateKeyPem.isBlank();
        boolean hasPublic = !publicKeyPem.isBlank();
        if (hasPrivate != hasPublic) {
            throw new IllegalStateException(
                "JWT keys misconfigured: DIASPORUM_JWT_PRIVATE_KEY and"
                + " DIASPORUM_JWT_PUBLIC_KEY must be set together (one is missing).");
        }
        if (hasPrivate) {
            this.keyPair = PemKeyLoader.load(privateKeyPem, publicKeyPem);
            verifyConfiguredPair(this.keyPair);
            log.info("JWT signing key loaded from configuration (kid={}).", kid);
        } else {
            if (!allowEphemeral) {
                throw new IllegalStateException(
                    "JWT signing keys are required: set DIASPORUM_JWT_PRIVATE_KEY and"
                    + " DIASPORUM_JWT_PUBLIC_KEY. Ephemeral keys are only permitted"
                    + " for local development and tests"
                    + " (diasporum.auth.jwt.allow-ephemeral-keys=true).");
            }
            log.warn("JWT keys not configured — generating ephemeral RSA-2048 keypair"
                   + " (allowed only for local development/tests). All issued tokens"
                   + " become invalid on restart.");
            KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
            gen.initialize(2048);
            this.keyPair = gen.generateKeyPair();
        }
    }

    /** Startup check: the configured private key must actually match the
     * configured public key — sign a probe and verify it, failing fast on a
     * mismatched pair instead of issuing unverifiable tokens at runtime. */
    private static void verifyConfiguredPair(KeyPair pair) throws JOSEException {
        try {
            SignedJWT probe = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).build(),
                new JWTClaimsSet.Builder().subject("keypair-check").build());
            probe.sign(new RSASSASigner(pair.getPrivate()));
            if (!probe.verify(new RSASSAVerifier((RSAPublicKey) pair.getPublic()))) {
                throw new IllegalStateException(
                    "DIASPORUM_JWT_PRIVATE_KEY does not match DIASPORUM_JWT_PUBLIC_KEY"
                    + " — probe signature failed verification.");
            }
        } catch (JOSEException e) {
            throw e;
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(
                "Failed to validate configured JWT key pair.", e);
        }
    }

    public record AccessToken(String token, UUID sessionId, Instant expiresAt) {}

    /** Issue a signed RS256 access token. sub = userId, sid = sessionId. */
    public AccessToken issue(UUID userId, UUID sessionId) {
        Instant expiry = Instant.now().plusSeconds(accessTokenTtlSeconds);
        try {
            SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(kid).type(JOSEObjectType.JWT).build(),
                new JWTClaimsSet.Builder()
                    .subject(userId.toString())
                    .issuer(issuer)
                    .audience(audience)
                    .expirationTime(Date.from(expiry))
                    .issueTime(new Date())
                    .jwtID(UUID.randomUUID().toString())
                    .claim("sid", sessionId.toString())
                    .build()
            );
            jwt.sign(new RSASSASigner(keyPair.getPrivate()));
            return new AccessToken(jwt.serialize(), sessionId, expiry);
        } catch (JOSEException e) {
            throw new IllegalStateException("JWT signing failed", e);
        }
    }

    /** Verify signature + issuer + audience + expiry. Returns claims or null on failure. */
    public JWTClaimsSet verify(String token) {
        try {
            SignedJWT jwt = SignedJWT.parse(token);
            if (!jwt.verify(new RSASSAVerifier((RSAPublicKey) keyPair.getPublic()))) return null;
            JWTClaimsSet claims = jwt.getJWTClaimsSet();
            if (!issuer.equals(claims.getIssuer())) return null;
            if (claims.getAudience().isEmpty() || !claims.getAudience().contains(audience)) return null;
            if (claims.getExpirationTime() == null || claims.getExpirationTime().before(new Date())) return null;
            return claims;
        } catch (Exception e) {
            return null;
        }
    }

    /** Extract claims and return userId + sessionId. */
    public record ValidatedToken(UUID userId, UUID sessionId) {}
    public ValidatedToken validate(String token) {
        JWTClaimsSet c = verify(token);
        if (c == null) return null;
        try {
            return new ValidatedToken(UUID.fromString(c.getSubject()), UUID.fromString(c.getStringClaim("sid")));
        } catch (Exception e) { return null; }
    }

    /** Public JWK for the JWKS endpoint. */
    public Map<String, Object> jwks() {
        RSAKey jwk = new RSAKey.Builder((RSAPublicKey) keyPair.getPublic())
            .keyID(kid).algorithm(JWSAlgorithm.RS256).keyUse(KeyUse.SIGNATURE).build();
        return new JWKSet(jwk.toPublicJWK()).toJSONObject();
    }
}
