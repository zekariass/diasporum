package com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2;

import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Category;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.CountryConfig;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.MeasurementUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Seeded reference data (units, categories), country rules and airports. */
@Repository
public class SpareBagReferenceRepository {

    private static final String UNITS = "SELECT unit_code,display_name,unit_type "
            + "FROM spare_bag_measurement_units ORDER BY unit_type,unit_code";
    private static final String ACTIVE_CATEGORIES = "SELECT category_key,display_name,"
            + "sort_order FROM spare_bag_categories WHERE is_active=true "
            + "ORDER BY sort_order,category_key";
    private static final String COUNTRY_CONFIG = "SELECT country_id,is_enabled,"
            + "requires_item_disclosure,prohibited_categories,legal_notice "
            + "FROM spare_bag_country_config WHERE country_id=?";
    private static final String UPSERT_CONFIG = "INSERT INTO spare_bag_country_config("
            + "country_id,is_enabled,requires_item_disclosure,prohibited_categories,"
            + "legal_notice) VALUES(?,?,?,?::text[],?) ON CONFLICT(country_id) DO UPDATE "
            + "SET is_enabled=EXCLUDED.is_enabled,"
            + "requires_item_disclosure=EXCLUDED.requires_item_disclosure,"
            + "prohibited_categories=EXCLUDED.prohibited_categories,"
            + "legal_notice=EXCLUDED.legal_notice,updated_at=now()";
    private static final String ACTIVE_AIRPORT_COUNTRY = "SELECT a.country_id "
            + "FROM airports a JOIN countries c ON c.id=a.country_id "
            + "WHERE a.id=? AND a.is_active=true AND c.is_active=true";

    private final JdbcTemplate jdbc;

    public SpareBagReferenceRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<MeasurementUnit> units() {
        return jdbc.query(UNITS, (rs, i) -> new MeasurementUnit(rs.getString("unit_code"),
                rs.getString("display_name"), rs.getString("unit_type")));
    }

    public List<Category> activeCategories() {
        return jdbc.query(ACTIVE_CATEGORIES, (rs, i) -> new Category(
                rs.getString("category_key"), rs.getString("display_name"),
                rs.getInt("sort_order")));
    }

    public Optional<CountryConfig> countryConfig(UUID countryId) {
        return jdbc.query(COUNTRY_CONFIG, (rs, i) -> new CountryConfig(
                rs.getObject("country_id", UUID.class), rs.getBoolean("is_enabled"),
                rs.getBoolean("requires_item_disclosure"),
                SqlSupport.textList(rs, "prohibited_categories"),
                rs.getString("legal_notice"), true), countryId).stream().findFirst();
    }

    public void upsertCountryConfig(UUID countryId, boolean enabled,
            boolean requiresItemDisclosure, List<String> prohibited, String legalNotice) {
        jdbc.update(UPSERT_CONFIG, countryId, enabled, requiresItemDisclosure,
                SqlSupport.textArray(prohibited), legalNotice);
    }

    /** Country of an active airport in an active country, if any. */
    public Optional<UUID> activeAirportCountry(UUID airportId) {
        return jdbc.query(ACTIVE_AIRPORT_COUNTRY,
                (rs, i) -> rs.getObject("country_id", UUID.class), airportId)
                .stream().findFirst();
    }
}
