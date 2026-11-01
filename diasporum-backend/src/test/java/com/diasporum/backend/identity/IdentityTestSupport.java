package com.diasporum.backend.identity;

import java.util.UUID;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Identity-owned test fixture: create a test user + profile directly via SQL.
 * Replaces the old Keycloak provisioning pattern — users are created by AuthService
 * or ExternalIdentityService in production; tests create them directly.
 */
public final class IdentityTestSupport {

    private IdentityTestSupport() {}

    public static UUID provision(ApplicationContext ctx, String issuer, String subject) {
        JdbcTemplate db = ctx.getBean(JdbcTemplate.class);
        String email = subject + "@" + issuer;
        // Reuse an existing user row left by a previous test (ux_users_email_normalized);
        // reset its profile/identity so each test starts from a clean fixture state.
        var found = db.queryForList(
            "SELECT id FROM users WHERE email_normalized=?", UUID.class, email);
        UUID userId;
        if (found.isEmpty()) {
            userId = UUID.randomUUID();
            db.update("INSERT INTO users(id,email,email_verified_at,account_status) VALUES(?,?,now(),'ACTIVE')",
                userId, email);
        } else {
            userId = found.get(0);
            db.update("DELETE FROM profiles WHERE id=?", userId);
            db.update("DELETE FROM external_identities WHERE user_id=?", userId);
        }
        var countries = db.queryForList("SELECT id FROM countries LIMIT 1", UUID.class);
        if (countries.isEmpty()) {
            db.update("INSERT INTO countries(name, iso2) VALUES ('Testland','TT')");
            countries = db.queryForList("SELECT id FROM countries LIMIT 1", UUID.class);
        }
        UUID countryId = countries.get(0);
        db.update("INSERT INTO profiles(id,display_name,origin_country_id,current_country_id,trust_score) VALUES(?,?,?,?,0)",
            userId, subject, countryId, countryId);
        db.update("INSERT INTO external_identities(id,user_id,issuer,subject,email_verified) VALUES(?,?,?,?,?)",
            UUID.randomUUID(), userId, issuer, subject, true);
        return userId;
    }
}
