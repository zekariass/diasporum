package com.diasporum.backend.identity.internal.api.rest;

import com.diasporum.backend.identity.internal.application.*;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.security.JwtService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * First-party authentication endpoints — /api/v1/auth/**
 * All endpoints are public; protected endpoints use @AuthenticationPrincipal.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;
    private final SessionService sessionService;
    private final JwtService jwtService;
    private final ExternalIdentityService externalIdentityService;

    public AuthController(AuthService authService, SessionService sessionService,
            JwtService jwtService, ExternalIdentityService externalIdentityService) {
        this.authService = authService;
        this.sessionService = sessionService;
        this.jwtService = jwtService;
        this.externalIdentityService = externalIdentityService;
    }

    // ---- DTOs ----

    public record RegisterRequest(@NotBlank @Email String email,
            @NotBlank @Size(min=8, max=128) String password) {}

    public record LoginRequest(@NotBlank @Email String email, @NotBlank String password) {}

    public record ExternalLoginRequest(@NotBlank String idToken) {}

    public record RefreshRequest(@NotBlank String refreshToken) {}

    public record VerifyEmailRequest(@NotBlank String token) {}

    public record ResendVerificationRequest(@NotBlank @Email String email) {}

    public record ForgotPasswordRequest(@NotBlank @Email String email) {}

    public record ResetPasswordRequest(@NotBlank String token,
            @NotBlank @Size(min=8, max=128) String password) {}

    public record ChangePasswordRequest(@NotBlank String currentPassword,
            @NotBlank @Size(min=8, max=128) String newPassword) {}

    public record SessionView(String id, String clientType, String authMethod,
            String deviceName, String createdAt, String lastUsedAt) {}

    public record AuthResponse(String accessToken, String refreshToken,
            String tokenType, Long expiresIn, UUID userId, UUID sessionId) {}

    public record MeResponse(UUID id, String email, String accountStatus,
            String emailVerifiedAt) {}

    // ---- Helpers ----

    private AuthResponse toAuthResponse(AuthService.AuthResult r) {
        var access = jwtService.issue(r.userId(), r.sessionId());
        return new AuthResponse(access.token(), r.refreshToken(), "Bearer",
            access.expiresAt().getEpochSecond() - System.currentTimeMillis() / 1000,
            r.userId(), r.sessionId());
    }

    private String clientType(HttpServletRequest req) {
        String ua = req.getHeader("User-Agent");
        if (ua == null) ua = "";
        if (ua.contains("iPhone") || ua.contains("iPad")) return "IOS";
        if (ua.contains("Android")) return "ANDROID";
        return ua.contains("Mozilla") || ua.contains("Chrome") ? "WEB" : "OTHER";
    }

    private String deviceId(HttpServletRequest req) { return req.getHeader("X-Device-Id"); }
    private String deviceName(HttpServletRequest req) { return req.getHeader("X-Device-Name"); }
    private String ip(HttpServletRequest req) { return req.getRemoteAddr(); }
    private String userAgent(HttpServletRequest req) { return req.getHeader("User-Agent"); }

    // ---- Endpoints ----

    @PostMapping("/register")
    ResponseEntity<Map<String, Object>> register(@Valid @RequestBody RegisterRequest req,
            HttpServletRequest http) {
        UUID userId = authService.register(req.email(), req.password(),
            clientType(http), deviceId(http), deviceName(http), ip(http), userAgent(http));
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
            "userId", userId, "message", "Registration successful."));
    }

    @PostMapping("/login")
    ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest req, HttpServletRequest http) {
        var result = authService.login(req.email(), req.password(),
            clientType(http), deviceId(http), deviceName(http), ip(http), userAgent(http));
        return ResponseEntity.ok(toAuthResponse(result));
    }

    @PostMapping("/google")
    ResponseEntity<AuthResponse> googleLogin(@Valid @RequestBody ExternalLoginRequest req,
            HttpServletRequest http) {
        var result = externalIdentityService.login("https://accounts.google.com", req.idToken(),
            clientType(http), deviceId(http), deviceName(http), ip(http), userAgent(http));
        return ResponseEntity.ok(toAuthResponse(result));
    }

    @PostMapping("/apple")
    ResponseEntity<AuthResponse> appleLogin(@Valid @RequestBody ExternalLoginRequest req,
            HttpServletRequest http) {
        var result = externalIdentityService.login("https://appleid.apple.com", req.idToken(),
            clientType(http), deviceId(http), deviceName(http), ip(http), userAgent(http));
        return ResponseEntity.ok(toAuthResponse(result));
    }

    @PostMapping("/refresh")
    ResponseEntity<AuthResponse> refresh(@Valid @RequestBody RefreshRequest req) {
        return authService.refresh(req.refreshToken())
            .map(r -> ResponseEntity.ok(toAuthResponse(r)))
            .orElse(ResponseEntity.status(HttpStatus.UNAUTHORIZED).build());
    }

    @PostMapping("/logout")
    ResponseEntity<Void> logout(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        authService.logout(principal.sessionId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/logout-all")
    ResponseEntity<Void> logoutAll(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        authService.logoutAll(principal.userId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    ResponseEntity<MeResponse> me(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return sessionService.getUser(principal.userId())
            .map(u -> ResponseEntity.ok(new MeResponse(u.id(), u.email(), u.accountStatus(),
                u.emailVerifiedAt() != null ? u.emailVerifiedAt().toString() : null)))
            .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/sessions")
    ResponseEntity<List<SessionView>> sessions(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        var sessions = sessionService.listForUser(principal.userId()).stream()
            .map(s -> new SessionView(s.id().toString(), s.clientType(), s.authenticationMethod(),
                s.deviceName(), s.createdAt().toString(), s.lastUsedAt().toString()))
            .toList();
        return ResponseEntity.ok(sessions);
    }

    @DeleteMapping("/sessions/{sessionId}")
    ResponseEntity<Void> revokeSession(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID sessionId) {
        sessionService.findById(sessionId).ifPresent(s -> {
            if (s.userId().equals(principal.userId())) sessionService.revoke(sessionId, "USER_REVOKE");
        });
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/verify-email")
    ResponseEntity<Void> verifyEmail(@Valid @RequestBody VerifyEmailRequest req) {
        return authService.verifyEmail(req.token())
            ? ResponseEntity.noContent().build()
            : ResponseEntity.badRequest().build();
    }

    @PostMapping("/resend-verification")
    ResponseEntity<Void> resendVerification(@Valid @RequestBody ResendVerificationRequest req) {
        authService.resendVerification(req.email());
        return ResponseEntity.noContent().build();
    }

    // ---- External identity linking ----

    @PostMapping("/link/google")
    ResponseEntity<Void> linkGoogle(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody ExternalLoginRequest req) {
        externalIdentityService.link(principal.userId(), "https://accounts.google.com", req.idToken());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/link/apple")
    ResponseEntity<Void> linkApple(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody ExternalLoginRequest req) {
        externalIdentityService.link(principal.userId(), "https://appleid.apple.com", req.idToken());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/link/{externalIdentityId}")
    ResponseEntity<Void> unlinkExternalIdentity(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID externalIdentityId) {
        externalIdentityService.unlink(principal.userId(), externalIdentityId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/forgot-password")
    ResponseEntity<Void> forgotPassword(@Valid @RequestBody ForgotPasswordRequest req) {
        authService.requestPasswordReset(req.email());
        return ResponseEntity.noContent().build(); // always 204 — don't reveal existence
    }

    @PostMapping("/reset-password")
    ResponseEntity<Void> resetPassword(@Valid @RequestBody ResetPasswordRequest req) {
        return authService.resetPassword(req.token(), req.password())
            ? ResponseEntity.noContent().build()
            : ResponseEntity.badRequest().build();
    }

    @PostMapping("/change-password")
    ResponseEntity<Void> changePassword(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody ChangePasswordRequest req) {
        return authService.changePassword(principal.userId(), req.currentPassword(), req.newPassword())
            ? ResponseEntity.noContent().build()
            : ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }
}
