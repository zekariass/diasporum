package com.diasporum.backend.identity;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.identity.internal.api.rest.MeController;
import com.diasporum.backend.identity.internal.application.SessionService;
import com.diasporum.backend.security.SessionValidator;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.security.internal.authentication.JwtAuthenticationFilter;
import com.diasporum.backend.security.internal.config.SecurityConfig;
import com.diasporum.backend.security.JwtService;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * HTTP-layer security tests for {@code GET /api/v1/me} using a mocked
 * {@link JwtService} and {@link SessionService} — deterministic,
 * no crypto or database dependency.
 */
@WebMvcTest(controllers = MeController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class})
class MeControllerSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtService jwtService;

    @MockitoBean
    private SessionService sessionService;

    @MockitoBean
    private IdentityApi identityApi;

    @Test
    void rejectsRequestWithoutToken() throws Exception {
        mockMvc.perform(get("/api/v1/me")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
                .andExpect(jsonPath("$.status").value(401));
    }

    @Test
    void rejectsMalformedToken() throws Exception {
        when(jwtService.validate(anyString())).thenReturn(null);
        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer not-a-jwt"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsRevokedOrExpiredSession() throws Exception {
        var sessionId = UUID.randomUUID();
        when(jwtService.validate("expired-session"))
                .thenReturn(new JwtService.ValidatedToken(UUID.randomUUID(), sessionId));
        when(sessionService.isActive(sessionId)).thenReturn(false);
        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer expired-session"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rejectsValidTokenWhenUserIsMissing() throws Exception {
        var userId = UUID.randomUUID();
        var sessionId = UUID.randomUUID();
        when(jwtService.validate("deleted-user")).thenReturn(new JwtService.ValidatedToken(userId, sessionId));
        when(sessionService.isActive(sessionId)).thenReturn(true);
        when(sessionService.user(userId)).thenReturn(Optional.empty());
        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer deleted-user"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void acceptsValidTokenAndReturnsPrincipal() throws Exception {
        var userId = UUID.randomUUID();
        var sessionId = UUID.randomUUID();
        when(jwtService.validate("good-token")).thenReturn(new JwtService.ValidatedToken(userId, sessionId));
        when(sessionService.isActive(sessionId)).thenReturn(true);
        when(sessionService.user(userId))
                .thenReturn(Optional.of(new SessionValidator.UserInfo(userId, "dev@example.com")));
        when(identityApi.profileSummary(userId))
                .thenReturn(Optional.of(new ProfileSummary(userId, null, null, "ACTIVE", false, null, null)));
        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer good-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(userId.toString()))
                .andExpect(jsonPath("$.displayName").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.accountStatus").value("ACTIVE"))
                .andExpect(jsonPath("$.profileCompleted").value(false));
    }

    @Test
    void returns404WhenAuthenticatedUserHasNoProfile() throws Exception {
        var userId = UUID.randomUUID();
        var sessionId = UUID.randomUUID();
        when(jwtService.validate("no-profile")).thenReturn(new JwtService.ValidatedToken(userId, sessionId));
        when(sessionService.isActive(sessionId)).thenReturn(true);
        when(sessionService.user(userId))
                .thenReturn(Optional.of(new SessionValidator.UserInfo(userId, "dev@example.com")));
        when(identityApi.profileSummary(userId)).thenReturn(Optional.empty());
        mockMvc.perform(get("/api/v1/me").header("Authorization", "Bearer no-profile"))
                .andExpect(status().isNotFound());
    }

    @Test
    void acceptsAuthenticatedPrincipalViaPostProcessor() throws Exception {
        var userId = UUID.randomUUID();
        var principal = new DiasporumUserPrincipal(userId, UUID.randomUUID(), "dev@example.com", List.of());
        var auth = new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
        when(identityApi.profileSummary(userId))
                .thenReturn(Optional.of(new ProfileSummary(userId, "dev", "Dev", "ACTIVE", true, null, null)));
        mockMvc.perform(get("/api/v1/me").with(authentication(auth)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(userId.toString()))
                .andExpect(jsonPath("$.profileCompleted").value(true));
    }
}
