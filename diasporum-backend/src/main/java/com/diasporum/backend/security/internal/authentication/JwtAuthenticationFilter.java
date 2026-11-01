package com.diasporum.backend.security.internal.authentication;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.security.JwtService;
import com.diasporum.backend.security.SessionValidator;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * Validates Diasporum JWT access tokens and checks the associated session is active.
 * Sets DiasporumUserPrincipal on SecurityContext for all authenticated requests.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private final SessionValidator sessionService;

    public JwtAuthenticationFilter(JwtService jwtService, SessionValidator sessionService) {
        this.jwtService = jwtService;
        this.sessionService = sessionService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            chain.doFilter(request, response);
            return;
        }
        JwtService.ValidatedToken token = jwtService.validate(header.substring(7));
        if (token == null) { response.sendError(401, "Invalid or expired token"); return; }

        // Check session is active (not revoked, not expired)
        UUID sessionId = token.sessionId();
        if (!sessionService.isActive(sessionId)) {
            response.sendError(401, "Session expired or revoked");
            return;
        }
        sessionService.touch(sessionId);

        // Load user to populate principal
        sessionService.user(token.userId()).ifPresent(u -> {
            var principal = new DiasporumUserPrincipal(token.userId(), sessionId, u.email(), java.util.List.of());
            SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities()));
        });
        chain.doFilter(request, response);
    }
}
