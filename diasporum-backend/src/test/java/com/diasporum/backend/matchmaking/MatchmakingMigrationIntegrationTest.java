package com.diasporum.backend.matchmaking;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Verifies a populated V7 upgrade independently of the Spring fresh-install tests. */
@Testcontainers
class MatchmakingMigrationIntegrationTest {

    @Container
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Test
    void populatedV7UpgradeBackfillsFriendshipAndReplacesTriggers() {
        var dataSource = new DriverManagerDataSource(postgres.getJdbcUrl(),
                postgres.getUsername(), postgres.getPassword());
        Flyway.configure().dataSource(dataSource).target("7").load().migrate();
        var jdbc = new JdbcTemplate(dataSource);
        UUID country = UUID.randomUUID();
        jdbc.update("INSERT INTO countries(id,name,iso2,iso3) VALUES(?,?,?,?)",
                country, "Migration Testland", "ZZ", "ZZZ");
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        for (UUID id : new UUID[]{a, b}) {
            jdbc.update("INSERT INTO users(id,email,email_verified_at,account_status)"
                    + " VALUES(?,?,now(),'ACTIVE')", id, id + "@migration.test");
            jdbc.update("INSERT INTO profiles(id,display_name,origin_country_id,"
                    + "current_country_id,trust_score) VALUES(?,?,?,?,0)",
                    id, "Migration " + id, country, country);
            jdbc.update("INSERT INTO user_privacy_settings(user_id) VALUES(?)"
                    + " ON CONFLICT(user_id) DO NOTHING", id);
        }
        jdbc.update("INSERT INTO user_follows(follower_user_id,followed_user_id) VALUES(?,?),(?,?)",
                a, b, b, a);
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM user_mutual_connections"
                + " WHERE user_a_id=least(?::uuid,?::uuid) AND user_b_id=greatest(?::uuid,?::uuid)",
                Integer.class, a, b, a, b));

        int migrations = Flyway.configure().dataSource(dataSource).load().migrate().migrationsExecuted;
        assertEquals(6, migrations);
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM friendships"
                + " WHERE user_a_id=least(?::uuid,?::uuid) AND user_b_id=greatest(?::uuid,?::uuid)",
                Integer.class, a, b, a, b));
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM"
                + " pg_proc WHERE proname='validate_matchmaking_swipe_update')", Boolean.class)));
        assertFalse(Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM"
                + " pg_proc WHERE proname='create_match_after_mutual_like')", Boolean.class)));
        assertFalse(Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM"
                + " pg_proc WHERE proname='create_conversation_for_match')", Boolean.class)));
    }
}
