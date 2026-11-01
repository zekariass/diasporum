package com.diasporum.backend.businessaccounts.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountApi;
import com.diasporum.backend.businessaccounts.BusinessAccountApi.AccountMembershipView;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read-only membership projection backing {@link BusinessAccountApi}. */
@Service
public class BusinessAccountApiImpl implements BusinessAccountApi {

    private static final String SELECT = "SELECT a.id,a.account_name,a.status::text,"
            + "m.role_key FROM business_accounts a JOIN business_account_members m"
            + " ON m.business_account_id=a.id"
            + " WHERE m.user_id=? AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL"
            + " AND a.status IN ('ACTIVE','SUSPENDED')";

    private final JdbcTemplate jdbc;

    public BusinessAccountApiImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static AccountMembershipView row(java.sql.ResultSet rs, int i)
            throws java.sql.SQLException {
        return new AccountMembershipView(rs.getObject("id", UUID.class),
                rs.getString("account_name"), rs.getString("status"),
                rs.getString("role_key"));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AccountMembershipView> membership(UUID userId, UUID accountId) {
        return jdbc.query(SELECT + " AND a.id=?", BusinessAccountApiImpl::row,
                        userId, accountId).stream().findFirst();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AccountMembershipView> membershipsOf(UUID userId) {
        return jdbc.query(SELECT + " ORDER BY a.account_name COLLATE \"C\",a.id",
                BusinessAccountApiImpl::row, userId);
    }
}
