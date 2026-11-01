package com.diasporum.backend.taxonomy.internal.application;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Repeatable, idempotent upsert-based seeding for *baseline* reference data
 * (countries, languages, interests). Communities are administrator-managed and
 * are excluded from production seeding, but a {@code seedCommunities} helper
 * is provided for development/local environments.
 *
 * <p>Semantics: keyed on the stable natural key ({@code iso2} / {@code
 * language_code} / {@code interest_key} / {@code origin+destination} pair).
 * Missing rows are inserted; existing rows are updated only in display fields
 * ({@code ON CONFLICT DO UPDATE}). Admin-managed flags like {@code is_active}
 * are intentionally NOT overridden on existing rows so operator curation is
 * preserved on re-runs.
 */
@Service
public class TaxonomyReferenceSeeder {

    public record CountrySeed(String name, String iso2, String iso3,
            String demonym, String flagEmoji) {
    }

    public record LanguageSeed(String code, String displayName, int sortOrder) {
    }

    public record InterestSeed(String key, String displayName, String categoryKey,
            int sortOrder) {
    }

    /**
     * A diaspora community corridor: origin ISO-2 → destination ISO-2.
     * Country IDs are resolved from the countries table at seed time.
     */
    public record CommunitySeed(String originIso2, String destIso2,
            String name, String slug, String description) {
    }

    private final JdbcTemplate jdbc;

    public TaxonomyReferenceSeeder(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public int seedCountries(List<CountrySeed> seeds) {
        int n = 0;
        for (var s : seeds) {
            n += jdbc.update("INSERT INTO countries(name,iso2,iso3,demonym,flag_emoji)"
                            + " VALUES(?,?,?,?,?) ON CONFLICT(iso2) DO UPDATE SET"
                            + " name=EXCLUDED.name, iso3=EXCLUDED.iso3,"
                            + " demonym=EXCLUDED.demonym, flag_emoji=EXCLUDED.flag_emoji",
                    s.name(), s.iso2().toUpperCase(), s.iso3(), s.demonym(),
                    s.flagEmoji());
        }
        return n;
    }

    @Transactional
    public int seedLanguages(List<LanguageSeed> seeds) {
        int n = 0;
        for (var s : seeds) {
            n += jdbc.update("INSERT INTO languages(language_code,display_name,sort_order)"
                            + " VALUES(?,?,?) ON CONFLICT(language_code) DO UPDATE SET"
                            + " display_name=EXCLUDED.display_name,"
                            + " sort_order=EXCLUDED.sort_order",
                    s.code().toLowerCase().trim(), s.displayName(), s.sortOrder());
        }
        return n;
    }

    /**
     * Seeds development communities keyed on (origin_country_id, destination_country_id).
     * Country IDs are resolved from the countries table by ISO-2 code.
     * Skips rows where either country is not yet in the database.
     * ON CONFLICT DO NOTHING — does not overwrite admin-curated communities.
     */
    @Transactional
    public int seedCommunities(List<CommunitySeed> seeds) {
        int n = 0;
        for (var s : seeds) {
            n += jdbc.update(
                "INSERT INTO communities(name,slug,origin_country_id,destination_country_id,description)"
                + " SELECT ?,?,"
                + "   (SELECT id FROM countries WHERE iso2=?),"
                + "   (SELECT id FROM countries WHERE iso2=?),"
                + "   ?"
                + " WHERE (SELECT id FROM countries WHERE iso2=?) IS NOT NULL"
                + "   AND (SELECT id FROM countries WHERE iso2=?) IS NOT NULL"
                + " ON CONFLICT(origin_country_id,destination_country_id) DO NOTHING",
                s.name(), s.slug(),
                s.originIso2().toUpperCase(), s.destIso2().toUpperCase(),
                s.description(),
                s.originIso2().toUpperCase(), s.destIso2().toUpperCase());
        }
        return n;
    }

    @Transactional
    public int seedInterests(List<InterestSeed> seeds) {
        int n = 0;
        for (var s : seeds) {
            n += jdbc.update("INSERT INTO interests(interest_key,display_name,"
                            + " category_key,sort_order) VALUES(?,?,?,?)"
                            + " ON CONFLICT(interest_key) DO UPDATE SET"
                            + " display_name=EXCLUDED.display_name,"
                            + " category_key=EXCLUDED.category_key,"
                            + " sort_order=EXCLUDED.sort_order",
                    s.key().toLowerCase().trim(), s.displayName(), s.categoryKey(),
                    s.sortOrder());
        }
        return n;
    }
}
