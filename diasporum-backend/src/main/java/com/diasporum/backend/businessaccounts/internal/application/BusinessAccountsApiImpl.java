package com.diasporum.backend.businessaccounts.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.businessaccounts.BusinessAccountsApi.AccountMembershipView;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Single implementation of {@link BusinessAccountsApi}: account lookups,
 * active membership checks and workspace membership projections for
 * cross-module consumers. */
@Service
public class BusinessAccountsApiImpl implements BusinessAccountsApi {

    private static final String ACTIVE_MEMBER =
            " FROM business_account_members m JOIN business_accounts a"
            + " ON a.id=m.business_account_id AND a.status='ACTIVE'"
            + " WHERE m.user_id=?"
            + " AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL";

    /** Accepted, non-revoked memberships in ACTIVE or SUSPENDED accounts —
     * the workspace-endpoint revalidation rule used by the events module. */
    private static final String MEMBERSHIP_SELECT =
            "SELECT a.id,a.account_name,a.status::text,"
            + "m.role_key FROM business_accounts a JOIN business_account_members m"
            + " ON m.business_account_id=a.id"
            + " WHERE m.user_id=? AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL"
            + " AND a.status IN ('ACTIVE','SUSPENDED')";

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
    public Map<UUID, BusinessAccountSummary> accountSummaries(Collection<UUID> accountIds) {
        if (accountIds == null || accountIds.isEmpty()) {
            return Map.of();
        }
        var ids = accountIds.stream().distinct().toList();
        String placeholders = String.join(",",
                java.util.Collections.nCopies(ids.size(), "?"));
        return jdbc.query("SELECT id,account_name,status FROM business_accounts "
                        + "WHERE id IN (" + placeholders + ")",
                (rs, i) -> new BusinessAccountSummary(rs.getObject("id", UUID.class),
                        rs.getString("account_name"), rs.getString("status")), ids.toArray())
                .stream().collect(java.util.stream.Collectors.toMap(
                        BusinessAccountSummary::id, java.util.function.Function.identity()));
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
    public Map<UUID, UUID> representativeUserIds(Collection<UUID> accountIds) {
        if (accountIds == null || accountIds.isEmpty()) {
            return Map.of();
        }
        var ids = accountIds.stream().distinct().toList();
        String placeholders = String.join(",",
                java.util.Collections.nCopies(ids.size(), "?"));
        return jdbc.query("SELECT a.id,COALESCE(a.created_by_user_id,"
                        + "(SELECT m.user_id FROM business_account_members m "
                        + "WHERE m.business_account_id=a.id AND m.role_key='OWNER' "
                        + "AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL "
                        + "LIMIT 1)) AS rep FROM business_accounts a "
                        + "WHERE a.id IN (" + placeholders + ")",
                (rs, i) -> new java.util.AbstractMap.SimpleImmutableEntry<>(
                        rs.getObject("id", UUID.class), rs.getObject("rep", UUID.class)),
                ids.toArray()).stream()
                .filter(e -> e.getValue() != null)
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey,
                        Map.Entry::getValue));
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

    private static AccountMembershipView membershipRow(java.sql.ResultSet rs,
            int i) throws java.sql.SQLException {
        return new AccountMembershipView(rs.getObject("id", UUID.class),
                rs.getString("account_name"), rs.getString("status"),
                rs.getString("role_key"));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AccountMembershipView> membership(UUID userId,
            UUID accountId) {
        return jdbc.query(MEMBERSHIP_SELECT + " AND a.id=?",
                        BusinessAccountsApiImpl::membershipRow,
                        userId, accountId).stream().findFirst();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AccountMembershipView> membershipsOf(UUID userId) {
        return jdbc.query(
                MEMBERSHIP_SELECT + " ORDER BY a.account_name COLLATE \"C\",a.id",
                BusinessAccountsApiImpl::membershipRow, userId);
    }
}
