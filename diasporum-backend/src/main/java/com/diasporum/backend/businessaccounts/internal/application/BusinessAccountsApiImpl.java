package com.diasporum.backend.businessaccounts.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Delegating implementation of {@link BusinessAccountsApi}. */
@Service
public class BusinessAccountsApiImpl implements BusinessAccountsApi {

    private static final String ACTIVE_MEMBER =
            " FROM business_account_members m JOIN business_accounts a"
            + " ON a.id=m.business_account_id AND a.status='ACTIVE'"
            + " WHERE m.user_id=?"
            + " AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL";

    private final JdbcTemplate jdbc;

    public BusinessAccountsApiImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public boolean isActiveMember(UUID userId, UUID businessAccountId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1" + ACTIVE_MEMBER
                        + " AND m.business_account_id=?)",
                Boolean.class, userId, businessAccountId));
    }

    @Override
    public List<UUID> activeAccountIdsOf(UUID userId) {
        return jdbc.queryForList("SELECT m.business_account_id" + ACTIVE_MEMBER,
                UUID.class, userId);
    }

    @Override
    public Optional<BusinessAccountSummary> accountSummary(UUID businessAccountId) {
        return jdbc.query("SELECT id,account_name,status FROM business_accounts"
                        + " WHERE id=?",
                (rs, i) -> new BusinessAccountSummary(
                        rs.getObject("id", UUID.class),
                        rs.getString("account_name"), rs.getString("status")),
                businessAccountId).stream().findFirst();
    }

    @Override
    public Optional<UUID> representativeUserId(UUID businessAccountId) {
        // The messaging schema's normalization trigger stores
        // created_by_user_id as the business side's participant user id —
        // prefer it so callers resolve the same canonical identity.
        return jdbc.query("SELECT COALESCE(a.created_by_user_id,"
                        + "(SELECT m.user_id FROM business_account_members m"
                        + " WHERE m.business_account_id=a.id AND m.role_key='OWNER'"
                        + " AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL"
                        + " LIMIT 1)) AS rep"
                        + " FROM business_accounts a WHERE a.id=?",
                (rs, i) -> rs.getObject("rep", UUID.class),
                businessAccountId).stream().findFirst();
    }

    @Override
    public List<UUID> activeMemberIds(UUID businessAccountId) {
        return jdbc.queryForList("SELECT m.user_id"
                        + " FROM business_account_members m"
                        + " JOIN business_accounts a"
                        + " ON a.id=m.business_account_id AND a.status='ACTIVE'"
                        + " WHERE m.business_account_id=?"
                        + " AND m.accepted_at IS NOT NULL"
                        + " AND m.revoked_at IS NULL",
                UUID.class, businessAccountId);
    }
}
