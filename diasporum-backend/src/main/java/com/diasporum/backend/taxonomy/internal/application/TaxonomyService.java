package com.diasporum.backend.taxonomy.internal.application;

import com.diasporum.backend.taxonomy.TaxonomyApi;
import com.diasporum.backend.taxonomy.TaxonomyApi.CommunityView;
import com.diasporum.backend.taxonomy.TaxonomyApi.CountryView;
import com.diasporum.backend.taxonomy.TaxonomyApi.InterestView;
import com.diasporum.backend.taxonomy.TaxonomyApi.LanguageView;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Reference-catalog queries. Small indexed tables — no cache layer yet (see report). */
@Service
public class TaxonomyService {

    private final JdbcTemplate jdbc;

    public TaxonomyService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static CountryView country(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new CountryView(rs.getObject("id", UUID.class), rs.getString("name"),
                rs.getString("iso2"), rs.getString("iso3"), rs.getString("demonym"),
                rs.getString("flag_emoji"), rs.getBoolean("is_active"));
    }

    private static LanguageView language(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new LanguageView(rs.getObject("id", UUID.class),
                rs.getString("language_code"), rs.getString("display_name"),
                rs.getBoolean("is_active"), rs.getInt("sort_order"));
    }

    private static CommunityView community(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new CommunityView(rs.getObject("id", UUID.class), rs.getString("name"),
                rs.getString("slug"), rs.getObject("origin_country_id", UUID.class),
                rs.getObject("destination_country_id", UUID.class),
                rs.getString("description"), rs.getBoolean("is_active"));
    }

    private static InterestView interest(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new InterestView(rs.getObject("id", UUID.class),
                rs.getString("interest_key"), rs.getString("display_name"),
                rs.getString("category_key"), rs.getBoolean("is_active"),
                rs.getInt("sort_order"));
    }

    // ---- countries ----

    public List<CountryView> countries(Boolean active, String search, int page, int size) {
        var where = " WHERE (CAST(? AS boolean) IS NULL OR is_active=?) AND (CAST(? AS text) IS NULL OR name ILIKE ? OR iso2 ILIKE ?)";
        return jdbc.query("SELECT id,name,iso2,iso3,demonym,flag_emoji,is_active FROM countries"
                        + where + " ORDER BY name LIMIT ? OFFSET ?",
                (rs, i) -> country(rs), active, active, search, "%" + nn(search) + "%",
                "%" + nn(search) + "%", size, page * size);
    }

    public int countCountries(Boolean active, String search) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM countries WHERE (CAST(? AS boolean) IS NULL OR is_active=?)"
                        + " AND (CAST(? AS text) IS NULL OR name ILIKE ? OR iso2 ILIKE ?)",
                Integer.class, active, active, search, "%" + nn(search) + "%",
                "%" + nn(search) + "%");
    }

    public Optional<CountryView> countryById(UUID id) {
        return jdbc.query("SELECT id,name,iso2,iso3,demonym,flag_emoji,is_active"
                        + " FROM countries WHERE id=?", (rs, i) -> country(rs), id)
                .stream().findFirst();
    }

    public Optional<CountryView> countryByIso2(String iso2) {
        return jdbc.query("SELECT id,name,iso2,iso3,demonym,flag_emoji,is_active"
                        + " FROM countries WHERE iso2=?", (rs, i) -> country(rs),
                iso2 == null ? "" : iso2.trim().toUpperCase())
                .stream().findFirst();
    }

    public boolean isCountryActive(UUID id) {
        try {
            return Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT is_active FROM countries WHERE id=?", Boolean.class, id));
        } catch (EmptyResultDataAccessException e) {
            return false;
        }
    }

    public List<CountryView> activeCountries() {
        return jdbc.query("SELECT id,name,iso2,iso3,demonym,flag_emoji,is_active"
                        + " FROM countries WHERE is_active ORDER BY name",
                (rs, i) -> country(rs));
    }

    // ---- languages ----

    public List<LanguageView> languages(Boolean active, String search, int page, int size) {
        return jdbc.query("SELECT id,language_code,display_name,is_active,sort_order"
                        + " FROM languages WHERE (CAST(? AS boolean) IS NULL OR is_active=?)"
                        + " AND (CAST(? AS text) IS NULL OR display_name ILIKE ? OR language_code ILIKE ?)"
                        + " ORDER BY sort_order,display_name LIMIT ? OFFSET ?",
                (rs, i) -> language(rs), active, active, search,
                "%" + nn(search) + "%", "%" + nn(search) + "%", size, page * size);
    }

    public int countLanguages(Boolean active, String search) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM languages WHERE (CAST(? AS boolean) IS NULL OR is_active=?)"
                        + " AND (CAST(? AS text) IS NULL OR display_name ILIKE ? OR language_code ILIKE ?)",
                Integer.class, active, active, search, "%" + nn(search) + "%",
                "%" + nn(search) + "%");
    }

    public Optional<LanguageView> languageById(UUID id) {
        return jdbc.query("SELECT id,language_code,display_name,is_active,sort_order"
                        + " FROM languages WHERE id=?", (rs, i) -> language(rs), id)
                .stream().findFirst();
    }

    public Optional<LanguageView> languageByCode(String code) {
        return jdbc.query("SELECT id,language_code,display_name,is_active,sort_order"
                        + " FROM languages WHERE language_code=?",
                (rs, i) -> language(rs), code == null ? "" : code.toLowerCase().trim())
                .stream().findFirst();
    }

    public boolean isLanguageActive(String code) {
        try {
            return Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT is_active FROM languages WHERE language_code=?",
                    Boolean.class, code == null ? "" : code.toLowerCase().trim()));
        } catch (EmptyResultDataAccessException e) {
            return false;
        }
    }

    public List<LanguageView> activeLanguages() {
        return jdbc.query("SELECT id,language_code,display_name,is_active,sort_order"
                        + " FROM languages WHERE is_active ORDER BY sort_order,display_name",
                (rs, i) -> language(rs));
    }

    // ---- communities ----

    public List<CommunityView> communities(Boolean active, UUID originCountryId,
            String search, int page, int size) {
        return jdbc.query("SELECT id,name,slug,origin_country_id,destination_country_id,"
                        + " description,is_active FROM communities"
                        + " WHERE (CAST(? AS boolean) IS NULL OR is_active=?) AND (CAST(? AS uuid) IS NULL OR origin_country_id=?)"
                        + " AND (CAST(? AS text) IS NULL OR name ILIKE ? OR slug ILIKE ?)"
                        + " ORDER BY name LIMIT ? OFFSET ?",
                (rs, i) -> community(rs), active, active, originCountryId,
                originCountryId, search, "%" + nn(search) + "%", "%" + nn(search) + "%",
                size, page * size);
    }

    public int countCommunities(Boolean active, UUID originCountryId, String search) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM communities WHERE (CAST(? AS boolean) IS NULL OR is_active=?)"
                        + " AND (CAST(? AS uuid) IS NULL OR origin_country_id=?)"
                        + " AND (CAST(? AS text) IS NULL OR name ILIKE ? OR slug ILIKE ?)",
                Integer.class, active, active, originCountryId, originCountryId,
                search, "%" + nn(search) + "%", "%" + nn(search) + "%");
    }

    public Optional<CommunityView> communityById(UUID id) {
        return jdbc.query("SELECT id,name,slug,origin_country_id,destination_country_id,"
                        + " description,is_active FROM communities WHERE id=?",
                (rs, i) -> community(rs), id).stream().findFirst();
    }

    /** Finds the single community for an exact origin+destination pair (active or not). */
    public Optional<CommunityView> communityByPair(UUID originCountryId, UUID destinationCountryId) {
        return jdbc.query("SELECT id,name,slug,origin_country_id,destination_country_id,"
                        + " description,is_active FROM communities"
                        + " WHERE origin_country_id=? AND destination_country_id=?",
                (rs, i) -> community(rs), originCountryId, destinationCountryId)
                .stream().findFirst();
    }

    public boolean isCommunityActive(UUID id) {
        try {
            return Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT is_active FROM communities WHERE id=?", Boolean.class, id));
        } catch (EmptyResultDataAccessException e) {
            return false;
        }
    }

    // ---- interests ----

    public List<InterestView> interests(Boolean active, String category, String search,
            int page, int size) {
        return jdbc.query("SELECT id,interest_key,display_name,category_key,is_active,"
                        + " sort_order FROM interests WHERE (CAST(? AS boolean) IS NULL OR is_active=?)"
                        + " AND (CAST(? AS text) IS NULL OR category_key=?)"
                        + " AND (CAST(? AS text) IS NULL OR display_name ILIKE ? OR interest_key ILIKE ?)"
                        + " ORDER BY sort_order,display_name LIMIT ? OFFSET ?",
                (rs, i) -> interest(rs), active, active, category, category, search,
                "%" + nn(search) + "%", "%" + nn(search) + "%", size, page * size);
    }

    public int countInterests(Boolean active, String category, String search) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM interests WHERE (CAST(? AS boolean) IS NULL OR is_active=?)"
                        + " AND (CAST(? AS text) IS NULL OR category_key=?)"
                        + " AND (CAST(? AS text) IS NULL OR display_name ILIKE ? OR interest_key ILIKE ?)",
                Integer.class, active, active, category, category, search,
                "%" + nn(search) + "%", "%" + nn(search) + "%");
    }

    public Optional<InterestView> interestByKey(String key) {
        return jdbc.query("SELECT id,interest_key,display_name,category_key,is_active,"
                        + " sort_order FROM interests WHERE interest_key=?",
                (rs, i) -> interest(rs), key == null ? "" : key.toLowerCase().trim())
                .stream().findFirst();
    }

    public boolean isInterestActive(String key) {
        try {
            return Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT is_active FROM interests WHERE interest_key=?",
                    Boolean.class, key == null ? "" : key.toLowerCase().trim()));
        } catch (EmptyResultDataAccessException e) {
            return false;
        }
    }

    private static String nn(String s) {
        return s == null ? "" : s;
    }

    public Optional<TaxonomyApi.CategoryView> findCategory(UUID id) {
        return jdbc.query("SELECT id,country_id,name,slug,is_active"
                        + " FROM country_categories WHERE id=?",
                (rs, i) -> new TaxonomyApi.CategoryView(
                        rs.getObject("id", UUID.class),
                        rs.getObject("country_id", UUID.class),
                        rs.getString("name"), rs.getString("slug"),
                        rs.getBoolean("is_active")), id)
                .stream().findFirst();
    }

    /** Active country practical categories for a module (e.g. FEED) —
     * driven by country_category_modules, never hardcoded per country. */
    public List<TaxonomyApi.CategoryView> categoriesForCountryModule(
            UUID countryId, String module) {
        return jdbc.query("SELECT cc.id,cc.country_id,cc.name,cc.slug,cc.is_active"
                        + " FROM country_categories cc"
                        + " JOIN country_category_modules ccm ON ccm.category_id=cc.id"
                        + " WHERE cc.country_id=? AND cc.is_active"
                        + " AND ccm.module_key=?::category_module"
                        + " ORDER BY cc.name",
                (rs, i) -> new TaxonomyApi.CategoryView(
                        rs.getObject("id", UUID.class),
                        rs.getObject("country_id", UUID.class),
                        rs.getString("name"), rs.getString("slug"),
                        rs.getBoolean("is_active")), countryId, module);
    }

    public boolean isCategoryActiveInCountry(UUID categoryId, UUID countryId,
            String module) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM country_categories cc"
                + " JOIN country_category_modules ccm ON ccm.category_id=cc.id"
                + " WHERE cc.id=? AND cc.country_id=? AND cc.is_active"
                + " AND ccm.module_key=?::category_module",
                Integer.class, categoryId, countryId, module);
        return n != null && n > 0;
    }
}
