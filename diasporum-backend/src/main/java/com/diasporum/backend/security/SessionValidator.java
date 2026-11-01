package com.diasporum.backend.security;

import java.util.Optional;
import java.util.UUID;

/**
 * Public contract for session-state validation used by the security module's
 * request filter. Implemented by the identity module ({@code SessionService}) —
 * this interface lives in security so the filter does not depend on identity
 * internals (keeps module dependencies acyclic).
 */
public interface SessionValidator {

    /** True when the session exists, is not revoked and has not absolutely expired. */
    boolean isActive(UUID sessionId);

    /** Refresh last_used_at for an active session. */
    void touch(UUID sessionId);

    /** Minimal user info needed to build the request principal. */
    Optional<UserInfo> user(UUID userId);

    record UserInfo(UUID id, String email) {}
}
