package com.diasporum.backend.businessaccounts.internal.application;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountAuthorization.Capabilities;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Shared membership revalidation for workspace operations. Every account
 * operation re-checks live membership — a cached role or stale participant
 * row is never trusted.
 */
@Component
class Membership {

    private final JdbcTemplate jdbc;

    Membership(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The caller's accepted, non-revoked membership and account state. */
    record Row(UUID accountId, String accountName, String accountStatus,
            String role) {
        Capabilities capabilities() {
            return BusinessAccountAuthorization.capabilitiesFor(role);
        }
    }

    /** Accepted, non-revoked membership in an ACTIVE or SUSPENDED account. */
    Optional<Row> find(UUID userId, UUID accountId) {
        return jdbc.query("SELECT a.id,a.account_name,a.status,m.role_key"
                        + " FROM business_accounts a"
                        + " JOIN business_account_members m ON m.business_account_id=a.id"
                        + " WHERE a.id=? AND m.user_id=?"
                        + " AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL"
                        + " AND a.status IN ('ACTIVE','SUSPENDED')",
                (rs, i) -> new Row(rs.getObject("id", UUID.class),
                        rs.getString("account_name"), rs.getString("status"),
                        rs.getString("role_key")),
                accountId, userId).stream().findFirst();
    }

    Row require(UUID userId, UUID accountId) {
        return find(userId, accountId).orElseThrow(() -> new ResponseStatusException(
                HttpStatus.NOT_FOUND, "BUSINESS_WORKSPACE_NOT_FOUND"));
    }

    /** Membership in an ACTIVE account — required for all mutations. */
    Row requireActive(UUID userId, UUID accountId) {
        Row row = require(userId, accountId);
        if (!"ACTIVE".equals(row.accountStatus())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "BUSINESS_ACCOUNT_NOT_ACTIVE");
        }
        return row;
    }

    /** Read-side capability check; SUSPENDED accounts remain viewable. */
    Row requireCapability(UUID userId, UUID accountId,
            Function<Capabilities, Boolean> capability) {
        Row row = require(userId, accountId);
        if (!capability.apply(row.capabilities())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "BUSINESS_CAPABILITY_DENIED");
        }
        return row;
    }

    /** Mutation-side capability check; requires an ACTIVE account. */
    Row requireActiveCapability(UUID userId, UUID accountId,
            Function<Capabilities, Boolean> capability) {
        Row row = requireActive(userId, accountId);
        if (!capability.apply(row.capabilities())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "BUSINESS_CAPABILITY_DENIED");
        }
        return row;
    }
}
