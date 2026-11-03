package com.diasporum.backend.feed;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.feed.internal.application.FeedService;
import com.diasporum.backend.identity.IdentityTestSupport;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Verifies the fresh V1-V12 schema and a populated V12 no-op upgrade. */
@SpringBootTest
@Testcontainers
class PollSchemaIntegrationTest {

    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired JdbcTemplate jdbc;
    @Autowired Flyway flyway;
    @Autowired FeedService service;
    @Autowired CommunityService communityService;
    @Autowired ApplicationContext context;

    @Test
    void freshSchemaAndPopulatedNoOpUpgradePreservePolls() {
        for (String table : new String[]{"feed_posts", "community_memberships",
                "external_identities", "profiles", "communities",
                "country_categories", "airports", "countries"}) {
            jdbc.update("DELETE FROM " + table);
        }
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES"
                + "('Ethiopia','ET','ETH'),('Germany','DE','DEU')");
        UUID origin = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='ET'",
                UUID.class);
        UUID destination = jdbc.queryForObject(
                "SELECT id FROM countries WHERE iso2='DE'", UUID.class);
        jdbc.update("INSERT INTO communities(name,slug,origin_country_id,"
                + "destination_country_id) VALUES('Schema','schema-polls',?,?)",
                origin, destination);
        UUID community = jdbc.queryForObject("SELECT id FROM communities", UUID.class);
        jdbc.update("INSERT INTO country_categories(id,country_id,name,slug)"
                + " VALUES(gen_random_uuid(),?,'General','general')", destination);
        UUID category = jdbc.queryForObject("SELECT id FROM country_categories", UUID.class);
        jdbc.update("INSERT INTO country_category_modules(category_id,module_key)"
                + " VALUES(?,'FEED')", category);
        UUID author = IdentityTestSupport.provision(context, ISSUER, "schema-author");
        UUID voter = IdentityTestSupport.provision(context, ISSUER, "schema-voter");
        for (UUID user : List.of(author, voter)) {
            communityService.join(user, community);
        }
        var poll = service.createPoll(author, community, category, "Preserved",
                List.of("A", "B"), null);
        service.vote(voter, poll.options().get(0).id(), false);

        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM"
                + " flyway_schema_history WHERE NOT success", Integer.class));
        assertEquals(12, jdbc.queryForObject("SELECT max(version::integer) FROM"
                + " flyway_schema_history WHERE success", Integer.class));
        assertEquals(3, jdbc.queryForObject("SELECT count(*) FROM pg_constraint"
                + " WHERE contype='p' AND conrelid IN ('feed_polls'::regclass,"
                + "'feed_poll_options'::regclass,'feed_poll_votes'::regclass)",
                Integer.class));
        assertEquals(5, jdbc.queryForObject("SELECT count(*) FROM pg_constraint"
                + " WHERE contype='f' AND conrelid IN ('feed_polls'::regclass,"
                + "'feed_poll_options'::regclass,'feed_poll_votes'::regclass)",
                Integer.class));
        assertTrue(jdbc.queryForObject("SELECT count(*) FROM pg_constraint"
                + " WHERE conrelid='feed_poll_options'::regclass AND contype='u'"
                + " AND pg_get_constraintdef(oid) LIKE '%(post_id, sort_order)%'",
                Integer.class) >= 1);
        assertEquals(5, jdbc.queryForObject("SELECT count(*) FROM pg_trigger"
                + " WHERE NOT tgisinternal AND tgname IN"
                + " ('trg_feed_poll_option_integrity','trg_feed_poll_vote_integrity',"
                + "'trg_feed_poll_configuration_integrity',"
                + "'trg_feed_poll_close_integrity','trg_published_poll_has_options')",
                Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM pg_indexes"
                + " WHERE indexname='ix_poll_votes_user'", Integer.class));

        flyway.validate();
        flyway.migrate();
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM feed_polls"
                + " WHERE post_id=?", Integer.class, poll.postId()));
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM feed_poll_options"
                + " WHERE post_id=?", Integer.class, poll.postId()));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM feed_poll_votes v"
                + " JOIN feed_poll_options o ON o.id=v.option_id WHERE o.post_id=?",
                Integer.class, poll.postId()));
    }
}
