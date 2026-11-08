package com.diasporum.backend.businessaccounts;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService;
import com.diasporum.backend.businessaccounts.internal.application.BusinessBillingService;
import com.diasporum.backend.businessaccounts.internal.application.BusinessListingService;
import com.diasporum.backend.businessaccounts.internal.application.BusinessTeamService;
import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Workspace team, settings, billing, listings and idempotency on real PostgreSQL. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class BusinessWorkspaceOperationsIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired BusinessAccountService service;
    @Autowired BusinessTeamService team;
    @Autowired BusinessBillingService billing;
    @Autowired BusinessListingService listings;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    @BeforeEach
    void cleanBusinessData() {
        jdbc.execute("TRUNCATE business_listings,business_accounts,"
                + "business_account_members,business_account_audit_events,"
                + "business_account_creation_requests,"
                + "billing_subscriptions,billing_orders CASCADE");
        jdbc.execute("DELETE FROM billing_plans WHERE plan_key='TEST_SEAT_PLAN'");
    }

    private UUID user(String subject) {
        return IdentityTestSupport.provision(ctx, ISSUER, subject);
    }

    private UUID userWithUsername(String subject, String username) {
        UUID id = user(subject);
        jdbc.update("UPDATE profiles SET username=? WHERE id=?", username, id);
        return id;
    }

    private RequestPostProcessor asUser(UUID userId, String email) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(userId, UUID.randomUUID(), email, List.of()),
                null, List.of()));
    }

    private ResponseStatusException failureOf(Runnable r) {
        return assertThrows(ResponseStatusException.class, r::run);
    }

    // ------------------------------------------------------------- team

    @Test
    void inviteAcceptLifecycleIsAuditedAndVisible() {
        UUID owner = user("team-owner");
        UUID invitee = userWithUsername("team-invitee", "team-invitee");
        var account = service.create(owner, "Team Workspace");

        var invited = team.invite(owner, account.id(), "team-invitee",
                "editor", 7);
        assertEquals("PENDING", invited.membershipStatus());
        assertEquals("EDITOR", invited.role());
        assertEquals("team-invitee", invited.username());

        var inbox = team.invitationsOf(invitee);
        assertEquals(1, inbox.size());
        assertEquals("Team Workspace", inbox.get(0).accountName());
        assertEquals("EDITOR", inbox.get(0).role());
        assertFalse(inbox.get(0).expired());
        assertTrue(service.accountsOf(invitee).isEmpty());

        var accepted = team.accept(invitee, account.id());
        assertEquals("ACTIVE", accepted.membershipStatus());
        assertEquals(1, service.accountsOf(invitee).size());
        assertEquals(2, team.members(owner, account.id()).size());

        List<String> actions = jdbc.queryForList(
                "SELECT action_key FROM business_account_audit_events"
                        + " WHERE business_account_id=? ORDER BY created_at",
                String.class, account.id());
        assertTrue(actions.contains("MEMBER_INVITED"));
        assertTrue(actions.contains("INVITATION_ACCEPTED"));
    }

    @Test
    void declineRevokesAndReinviteReactivatesTheSameRow() {
        UUID owner = user("decline-owner");
        UUID invitee = userWithUsername("decline-invitee", "decline-invitee");
        var account = service.create(owner, "Decline Workspace");

        team.invite(owner, account.id(), "decline-invitee", "EDITOR", null);
        team.decline(invitee, account.id());
        assertTrue(team.invitationsOf(invitee).isEmpty());
        assertTrue(service.accountsOf(invitee).isEmpty());
        assertEquals(1, team.members(owner, account.id()).size());

        team.invite(owner, account.id(), "decline-invitee", "LISTING_MANAGER",
                null);
        // Re-invite reactivates the same membership row — still 2 rows total.
        assertEquals(2, jdbc.queryForObject("SELECT count(*)"
                + " FROM business_account_members WHERE business_account_id=?",
                Integer.class, account.id()).intValue());
        team.accept(invitee, account.id());
        assertEquals("LISTING_MANAGER",
                service.workspace(invitee, account.id()).role());
    }

    @Test
    void expiredInvitationCannotBeAccepted() {
        UUID owner = user("expiry-owner");
        UUID invitee = userWithUsername("expiry-invitee", "expiry-invitee");
        var account = service.create(owner, "Expiry Workspace");
        team.invite(owner, account.id(), "expiry-invitee", "EDITOR", 14);
        // The lifecycle trigger blocks writing an already-expired expiry, so
        // the fixture disables it just for the backdating statement. Separate
        // execute calls keep ALTER off the pending deferred-trigger queue.
        jdbc.execute("ALTER TABLE business_account_members DISABLE TRIGGER"
                + " trg_validate_business_membership_lifecycle");
        jdbc.update("UPDATE business_account_members"
                        + " SET created_at=now()-interval '20 days',"
                        + " invitation_expires_at=now()-interval '6 days'"
                        + " WHERE business_account_id=? AND user_id=?",
                account.id(), invitee);
        jdbc.execute("ALTER TABLE business_account_members ENABLE TRIGGER"
                + " trg_validate_business_membership_lifecycle");

        var error = failureOf(() -> team.accept(invitee, account.id()));
        assertEquals(HttpStatus.CONFLICT, error.getStatusCode());
        assertEquals("BUSINESS_INVITATION_EXPIRED", error.getReason());
        assertTrue(team.invitationsOf(invitee).get(0).expired());
    }

    @Test
    void managersOnlyActOnLowerRanks() {
        UUID owner = user("rank-owner");
        UUID admin = userWithUsername("rank-admin", "rank-admin");
        UUID secondAdmin = userWithUsername("rank-admin-two", "rank-admin-two");
        var account = service.create(owner, "Rank Workspace");
        team.invite(owner, account.id(), "rank-admin", "ADMINISTRATOR", null);
        team.accept(admin, account.id());

        // An administrator cannot invite another administrator or an owner.
        var invitePeer = failureOf(() -> team.invite(admin, account.id(),
                "rank-admin-two", "ADMINISTRATOR", null));
        assertEquals(HttpStatus.FORBIDDEN, invitePeer.getStatusCode());
        var inviteOwner = failureOf(() -> team.invite(admin, account.id(),
                "rank-admin-two", "OWNER", null));
        assertEquals(HttpStatus.BAD_REQUEST, inviteOwner.getStatusCode());

        // Nor revoke/change the owner or a peer administrator.
        var revokeOwner = failureOf(() -> team.revokeMember(admin, account.id(), owner));
        assertEquals(HttpStatus.FORBIDDEN, revokeOwner.getStatusCode());
        var changeOwner = failureOf(() -> team.changeRole(admin, account.id(),
                owner, "EDITOR"));
        assertEquals(HttpStatus.FORBIDDEN, changeOwner.getStatusCode());
        var changePeer = failureOf(() -> team.changeRole(admin, account.id(),
                admin, "EDITOR"));
        assertEquals(HttpStatus.FORBIDDEN, changePeer.getStatusCode());

        // An editor has no team capability at all.
        UUID editor = userWithUsername("rank-editor", "rank-editor");
        team.invite(owner, account.id(), "rank-editor", "EDITOR", null);
        team.accept(editor, account.id());
        var forbidden = failureOf(() -> team.members(editor, account.id()));
        assertEquals(HttpStatus.FORBIDDEN, forbidden.getStatusCode());
        var inviteByEditor = failureOf(() -> team.invite(editor, account.id(),
                "rank-admin-two", "EDITOR", null));
        assertEquals(HttpStatus.FORBIDDEN, inviteByEditor.getStatusCode());
    }

    @Test
    void roleChangeRevokeAndSelfLeaveFollowPolicy() {
        UUID owner = user("role-owner");
        UUID member = userWithUsername("role-member", "role-member");
        var account = service.create(owner, "Role Workspace");
        team.invite(owner, account.id(), "role-member", "EDITOR", null);
        team.accept(member, account.id());

        var changed = team.changeRole(owner, account.id(), member,
                "LISTING_MANAGER");
        assertEquals("LISTING_MANAGER", changed.role());
        assertTrue(jdbc.queryForList("SELECT action_key"
                        + " FROM business_account_audit_events"
                        + " WHERE business_account_id=?", String.class, account.id())
                .contains("MEMBER_ROLE_CHANGED"));

        var ownerRole = failureOf(() -> team.changeRole(owner, account.id(),
                member, "OWNER"));
        assertEquals(HttpStatus.BAD_REQUEST, ownerRole.getStatusCode());

        team.revokeMember(owner, account.id(), member);
        assertTrue(service.accountsOf(member).isEmpty());

        // Members may leave unless they are the last owner.
        team.invite(owner, account.id(), "role-member", "EDITOR", null);
        team.accept(member, account.id());
        team.revokeMember(member, account.id(), member);
        assertTrue(service.accountsOf(member).isEmpty());
        var lastOwner = failureOf(() -> team.revokeMember(owner, account.id(), owner));
        assertEquals(HttpStatus.CONFLICT, lastOwner.getStatusCode());
        assertEquals("BUSINESS_LAST_OWNER", lastOwner.getReason());
    }

    @Test
    void ownershipTransferSwapsRolesAtomically() {
        UUID owner = user("transfer-owner");
        UUID member = userWithUsername("transfer-member", "transfer-member");
        UUID other = user("transfer-outsider");
        var account = service.create(owner, "Transfer Workspace");
        team.invite(owner, account.id(), "transfer-member", "EDITOR", null);
        team.accept(member, account.id());

        var notOwner = failureOf(() -> team.transferOwnership(member,
                account.id(), owner));
        assertEquals(HttpStatus.FORBIDDEN, notOwner.getStatusCode());
        var outsider = failureOf(() -> team.transferOwnership(other,
                account.id(), member));
        assertEquals(HttpStatus.NOT_FOUND, outsider.getStatusCode());
        var pendingTarget = failureOf(() -> team.transferOwnership(owner,
                account.id(), other));
        assertEquals(HttpStatus.NOT_FOUND, pendingTarget.getStatusCode());

        team.transferOwnership(owner, account.id(), member);
        assertEquals("OWNER", service.workspace(member, account.id()).role());
        assertEquals("ADMINISTRATOR",
                service.workspace(owner, account.id()).role());
        assertTrue(jdbc.queryForList("SELECT action_key"
                        + " FROM business_account_audit_events"
                        + " WHERE business_account_id=?", String.class, account.id())
                .contains("MEMBER_ROLE_CHANGED"));
    }

    @Test
    void seatLimitBlocksAcceptanceWhenPlanCapsMembers() {
        UUID owner = user("seat-owner");
        UUID invitee = userWithUsername("seat-invitee", "seat-invitee");
        var account = service.create(owner, "Seats Workspace");
        // A dedicated plan — seeded plan entitlements stay untouched.
        jdbc.update("INSERT INTO billing_plans(plan_key,display_name,"
                + "account_type,is_free) VALUES('TEST_SEAT_PLAN','Test Seats',"
                + "'BUSINESS',true)");
        jdbc.update("INSERT INTO billing_plan_entitlements(plan_id,feature_id,"
                + "enabled,quantity_limit,reset_period) SELECT p.id,f.id,true,1,"
                + "'NEVER' FROM billing_plans p,billing_features f"
                + " WHERE p.plan_key='TEST_SEAT_PLAN'"
                + " AND f.feature_key='BUSINESS_TEAM_SEATS'");
        jdbc.update("INSERT INTO billing_subscriptions(plan_id,"
                        + "business_account_id,status) SELECT id,?,'ACTIVE'"
                        + " FROM billing_plans WHERE plan_key='TEST_SEAT_PLAN'",
                account.id());
        team.invite(owner, account.id(), "seat-invitee", "EDITOR", null);

        var seatLimit = failureOf(() -> team.accept(invitee, account.id()));
        assertEquals(HttpStatus.CONFLICT, seatLimit.getStatusCode());
        assertEquals("BUSINESS_TEAM_SEAT_LIMIT", seatLimit.getReason());
        jdbc.execute("DELETE FROM billing_subscriptions"
                + " WHERE business_account_id='" + account.id() + "';"
                + "DELETE FROM billing_plans WHERE plan_key='TEST_SEAT_PLAN'");
    }

    // ---------------------------------------------------------- settings

    @Test
    void renameAndCloseFollowCapabilityAndOwnerRules() {
        UUID owner = user("settings-owner");
        UUID admin = userWithUsername("settings-admin", "settings-admin");
        UUID editor = userWithUsername("settings-editor", "settings-editor");
        var account = service.create(owner, "Settings Workspace");
        team.invite(owner, account.id(), "settings-admin", "ADMINISTRATOR", null);
        team.accept(admin, account.id());
        team.invite(owner, account.id(), "settings-editor", "EDITOR", null);
        team.accept(editor, account.id());

        var editorRename = failureOf(() -> service.rename(editor, account.id(),
                "Editor Rename"));
        assertEquals(HttpStatus.FORBIDDEN, editorRename.getStatusCode());

        var renamed = service.rename(admin, account.id(), "Renamed Workspace");
        assertEquals("Renamed Workspace", renamed.accountName());

        var editorClose = failureOf(() -> service.close(editor, account.id(), null));
        assertEquals(HttpStatus.FORBIDDEN, editorClose.getStatusCode());
        var adminClose = failureOf(() -> service.close(admin, account.id(), "nope"));
        assertEquals(HttpStatus.FORBIDDEN, adminClose.getStatusCode());

        var events = service.auditEvents(owner, account.id());
        var actions = events.stream()
                .map(BusinessAccountService.AuditEventView::actionKey).toList();
        assertTrue(actions.contains("ACCOUNT_NAME_CHANGED"));

        service.close(owner, account.id(), "Migrated elsewhere");
        assertTrue(service.accountsOf(owner).isEmpty());
        assertEquals("CLOSED", jdbc.queryForObject(
                "SELECT status FROM business_accounts WHERE id=?",
                String.class, account.id()));
        assertEquals(0, jdbc.queryForObject("SELECT count(*)"
                + " FROM business_account_members WHERE business_account_id=?"
                + " AND revoked_at IS NULL", Integer.class, account.id()).intValue());
        assertTrue(jdbc.queryForList("SELECT action_key"
                        + " FROM business_account_audit_events"
                        + " WHERE business_account_id=?", String.class, account.id())
                .contains("ACCOUNT_STATUS_CHANGED"));

        // A closed workspace is unreachable even for its former owner.
        var closed = failureOf(() -> service.auditEvents(owner, account.id()));
        assertEquals(HttpStatus.NOT_FOUND, closed.getStatusCode());
    }

    // ------------------------------------------------- billing & listings

    @Test
    void billingViewReportsRealSubscriptionAndSeats() {
        UUID owner = user("billing-owner");
        UUID admin = userWithUsername("billing-admin", "billing-admin");
        var account = service.create(owner, "Billing Workspace");

        var empty = billing.billing(owner, account.id());
        assertNull(empty.subscription());
        assertEquals(1, empty.seats().used());
        assertNull(empty.seats().limit());
        assertTrue(empty.entitlements().isEmpty());

        jdbc.update("INSERT INTO billing_subscriptions(plan_id,"
                        + "business_account_id,status,current_period_start,"
                        + "current_period_end) SELECT id,?,'ACTIVE',now(),"
                        + "now()+interval '30 days'"
                        + " FROM billing_plans WHERE plan_key='BUSINESS_FREE'",
                account.id());
        var view = billing.billing(owner, account.id());
        assertEquals("BUSINESS_FREE", view.subscription().planKey());
        assertEquals("ACTIVE", view.subscription().status());
        assertFalse(view.entitlements().isEmpty());

        team.invite(owner, account.id(), "billing-admin", "BILLING_MANAGER",
                null);
        team.accept(admin, account.id());
        // BILLING_MANAGER may view billing but not the team list.
        assertEquals(2, billing.billing(admin, account.id()).seats().used());
        var forbidden = failureOf(() -> team.members(admin, account.id()));
        assertEquals(HttpStatus.FORBIDDEN, forbidden.getStatusCode());
    }

    @Test
    void listingsViewAggregatesAccountOwnedContent() {
        UUID owner = user("listings-owner");
        UUID editor = userWithUsername("listings-editor", "listings-editor");
        var account = service.create(owner, "Listings Workspace");
        UUID country = jdbc.queryForObject(
                "SELECT origin_country_id FROM profiles WHERE id=?",
                UUID.class, owner);
        jdbc.update("INSERT INTO business_listings(country_id,business_account_id,"
                        + "created_by_user_id,name,slug,description)"
                        + " VALUES(?,?,?,?,?,?)",
                country, account.id(), owner, "Shop", "shop", "A shop");
        jdbc.update("INSERT INTO job_listings(country_id,business_account_id,"
                        + "employer_name,title,description,visibility_scope,"
                        + "application_method) VALUES(?,?,?,?,?,'COUNTRY','INTERNAL')",
                country, account.id(), "Listings Workspace", "Driver", "Drive");

        var view = listings.listings(owner, account.id());
        assertEquals(1, view.profiles().total());
        assertEquals("Shop", view.profiles().items().get(0).title());
        assertEquals(1, view.jobs().total());
        assertEquals("Driver", view.jobs().items().get(0).title());
        assertEquals(0, view.events().total());

        team.invite(owner, account.id(), "listings-editor", "EDITOR", null);
        team.accept(editor, account.id());
        var forbidden = failureOf(() -> listings.listings(editor, account.id()));
        assertEquals(HttpStatus.FORBIDDEN, forbidden.getStatusCode());
    }

    // --------------------------------------------------------- idempotency

    @Test
    void creationIdempotencyReplaysTheOriginalAccount() {
        UUID owner = user("idem-owner");

        var first = service.create(owner, "Idempotent Workspace", "key-1");
        var replay = service.create(owner, "Idempotent Workspace", "key-1");
        assertEquals(first.id(), replay.id());
        assertEquals(1, service.accountsOf(owner).size());

        var second = service.create(owner, "Other Workspace", "key-2");
        assertNotEquals(first.id(), second.id());
        assertEquals(2, service.accountsOf(owner).size());
    }

    // ------------------------------------------------------------- http

    @Test
    void httpEndpointsExposeTeamAndInvitationFlows() throws Exception {
        UUID owner = userWithUsername("http-team-owner", "http-team-owner");
        UUID invitee = userWithUsername("http-team-invitee", "http-team-invitee");
        var asOwner = asUser(owner, "http-team-owner@test.com");
        var asInvitee = asUser(invitee, "http-team-invitee@test.com");
        var account = service.create(owner, "HTTP Team Workspace");

        mvc.perform(post("/api/v1/business-accounts/{id}/invitations", account.id())
                        .with(asOwner).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"http-team-invitee\",\"role\":\"EDITOR\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("EDITOR"))
                .andExpect(jsonPath("$.membershipStatus").value("PENDING"));

        mvc.perform(get("/api/v1/me/business-invitations").with(asInvitee))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].accountName")
                        .value("HTTP Team Workspace"));

        mvc.perform(post("/api/v1/me/business-invitations/{id}/accept", account.id())
                        .with(asInvitee))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membershipStatus").value("ACTIVE"));

        mvc.perform(get("/api/v1/business-accounts/{id}/members", account.id())
                        .with(asOwner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2));

        mvc.perform(get("/api/v1/business-accounts/{id}/billing", account.id())
                        .with(asOwner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.seats.used").value(2));
        mvc.perform(get("/api/v1/business-accounts/{id}/billing", account.id())
                        .with(asInvitee))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/me/business-invitations"))
                .andExpect(status().isUnauthorized());
    }
}
