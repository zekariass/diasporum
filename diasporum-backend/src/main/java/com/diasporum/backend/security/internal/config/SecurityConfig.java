package com.diasporum.backend.security.internal.config;

import com.diasporum.backend.security.internal.authentication.JwtAuthenticationFilter;
import com.diasporum.backend.security.JwtService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * First-party REST API security: stateless Diasporum JWT resource server.
 * RS256 tokens issued and validated by JwtService — no external OIDC provider.
 */
@Configuration
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtFilter;
    private final JwtService jwtService;
    private final String allowedOrigins;

    public SecurityConfig(JwtAuthenticationFilter jwtFilter, JwtService jwtService,
            @org.springframework.beans.factory.annotation.Value(
                "${diasporum.cors.allowed-origins:}") String allowedOrigins) {
        this.jwtFilter = jwtFilter;
        this.jwtService = jwtService;
        this.allowedOrigins = allowedOrigins;
    }

    @Bean
    SecurityFilterChain apiSecurityFilterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.disable())
            .cors(cors -> cors.configurationSource(corsSource()))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // Public auth endpoints only — session/link/me endpoints under
                // /api/v1/auth/** require a valid Bearer token.
                .requestMatchers(HttpMethod.POST,
                    "/api/v1/auth/register", "/api/v1/auth/login",
                    "/api/v1/auth/google", "/api/v1/auth/apple",
                    "/api/v1/auth/refresh", "/api/v1/auth/verify-email",
                    "/api/v1/auth/resend-verification", "/api/v1/auth/forgot-password",
                    "/api/v1/auth/reset-password").permitAll()
                .requestMatchers("/actuator/health", "/actuator/health/**", "/error",
                    "/.well-known/jwks.json").permitAll()
                .anyRequest().authenticated())
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class)
            .exceptionHandling(e -> e
                .authenticationEntryPoint(apiAuthenticationEntryPoint())
                .accessDeniedHandler(apiAccessDeniedHandler()));
        return http.build();
    }

    @Bean
    CorsConfigurationSource corsSource() {
        var c = new CorsConfiguration();
        // Environment-configured allowlist — no wildcard. An empty list means
        // no cross-origin browser access at all; native mobile clients are
        // unaffected (CORS is only enforced on browser-originated requests).
        c.setAllowedOrigins(java.util.Arrays.stream(allowedOrigins.split(","))
                .map(o -> o.trim()).filter(o -> !o.isEmpty()).toList());
        if (c.getAllowedOrigins().contains("*") && Boolean.TRUE.equals(c.getAllowCredentials())) {
            throw new IllegalStateException(
                "Wildcard CORS origin cannot be combined with credentials.");
        }
        c.setAllowedMethods(List.of("GET","POST","PUT","PATCH","DELETE","OPTIONS"));
        c.setAllowedHeaders(List.of("Authorization","Content-Type","X-Device-Id",
                "X-Device-Name"));
        c.setAllowCredentials(false);
        var s = new UrlBasedCorsConfigurationSource();
        s.registerCorsConfiguration("/**", c);
        return s;
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    }

    @Bean
    org.springframework.web.servlet.function.RouterFunction<org.springframework.web.servlet.function.ServerResponse> jwks() {
        return org.springframework.web.servlet.function.RouterFunctions.route()
            .GET("/.well-known/jwks.json", req ->
                org.springframework.web.servlet.function.ServerResponse.ok()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(jwtService.jwks()))
            .build();
    }

    private AuthenticationEntryPoint apiAuthenticationEntryPoint() {
        return (request, response, ex) -> {
            response.setHeader("WWW-Authenticate", "Bearer");
            writeError(response, request, 401, "UNAUTHENTICATED", "Authentication is required");
        };
    }

    private AccessDeniedHandler apiAccessDeniedHandler() {
        return (request, response, ex) -> writeError(response, request, 403,
                "FORBIDDEN", "You do not have permission to access this resource");
    }

    private void writeError(HttpServletResponse response, HttpServletRequest request,
            int status, String code, String message) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        String json = "{\"status\":%d,\"code\":\"%s\",\"message\":\"%s\",\"path\":\"%s\""
                .formatted(status, escape(code), escape(message), escape(request.getRequestURI()))
                + ",\"timestamp\":\"" + Instant.now() + "\",\"fieldErrors\":{}}";
        response.getWriter().write(json);
    }

    private static String escape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
