package com.diasporum.backend.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.internal.api.rest.MeController;
import com.diasporum.backend.identity.internal.application.SessionService;
import com.diasporum.backend.security.internal.authentication.JwtAuthenticationFilter;
import com.diasporum.backend.security.internal.config.SecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * CORS allowlist behaviour: configured origins get preflight approval,
 * unconfigured origins are rejected, and no wildcard is ever emitted.
 */
@WebMvcTest(controllers = MeController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class})
@TestPropertySource(properties =
        "diasporum.cors.allowed-origins=https://app.diasporum.test,https://admin.diasporum.test")
class CorsConfigurationTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private JwtService jwtService;

    @MockitoBean
    private SessionService sessionService;

    @MockitoBean
    private IdentityApi identityApi;

    @Test
    void allowedOriginReceivesPreflightApproval() throws Exception {
        mockMvc.perform(options("/api/v1/me")
                        .header("Origin", "https://app.diasporum.test")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin",
                        "https://app.diasporum.test"));
    }

    @Test
    void secondConfiguredOriginAlsoAllowed() throws Exception {
        mockMvc.perform(options("/api/v1/me")
                        .header("Origin", "https://admin.diasporum.test")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin",
                        "https://admin.diasporum.test"));
    }

    @Test
    void unconfiguredOriginRejected() throws Exception {
        mockMvc.perform(options("/api/v1/me")
                        .header("Origin", "https://evil.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void noWildcardEmittedOnActualRequests() throws Exception {
        // Even a rejected-origin actual request must never see "*" echoed back.
        mockMvc.perform(get("/api/v1/me")
                        .header("Origin", "https://evil.example"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }
}
