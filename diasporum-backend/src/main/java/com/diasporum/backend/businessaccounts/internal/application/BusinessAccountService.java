package com.diasporum.backend.businessaccounts.internal.application;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountAuthorization.Capabilities;
import com.diasporum.backend.identity.IdentityApi;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** Business workspace discovery, creation, settings and lifecycle. */
@Service
public class BusinessAccountService {

    private static final String SELECT_ACCOUNT = "SELECT a.id,a.account_name,a.status,"
            + "m.role_key,a.created_at,"
            + "(SELECT count(*) FROM business_listings b"
            + " WHERE b.business_account_id=a.id AND b.deleted_at IS NULL) AS profile_count "
            + "FROM business_accounts a JOIN business_account_members m"
            + " ON m.business_account_id=a.id";

    private final JdbcTemplate jdbc;
    private final Membership membership;
    private final IdentityApi identity;
    private final TransactionTemplate transactions;

    public BusinessAccountService(JdbcTemplate jdbc, Membership membership,
            IdentityApi identity,
            org.springframework.transaction.PlatformTransactionManager txManager) {
        this.jdbc = jdbc;
        this.membership = membership;
        this.identity = identity;
        this.transactions = new TransactionTemplate(txManager);
    }

    private static AccountRow row(java.sql.ResultSet rs, int i)
            throws java.sql.SQLException {
        return new AccountRow(rs.getObject("id", UUID.class),
                rs.getString("account_name"), rs.getString("status"),
                rs.getString("role_key"), rs.getLong("profile_count"),
                rs.getTimestamp("created_at").toInstant());
    }

    @Transactional(readOnly = true)
    public List<BusinessAccountView> accountsOf(UUID userId) {
        return jdbc.query(SELECT_ACCOUNT + " WHERE m.user_id=?"
                        + " AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL"
                        + " AND a.status IN ('ACTIVE','SUSPENDED')"
                        + " ORDER BY a.account_name COLLATE \"C\",a.id",
                BusinessAccountService::row, userId).stream().map(AccountRow::toView).toList();
    }

    @Transactional
    public BusinessAccountView create(UUID userId, String accountName) {
        return createInTransaction(userId, accountName, null);
    }

    /**
     * Idempotent creation. A client key is claimed by a primary-key insert;
     * on a concurrent same-key conflict the losing transaction rolls back
     * (removing the duplicate account row) and is retried once, by which
     * time the winner is committed and replayed.
     */
    public BusinessAccountView create(UUID userId, String accountName,
            String idempotencyKey) {
        String key = normalizeKey(idempotencyKey);
        try {
            return transactions.execute(s -> createInTransaction(userId, accountName, key));
        } catch (DuplicateKeyException e) {
            return transactions.execute(s -> createInTransaction(userId, accountName, key));
        }
    }

    private BusinessAccountView createInTransaction(UUID userId,
            String accountName, String key) {
        if (key != null) {
            var existing = jdbc.query("SELECT business_account_id"
                            + " FROM business_account_creation_requests"
                            + " WHERE user_id=? AND idempotency_key=?",
                    (rs, i) -> rs.getObject(1, UUID.class), userId, key)
                    .stream().findFirst();
            if (existing.isPresent()) {
                return accountForMember(userId, existing.get()).toView();
            }
        }

        String normalized = accountName == null ? "" : accountName.trim();
        if (normalized.isEmpty() || normalized.length() > 180) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "BUSINESS_ACCOUNT_NAME_INVALID");
        }
        UUID id = jdbc.queryForObject("INSERT INTO business_accounts"
                        + "(account_name,created_by_user_id,updated_by_user_id)"
                        + " VALUES(?,?,?) RETURNING id",
                UUID.class, normalized, userId, userId);
        if (key != null) {
            jdbc.update("INSERT INTO business_account_creation_requests"
                    + "(user_id,idempotency_key,business_account_id)"
                    + " VALUES(?,?,?)", userId, key, id);
        }
        return accountForMember(userId, id).toView();
    }

    /** Renames the workspace; the lifecycle trigger audits ACCOUNT_NAME_CHANGED. */
    @Transactional
    public BusinessWorkspaceView rename(UUID userId, UUID accountId,
            String accountName) {
        membership.requireActiveCapability(userId, accountId,
                Capabilities::manageSettings);
        String normalized = accountName == null ? "" : accountName.trim();
        if (normalized.isEmpty() || normalized.length() > 180) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "BUSINESS_ACCOUNT_NAME_INVALID");
        }
        jdbc.update("UPDATE business_accounts SET account_name=?,"
                + " updated_by_user_id=? WHERE id=?", normalized, userId, accountId);
        return workspace(userId, accountId);
    }

    /**
     * Permanently closes the workspace (OWNER only). The lifecycle trigger
     * audits the transition and revokes every membership in the same
     * transaction; closure is irreversible through this API.
     */
    @Transactional
    public void close(UUID userId, UUID accountId, String reason) {
        var row = membership.requireActive(userId, accountId);
        if (!"OWNER".equals(row.role())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "BUSINESS_CLOSE_OWNER_ONLY");
        }
        jdbc.update("UPDATE business_accounts SET status='CLOSED',"
                        + " closure_reason=?, updated_by_user_id=? WHERE id=?",
                reason == null || reason.isBlank() ? null : reason.trim(),
                userId, accountId);
    }

    /** Recent audit events for the workspace, newest first (settings view). */
    @Transactional(readOnly = true)
    public List<AuditEventView> auditEvents(UUID userId, UUID accountId) {
        membership.requireCapability(userId, accountId, Capabilities::manageSettings);
        List<AuditRow> rows = jdbc.query("SELECT id,action_key,reason,"
                        + "actor_user_id,target_user_id,created_at"
                        + " FROM business_account_audit_events"
                        + " WHERE business_account_id=?"
                        + " ORDER BY created_at DESC,id LIMIT 100",
                (rs, i) -> new AuditRow(rs.getObject("id", UUID.class),
                        rs.getString("action_key"), rs.getString("reason"),
                        rs.getObject("actor_user_id", UUID.class),
                        rs.getObject("target_user_id", UUID.class),
                        rs.getTimestamp("created_at").toInstant()),
                accountId);
        Map<UUID, IdentityApi.ProfileSummary> people = identity.profileSummaries(
                rows.stream().flatMap(r -> Stream.of(r.actorUserId(), r.targetUserId()))
                        .filter(java.util.Objects::nonNull)
                        .collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(IdentityApi.ProfileSummary::id, p -> p));
        return rows.stream().map(r -> new AuditEventView(r.id(), r.actionKey(),
                r.reason(),
                r.actorUserId(), displayName(people, r.actorUserId()),
                r.targetUserId(), displayName(people, r.targetUserId()),
                r.createdAt())).toList();
    }

    private static String displayName(
            Map<UUID, IdentityApi.ProfileSummary> people, UUID userId) {
        var p = userId == null ? null : people.get(userId);
        if (p == null) {
            return null;
        }
        return p.displayName() != null && !p.displayName().isBlank()
                ? p.displayName() : p.username();
    }

    @Transactional(readOnly = true)
    public BusinessWorkspaceView workspace(UUID userId, UUID accountId) {
        AccountRow account = accountForMember(userId, accountId);
        return new BusinessWorkspaceView(account.id(), account.accountName(),
                account.status(), account.role(), account.profileCount(),
                account.createdAt(),
                BusinessAccountAuthorization.capabilitiesFor(account.role()));
    }

    private AccountRow accountForMember(UUID userId, UUID accountId) {
        return jdbc.query(SELECT_ACCOUNT + " WHERE a.id=? AND m.user_id=?"
                        + " AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL"
                        + " AND a.status IN ('ACTIVE','SUSPENDED')",
                BusinessAccountService::row, accountId, userId).stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "BUSINESS_WORKSPACE_NOT_FOUND"));
    }

    private static String normalizeKey(String idempotencyKey) {
        if (idempotencyKey == null) {
            return null;
        }
        String key = idempotencyKey.trim();
        if (key.isEmpty()) {
            return null;
        }
        if (key.length() > 120) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "BUSINESS_IDEMPOTENCY_KEY_INVALID");
        }
        return key;
    }

    private record AccountRow(UUID id, String accountName, String status,
            String role, long profileCount, Instant createdAt) {
        BusinessAccountView toView() {
            return new BusinessAccountView(id, accountName, status, role,
                    profileCount, createdAt);
        }
    }

    private record AuditRow(UUID id, String actionKey, String reason,
            UUID actorUserId, UUID targetUserId, Instant createdAt) {
    }

    public record BusinessAccountView(UUID id, String accountName, String status,
            String role, long profileCount, Instant createdAt) {
    }

    public record BusinessWorkspaceView(UUID id, String accountName, String status,
            String role, long profileCount, Instant createdAt,
            Capabilities capabilities) {
    }

    public record AuditEventView(UUID id, String actionKey, String reason,
            UUID actorUserId, String actorName,
            UUID targetUserId, String targetName,
            Instant createdAt) {
    }
}
