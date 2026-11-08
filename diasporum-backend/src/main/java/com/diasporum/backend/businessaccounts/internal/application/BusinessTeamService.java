package com.diasporum.backend.businessaccounts.internal.application;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountAuthorization.Capabilities;
import com.diasporum.backend.identity.IdentityApi;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Team management: members, invitations, role changes and ownership transfer.
 * Membership rows carry the invitation lifecycle (accepted_at /
 * invitation_expires_at / revoked_at); audit triggers record every
 * transition. A manager may only act on members ranked below their own role.
 */
@Service
public class BusinessTeamService {

    private static final int DEFAULT_INVITATION_DAYS = 14;
    private static final int MAX_INVITATION_DAYS = 90;

    private final JdbcTemplate jdbc;
    private final Membership membership;
    private final IdentityApi identity;

    public BusinessTeamService(JdbcTemplate jdbc, Membership membership,
            IdentityApi identity) {
        this.jdbc = jdbc;
        this.membership = membership;
        this.identity = identity;
    }

    // ---------------------------------------------------------------- reads

    /** All current members and open invitations, owners first (team view). */
    @Transactional(readOnly = true)
    public List<MemberView> members(UUID actor, UUID accountId) {
        membership.requireCapability(actor, accountId, Capabilities::manageTeam);
        List<MemberRow> rows = memberRows(accountId);
        Map<UUID, IdentityApi.ProfileSummary> people = profilesFor(rows);
        return rows.stream().map(r -> toView(r, people)).toList();
    }

    /** Pending invitations addressed to the caller, account name included. */
    @Transactional(readOnly = true)
    public List<InvitationView> invitationsOf(UUID userId) {
        List<InviteRow> rows = jdbc.query("SELECT m.business_account_id,"
                        + "a.account_name,m.role_key,m.invited_by_user_id,"
                        + "m.created_at,m.invitation_expires_at"
                        + " FROM business_account_members m"
                        + " JOIN business_accounts a ON a.id=m.business_account_id"
                        + " WHERE m.user_id=? AND m.accepted_at IS NULL"
                        + " AND m.revoked_at IS NULL"
                        + " AND a.status IN ('ACTIVE','SUSPENDED')"
                        + " ORDER BY m.created_at DESC",
                BusinessTeamService::inviteRow, userId);
        Map<UUID, IdentityApi.ProfileSummary> people = identity.profileSummaries(
                rows.stream().map(InviteRow::invitedBy).filter(java.util.Objects::nonNull)
                        .collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(IdentityApi.ProfileSummary::id, p -> p));
        return rows.stream().map(r -> new InvitationView(r.accountId(),
                r.accountName(), r.role(), r.invitedBy(),
                displayName(people, r.invitedBy()), r.invitedAt(),
                r.expiresAt(), expired(r.expiresAt()))).toList();
    }

    // ------------------------------------------------------------- invites

    /**
     * Invites a user by username. Re-inviting a pending row refreshes role,
     * inviter and expiry; re-inviting a revoked member reactivates the same
     * membership row so history and the composite key stay stable.
     */
    @Transactional
    public MemberView invite(UUID actor, UUID accountId, String username,
            String role, Integer expiresInDays) {
        Membership.Row actorRow = membership.requireActiveCapability(actor,
                accountId, Capabilities::manageTeam);
        String normalizedRole = normalizeRole(role);
        if (!BusinessAccountAuthorization.invitable(normalizedRole)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "BUSINESS_ROLE_NOT_INVITABLE");
        }
        if (BusinessAccountAuthorization.rankOf(normalizedRole)
                >= BusinessAccountAuthorization.rankOf(actorRow.role())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "BUSINESS_ROLE_ABOVE_RANK");
        }
        var invitee = identity.findByUsername(username)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "BUSINESS_INVITEE_NOT_FOUND"));
        if (invitee.id().equals(actor)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "BUSINESS_SELF_INVITE");
        }
        int days = expiresInDays == null ? DEFAULT_INVITATION_DAYS : expiresInDays;
        if (days < 1 || days > MAX_INVITATION_DAYS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "BUSINESS_INVITATION_DAYS_INVALID");
        }

        var existing = memberRow(accountId, invitee.id());
        if (existing.isPresent() && existing.get().acceptedAt() != null
                && existing.get().revokedAt() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "BUSINESS_ALREADY_MEMBER");
        }
        if (existing.isPresent()) {
            // Pending or revoked membership: reactivate the same row.
            jdbc.update("UPDATE business_account_members SET role_key=?,"
                            + " invited_by_user_id=?, updated_by_user_id=?,"
                            + " accepted_at=NULL, invitation_expires_at=now()+make_interval(days=>?),"
                            + " revoked_at=NULL, revoked_by_user_id=NULL,"
                            + " revocation_reason=NULL"
                            + " WHERE business_account_id=? AND user_id=?",
                    normalizedRole, actor, actor, days, accountId, invitee.id());
        } else {
            jdbc.update("INSERT INTO business_account_members(business_account_id,"
                            + "user_id,role_key,invited_by_user_id,updated_by_user_id,"
                            + "invitation_expires_at) VALUES(?,?,?,?,?,"
                            + "now()+make_interval(days=>?))",
                    accountId, invitee.id(), normalizedRole, actor, actor, days);
        }
        return toView(memberRow(accountId, invitee.id()).orElseThrow());
    }

    /** Withdraws a pending invitation (rank rules apply). */
    @Transactional
    public void revokeInvitation(UUID actor, UUID accountId, UUID targetUserId) {
        Membership.Row actorRow = membership.requireActiveCapability(actor,
                accountId, Capabilities::manageTeam);
        MemberRow target = memberRow(accountId, targetUserId)
                .filter(m -> m.acceptedAt() == null && m.revokedAt() == null)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "BUSINESS_INVITATION_NOT_FOUND"));
        requireOutranks(actorRow, target);
        jdbc.update("UPDATE business_account_members SET revoked_at=now(),"
                        + " revoked_by_user_id=?, revocation_reason='INVITATION_WITHDRAWN',"
                        + " updated_by_user_id=? WHERE business_account_id=? AND user_id=?",
                actor, actor, accountId, targetUserId);
    }

    // ------------------------------------------------- accept and decline

    /**
     * Accepts the caller's pending invitation. Enforces the plan's
     * BUSINESS_TEAM_SEATS active-member cap when an enabled, numerically
     * limited entitlement exists on the account's active subscription.
     */
    @Transactional
    public MemberView accept(UUID userId, UUID accountId) {
        MemberRow invite = pendingInvitation(userId, accountId);
        if (expired(invite.expiresAt())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "BUSINESS_INVITATION_EXPIRED");
        }
        enforceSeatLimit(accountId);
        jdbc.update("UPDATE business_account_members SET accepted_at=now(),"
                        + " updated_by_user_id=? WHERE business_account_id=? AND user_id=?",
                userId, accountId, userId);
        return toView(memberRow(accountId, userId).orElseThrow());
    }

    /** Declines the caller's pending invitation (audited as a revocation). */
    @Transactional
    public void decline(UUID userId, UUID accountId) {
        pendingInvitation(userId, accountId);
        jdbc.update("UPDATE business_account_members SET revoked_at=now(),"
                        + " revoked_by_user_id=?, revocation_reason='INVITATION_DECLINED',"
                        + " updated_by_user_id=? WHERE business_account_id=? AND user_id=?",
                userId, userId, accountId, userId);
    }

    // ------------------------------------------------- membership changes

    /**
     * Changes an active member's role. The OWNER role is never assignable
     * here — ownership moves only through {@link #transferOwnership} — and a
     * manager may only touch members ranked strictly below their own role.
     */
    @Transactional
    public MemberView changeRole(UUID actor, UUID accountId, UUID targetUserId,
            String role) {
        Membership.Row actorRow = membership.requireActiveCapability(actor,
                accountId, Capabilities::manageTeam);
        String normalizedRole = normalizeRole(role);
        if (!BusinessAccountAuthorization.invitable(normalizedRole)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "BUSINESS_ROLE_NOT_ASSIGNABLE");
        }
        MemberRow target = activeMember(accountId, targetUserId);
        requireOutranks(actorRow, target);
        if (BusinessAccountAuthorization.rankOf(normalizedRole)
                >= BusinessAccountAuthorization.rankOf(actorRow.role())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "BUSINESS_ROLE_ABOVE_RANK");
        }
        jdbc.update("UPDATE business_account_members SET role_key=?,"
                        + " updated_by_user_id=? WHERE business_account_id=? AND user_id=?",
                normalizedRole, actor, accountId, targetUserId);
        return toView(memberRow(accountId, targetUserId).orElseThrow());
    }

    /**
     * Revokes an active membership. Members may remove themselves unless they
     * are the last active owner; removing someone else requires team
     * management and a strictly higher rank.
     */
    @Transactional
    public void revokeMember(UUID actor, UUID accountId, UUID targetUserId) {
        MemberRow target = activeMember(accountId, targetUserId);
        if (actor.equals(targetUserId)) {
            if ("OWNER".equals(target.role())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "BUSINESS_LAST_OWNER");
            }
        } else {
            Membership.Row actorRow = membership.requireActiveCapability(actor,
                    accountId, Capabilities::manageTeam);
            requireOutranks(actorRow, target);
        }
        jdbc.update("UPDATE business_account_members SET revoked_at=now(),"
                        + " revoked_by_user_id=?, revocation_reason=?,"
                        + " updated_by_user_id=? WHERE business_account_id=? AND user_id=?",
                actor,
                actor.equals(targetUserId) ? "MEMBER_LEFT" : "MEMBER_REMOVED",
                actor, accountId, targetUserId);
    }

    /**
     * Transfers ownership to another active member in one transaction. The
     * previous owner becomes an ADMINISTRATOR; the deferred owner-presence
     * check and the single-active-owner index are satisfied at commit.
     */
    @Transactional
    public void transferOwnership(UUID actor, UUID accountId, UUID newOwnerUserId) {
        Membership.Row actorRow = membership.requireActive(actor, accountId);
        if (!"OWNER".equals(actorRow.role())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "BUSINESS_TRANSFER_OWNER_ONLY");
        }
        MemberRow target = activeMember(accountId, newOwnerUserId);
        if (actor.equals(newOwnerUserId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "BUSINESS_ALREADY_OWNER");
        }
        jdbc.update("UPDATE business_account_members SET role_key='ADMINISTRATOR',"
                        + " updated_by_user_id=? WHERE business_account_id=? AND user_id=?",
                actor, accountId, actor);
        jdbc.update("UPDATE business_account_members SET role_key='OWNER',"
                        + " updated_by_user_id=? WHERE business_account_id=? AND user_id=?",
                actor, accountId, target.userId());
    }

    // -------------------------------------------------------------- helpers

    private List<MemberRow> memberRows(UUID accountId) {
        return jdbc.query("SELECT user_id,role_key,invited_by_user_id,"
                        + "created_at,accepted_at,invitation_expires_at,revoked_at"
                        + " FROM business_account_members WHERE business_account_id=?"
                        + " AND revoked_at IS NULL"
                        + " ORDER BY CASE role_key WHEN 'OWNER' THEN 0"
                        + " WHEN 'ADMINISTRATOR' THEN 1 ELSE 2 END,"
                        + " accepted_at NULLS LAST,created_at",
                BusinessTeamService::memberRow, accountId);
    }

    private java.util.Optional<MemberRow> memberRow(UUID accountId, UUID userId) {
        return jdbc.query("SELECT user_id,role_key,invited_by_user_id,"
                        + "created_at,accepted_at,invitation_expires_at,revoked_at"
                        + " FROM business_account_members"
                        + " WHERE business_account_id=? AND user_id=?",
                BusinessTeamService::memberRow, accountId, userId)
                .stream().findFirst();
    }

    private MemberRow activeMember(UUID accountId, UUID userId) {
        return memberRow(accountId, userId)
                .filter(m -> m.acceptedAt() != null && m.revokedAt() == null)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "BUSINESS_MEMBER_NOT_FOUND"));
    }

    private MemberRow pendingInvitation(UUID userId, UUID accountId) {
        return memberRow(accountId, userId)
                .filter(m -> m.acceptedAt() == null && m.revokedAt() == null)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "BUSINESS_INVITATION_NOT_FOUND"));
    }

    private void requireOutranks(Membership.Row actor, MemberRow target) {
        if (BusinessAccountAuthorization.rankOf(target.role())
                >= BusinessAccountAuthorization.rankOf(actor.role())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "BUSINESS_MEMBER_OUT_OF_RANK");
        }
    }

    /**
     * Seat cap from the account's active subscription plan, when the plan
     * enables BUSINESS_TEAM_SEATS with a numeric limit. No subscription or a
     * disabled/unconfigured entitlement means uncapped — plan configuration
     * stays an administrator decision, not a code assumption.
     */
    private void enforceSeatLimit(UUID accountId) {
        Long limit = jdbc.query("SELECT e.quantity_limit"
                        + " FROM billing_subscriptions s"
                        + " JOIN billing_plan_entitlements e ON e.plan_id=s.plan_id"
                        + " JOIN billing_features f ON f.id=e.feature_id"
                        + " WHERE s.business_account_id=? AND e.enabled"
                        + " AND f.feature_key='BUSINESS_TEAM_SEATS'"
                        + " AND s.status IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED')"
                        + " ORDER BY s.created_at DESC LIMIT 1",
                (rs, i) -> rs.getObject(1, Long.class), accountId)
                .stream().findFirst().orElse(null);
        if (limit == null) {
            return;
        }
        long active = jdbc.queryForObject("SELECT count(*)"
                        + " FROM business_account_members"
                        + " WHERE business_account_id=? AND accepted_at IS NOT NULL"
                        + " AND revoked_at IS NULL", Long.class, accountId);
        if (active >= limit) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "BUSINESS_TEAM_SEAT_LIMIT");
        }
    }

    private Map<UUID, IdentityApi.ProfileSummary> profilesFor(List<MemberRow> rows) {
        return identity.profileSummaries(rows.stream()
                        .flatMap(r -> Stream.of(r.userId(), r.invitedBy()))
                        .filter(java.util.Objects::nonNull)
                        .collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(IdentityApi.ProfileSummary::id, p -> p));
    }

    private MemberView toView(MemberRow r) {
        return toView(r, identity.profileSummaries(Stream.of(r.userId(), r.invitedBy())
                        .filter(java.util.Objects::nonNull).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(IdentityApi.ProfileSummary::id, p -> p)));
    }

    private MemberView toView(MemberRow r,
            Map<UUID, IdentityApi.ProfileSummary> people) {
        var profile = people.get(r.userId());
        boolean pending = r.acceptedAt() == null;
        return new MemberView(r.userId(),
                profile == null ? null : profile.username(),
                profile == null ? null : profile.displayName(),
                profile == null ? null : profile.avatarMediaId(),
                r.role(), pending ? "PENDING" : "ACTIVE",
                pending && expired(r.expiresAt()),
                r.invitedBy(), displayName(people, r.invitedBy()),
                r.createdAt(), r.expiresAt(), r.acceptedAt());
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

    private static boolean expired(Instant expiresAt) {
        return expiresAt != null && !expiresAt.isAfter(Instant.now());
    }

    private static String normalizeRole(String role) {
        return role == null ? "" : role.trim().toUpperCase(java.util.Locale.ROOT);
    }

    private static MemberRow memberRow(java.sql.ResultSet rs, int i)
            throws java.sql.SQLException {
        return new MemberRow(rs.getObject("user_id", UUID.class),
                rs.getString("role_key"),
                rs.getObject("invited_by_user_id", UUID.class),
                rs.getTimestamp("created_at").toInstant(),
                ts(rs, "accepted_at"), ts(rs, "invitation_expires_at"),
                ts(rs, "revoked_at"));
    }

    private static InviteRow inviteRow(java.sql.ResultSet rs, int i)
            throws java.sql.SQLException {
        return new InviteRow(rs.getObject("business_account_id", UUID.class),
                rs.getString("account_name"), rs.getString("role_key"),
                rs.getObject("invited_by_user_id", UUID.class),
                rs.getTimestamp("created_at").toInstant(),
                ts(rs, "invitation_expires_at"));
    }

    private static Instant ts(java.sql.ResultSet rs, String column)
            throws java.sql.SQLException {
        var t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }

    private record MemberRow(UUID userId, String role, UUID invitedBy,
            Instant createdAt, Instant acceptedAt, Instant expiresAt,
            Instant revokedAt) {
    }

    private record InviteRow(UUID accountId, String accountName, String role,
            UUID invitedBy, Instant invitedAt, Instant expiresAt) {
    }

    /** A member or open invitation as shown in the team list. */
    public record MemberView(UUID userId, String username, String displayName,
            UUID avatarMediaId, String role, String membershipStatus,
            boolean invitationExpired, UUID invitedByUserId,
            String invitedByName, Instant invitedAt,
            Instant invitationExpiresAt, Instant acceptedAt) {
    }

    /** A pending invitation in the invitee's inbox. */
    public record InvitationView(UUID accountId, String accountName,
            String role, UUID invitedByUserId, String invitedByName,
            Instant invitedAt, Instant expiresAt, boolean expired) {
    }
}
