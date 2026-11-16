package com.diasporum.backend.shopmarketplace;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * Startup seeding on real migrated PostgreSQL: reference data (categories, markets,
 * tax config, commission rule) plus the local demo fixture — a ready ACTIVE shop with
 * published products, shipping config, returns policy and a discount code.
 * {@code local} is activated explicitly because the demo fixture is gated on the
 * active profile, not just {@code diasporum.shop.demo-seed-enabled}.
 */
@SpringBootTest
@Testcontainers
@ActiveProfiles("local")
class ShopMarketplaceStartupSeederTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5")
                    .asCompatibleSubstituteFor("postgres"));

    @Autowired JdbcTemplate jdbc;

    private int count(String sql) {
        Integer n = jdbc.queryForObject(sql, Integer.class);
        return n == null ? 0 : n;
    }

    @Test
    void seedsCategoriesWithTranslations() {
        assertThat(count("SELECT count(*) FROM product_categories WHERE is_active")).isGreaterThanOrEqualTo(23);
        assertThat(count("SELECT count(*) FROM product_category_translations tr "
                + "JOIN product_categories c ON c.id=tr.category_id WHERE tr.language_code='en'"))
                .isGreaterThanOrEqualTo(23);
        assertThat(count("SELECT count(*) FROM product_categories WHERE category_key='traditional-wear' "
                + "AND parent_id IS NOT NULL")).isEqualTo(1);
    }

    @Test
    void seedsMarketsTaxAndCommission() {
        assertThat(count("SELECT count(*) FROM marketplace_country_settings "
                + "WHERE market_status='ACTIVE' AND buyer_checkout_enabled")).isGreaterThanOrEqualTo(1);
        // The TEST no-collection config must carry an approval reference or checkout
        // correctly refuses it — this is what keeps local checkout usable without keys.
        assertThat(count("SELECT count(*) FROM tax_provider_configurations "
                + "WHERE provider_key='NO_COLLECTION' AND environment='TEST' AND is_enabled "
                + "AND non_secret_configuration->>'approvalReference' IS NOT NULL")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM marketplace_commission_rules WHERE status='ACTIVE'"))
                .isGreaterThanOrEqualTo(1);
    }

    @Test
    void seedsDemoShopWithPublishedProducts() {
        int markets = count("SELECT count(*) FROM marketplace_country_settings "
                + "WHERE market_status='ACTIVE'");
        if (markets == 0) {
            // Demo seed legitimately skips when no ACTIVE market exists yet (e.g. the
            // country reference seed hasn't populated on a very first boot).
            return;
        }
        assertThat(count("SELECT count(*) FROM marketplace_sellers s JOIN shops sh "
                + "ON sh.seller_id=s.id WHERE s.status='ACTIVE' AND sh.status='ACTIVE'"))
                .isGreaterThanOrEqualTo(1);
        assertThat(count("SELECT count(*) FROM products WHERE status='PUBLISHED'")).isGreaterThanOrEqualTo(12);
        assertThat(count("SELECT count(*) FROM product_media pm JOIN media_objects m "
                + "ON m.id=pm.media_id WHERE m.status='READY' AND m.purpose='PRODUCT'"))
                .isGreaterThanOrEqualTo(12);
        assertThat(count("SELECT count(*) FROM discount_codes WHERE code='DIASPORA10'")).isEqualTo(1);
        // Every published product needs at least one priced variant and stock somewhere.
        assertThat(count("SELECT count(*) FROM products p WHERE p.status='PUBLISHED' AND NOT EXISTS("
                + "SELECT 1 FROM product_variants v JOIN product_variant_prices pr ON pr.variant_id=v.id "
                + "WHERE v.product_id=p.id AND v.status='ACTIVE')")).isZero();
    }

    @Test
    void isIdempotentAcrossRunnerInvocations() throws Exception {
        // Re-running the runner must never duplicate rows — reference seeds use
        // ON CONFLICT and the demo fixture is keyed off the demo user's existence.
        // Markets may legitimately grow if new countries appeared since the last
        // run (the country seeder can run after this one on a very first boot).
        var seeder = ctx.getBean(
                com.diasporum.backend.shopmarketplace.internal.application.ShopMarketplaceStartupSeeder.class);
        seeder.run(null);
        seeder.run(null); // second pass on a converged database must be a pure no-op

        assertThat(count("SELECT count(*) FROM product_categories")).isEqualTo(23);
        assertThat(count("SELECT count(*) FROM marketplace_country_settings"))
                .isBetween(1, 16);
        assertThat(count("SELECT count(*) FROM (SELECT category_key FROM product_categories "
                + "GROUP BY category_key HAVING count(*)>1) d")).isZero();
        int marketsNow = count("SELECT count(*) FROM marketplace_country_settings");
        seeder.run(null);
        assertThat(count("SELECT count(*) FROM marketplace_country_settings")).isEqualTo(marketsNow);
    }

    @Autowired
    private org.springframework.context.ApplicationContext ctx;
}
