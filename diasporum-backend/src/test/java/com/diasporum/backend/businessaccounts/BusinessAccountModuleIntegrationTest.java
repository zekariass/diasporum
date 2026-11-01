package com.diasporum.backend.businessaccounts;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService;
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
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Business workspace behavior against the real migrated PostgreSQL schema. */
@SpringBootTest
@Testcontainers
@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
class BusinessAccountModuleIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired BusinessAccountService service;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    @BeforeEach
    void cleanBusinessData() {
        jdbc.execute("TRUNCATE business_listings,business_accounts,"
                + "business_account_members,business_account_audit_events CASCADE");
    }

    private UUID user(String subject) {
        return IdentityTestSupport.provision(ctx, ISSUER, subject);
    }

    private RequestPostProcessor asUser(UUID userId, String email) {
        return authentication(new UsernamePasswordAuthenticationToken(
                new DiasporumUserPrincipal(userId, UUID.randomUUID(), email, List.of()),
                null, List.of()));
    }

    private void assertWorkspaceNotFound(UUID userId, UUID accountId) {
        var error = assertThrows(ResponseStatusException.class,
                () -> service.workspace(userId, accountId));
        assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode());
    }

    @Test
    void creatorBecomesAcceptedOwnerAndCreationIsAudited() {
        UUID owner = user("business-owner");

        var account = service.create(owner, "  Habesha Group  ");

        assertEquals("Habesha Group", account.accountName());
        assertEquals("ACTIVE", account.status());
        assertEquals("OWNER", account.role());
        assertEquals(0, account.profileCount());
        assertEquals(1, service.accountsOf(owner).size());
        Integer activeOwners = jdbc.queryForObject(
                "SELECT count(*) FROM business_account_members"
                        + " WHERE business_account_id=? AND user_id=? AND role_key='OWNER'"
                        + " AND accepted_at IS NOT NULL AND revoked_at IS NULL",
                Integer.class, account.id(), owner);
        assertEquals(1, activeOwners);
        List<String> actions = jdbc.queryForList(
                "SELECT action_key FROM business_account_audit_events"
                        + " WHERE business_account_id=?",
                String.class, account.id());
        assertTrue(actions.contains("ACCOUNT_CREATED"));
        assertTrue(actions.contains("INITIAL_OWNER_ASSIGNED"));
        assertTrue(service.workspace(owner, account.id()).capabilities().manageSettings());
    }

    @Test
    void profileCountUsesOnlyNonDeletedAccountListings() {
        UUID owner = user("business-profile-count");
        var account = service.create(owner, "Profile Count Workspace");
        UUID country = jdbc.queryForObject(
                "SELECT origin_country_id FROM profiles WHERE id=?", UUID.class, owner);
        jdbc.update("INSERT INTO business_listings(country_id,business_account_id,"
                        + "created_by_user_id,name,slug,description) VALUES(?,?,?,?,?,?)",
                country, account.id(), owner, "Public Profile", "public-profile",
                "A real public business profile used by the integration test.");

        assertEquals(1, service.workspace(owner, account.id()).profileCount());

        jdbc.update("UPDATE business_listings SET deleted_at=now()"
                + " WHERE business_account_id=?", account.id());
        assertEquals(0, service.workspace(owner, account.id()).profileCount());
    }

    @Test
    void membershipAndAccountLifecycleAreRevalidated() {
        UUID owner = user("business-lifecycle-owner");
        UUID member = user("business-lifecycle-member");
        var account = service.create(owner, "Lifecycle Workspace");

        assertTrue(service.accountsOf(member).isEmpty());
        assertWorkspaceNotFound(member, account.id());

        jdbc.update("INSERT INTO business_account_members(business_account_id,user_id,"
                        + "role_key,invited_by_user_id,updated_by_user_id,invitation_expires_at)"
                        + " VALUES(?,?,'EDITOR',?,?,now()+interval '1 day')",
                account.id(), member, owner, owner);
        assertTrue(service.accountsOf(member).isEmpty());
        assertWorkspaceNotFound(member, account.id());

        jdbc.update("UPDATE business_account_members SET accepted_at=now()"
                        + " WHERE business_account_id=? AND user_id=?", account.id(), member);
        var workspace = service.workspace(member, account.id());
        assertEquals("EDITOR", workspace.role());
        assertTrue(workspace.capabilities().manageProfiles());
        assertFalse(workspace.capabilities().manageBilling());

        jdbc.update("UPDATE business_account_members SET revoked_at=now(),revoked_by_user_id=?"
                        + " WHERE business_account_id=? AND user_id=?",
                owner, account.id(), member);
        assertTrue(service.accountsOf(member).isEmpty());
        assertWorkspaceNotFound(member, account.id());

        jdbc.update("UPDATE business_accounts SET status='SUSPENDED',updated_by_user_id=?"
                + " WHERE id=?", owner, account.id());
        assertEquals("SUSPENDED", service.workspace(owner, account.id()).status());
        jdbc.update("UPDATE business_accounts SET status='CLOSED',closure_reason='Test closure',"
                + "updated_by_user_id=? WHERE id=?", owner, account.id());
        assertTrue(service.accountsOf(owner).isEmpty());
        assertWorkspaceNotFound(owner, account.id());
    }

    @Test
    void httpEndpointsEnforceAuthenticationValidationAndAccountIsolation() throws Exception {
        UUID owner = user("business-http-owner");
        UUID outsider = user("business-http-outsider");
        var asOwner = asUser(owner, "business-http-owner@test.com");

        mvc.perform(post("/api/v1/business-accounts").with(asOwner)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountName\":\"HTTP Workspace\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accountName").value("HTTP Workspace"))
                .andExpect(jsonPath("$.role").value("OWNER"));
        UUID account = jdbc.queryForObject(
                "SELECT id FROM business_accounts WHERE account_name='HTTP Workspace'",
                UUID.class);

        mvc.perform(get("/api/v1/business-accounts").with(asOwner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(account.toString()));
        mvc.perform(get("/api/v1/business-accounts/{id}/workspace", account).with(asOwner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capabilities.manageTeam").value(true))
                .andExpect(jsonPath("$.capabilities.manageBilling").value(true));
        mvc.perform(get("/api/v1/business-accounts/{id}/workspace", account)
                        .with(asUser(outsider, "business-http-outsider@test.com")))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/business-accounts").with(asOwner)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountName\":\"   \"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/business-accounts"))
                .andExpect(status().isUnauthorized());
    }
}
