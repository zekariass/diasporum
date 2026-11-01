package com.diasporum.backend.businessaccounts.internal.application;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountAuthorization.Capabilities;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Business workspace discovery, creation and membership-checked loading. */
@Service
public class BusinessAccountService {

    private static final String SELECT_ACCOUNT = "SELECT a.id,a.account_name,a.status,"
            + "m.role_key,a.created_at,"
            + "(SELECT count(*) FROM business_listings b"
            + " WHERE b.business_account_id=a.id AND b.deleted_at IS NULL) AS profile_count "
            + "FROM business_accounts a JOIN business_account_members m"
            + " ON m.business_account_id=a.id";

    private final JdbcTemplate jdbc;

    public BusinessAccountService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
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

    /**
     * The v10.12 insert trigger creates the first accepted OWNER membership and
     * both account/membership audit rows in the same transaction.
     */
    @Transactional
    public BusinessAccountView create(UUID userId, String accountName) {
        String normalized = accountName == null ? "" : accountName.trim();
        if (normalized.isEmpty() || normalized.length() > 180) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "BUSINESS_ACCOUNT_NAME_INVALID");
        }
        UUID id = jdbc.queryForObject("INSERT INTO business_accounts"
                        + "(account_name,created_by_user_id,updated_by_user_id)"
                        + " VALUES(?,?,?) RETURNING id",
                UUID.class, normalized, userId, userId);
        return accountForMember(userId, id).toView();
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

    private record AccountRow(UUID id, String accountName, String status,
            String role, long profileCount, Instant createdAt) {
        BusinessAccountView toView() {
            return new BusinessAccountView(id, accountName, status, role,
                    profileCount, createdAt);
        }
    }

    public record BusinessAccountView(UUID id, String accountName, String status,
            String role, long profileCount, Instant createdAt) {
    }

    public record BusinessWorkspaceView(UUID id, String accountName, String status,
            String role, long profileCount, Instant createdAt,
            Capabilities capabilities) {
    }
}
