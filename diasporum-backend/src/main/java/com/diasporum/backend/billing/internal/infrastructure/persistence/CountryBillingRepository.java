package com.diasporum.backend.billing.internal.infrastructure.persistence;

import com.diasporum.backend.billing.internal.domain.BillingModels.CountryBillingSettings;
import com.diasporum.backend.billing.internal.domain.BillingModels.PriceOption;
import com.diasporum.backend.billing.internal.domain.BillingModels.ProviderCapability;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Reads and writes the country billing configuration layer: country policy,
 * the provider x country capability matrix, the provider registry and plan
 * price options. All billing decisions resolve through these rows, so a
 * country gaining a capability is a data change.
 */
@Repository
public class CountryBillingRepository {

    private static final String SETTINGS_COLUMNS = "country_id,billing_enabled,"
            + "subscriptions_enabled,default_currency,supported_currencies,"
            + "recurring_billing_enabled,manual_verification_enabled,prepaid_terms_enabled,"
            + "is_active";

    private static final String CAPABILITY_SELECT = "SELECT k.provider_key,p.display_name,"
            + "p.integration_type,p.is_active AS provider_active,k.country_id,k.is_enabled,"
            + "k.supports_one_time,k.supports_recurring,k.supports_refund,"
            + "k.requires_manual_verification,k.supported_currencies,k.supported_methods "
            + "FROM payment_provider_country_capabilities k "
            + "JOIN payment_providers p ON p.provider_key=k.provider_key";

    private static final String PRICE_SELECT = "SELECT pr.id,pr.plan_id,pl.plan_key,"
            + "pl.display_name AS plan_display_name,pr.country_id,pr.currency_code,pr.amount,"
            + "pr.billing_interval,pr.interval_count,pr.billing_arrangement "
            + "FROM billing_plan_prices pr "
            + "JOIN billing_plans pl ON pl.id=pr.plan_id AND pl.is_active";

    private static final String PRICE_EFFECTIVE = " AND pr.is_active AND pr.effective_from<=now()"
            + " AND (pr.effective_until IS NULL OR pr.effective_until>now())";

    private final JdbcTemplate jdbc;

    public CountryBillingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---- country policy ----

    public Optional<CountryBillingSettings> settings(UUID countryId) {
        return jdbc.query("SELECT " + SETTINGS_COLUMNS + " FROM country_billing_settings"
                        + " WHERE country_id=?",
                CountryBillingRepository::settingsRow, countryId).stream().findFirst();
    }

    public List<CountryBillingSettings> allSettings() {
        return jdbc.query("SELECT " + SETTINGS_COLUMNS + " FROM country_billing_settings"
                + " ORDER BY country_id", CountryBillingRepository::settingsRow);
    }

    /** Upsert of a country's billing policy. Arrays are pre-validated tokens. */
    public void upsertSettings(UUID countryId, boolean billingEnabled,
            boolean subscriptionsEnabled, String defaultCurrency, String supportedCurrencies,
            boolean recurringBillingEnabled, boolean manualVerificationEnabled,
            boolean prepaidTermsEnabled, boolean active, String notes) {
        jdbc.update("INSERT INTO country_billing_settings(country_id,billing_enabled,"
                        + "subscriptions_enabled,default_currency,supported_currencies,"
                        + "recurring_billing_enabled,manual_verification_enabled,"
                        + "prepaid_terms_enabled,is_active,notes)"
                        + " VALUES(?,?,?,?,?::text[],?,?,?,?,?)"
                        + " ON CONFLICT(country_id) DO UPDATE SET billing_enabled=EXCLUDED.billing_enabled,"
                        + "subscriptions_enabled=EXCLUDED.subscriptions_enabled,"
                        + "default_currency=EXCLUDED.default_currency,"
                        + "supported_currencies=EXCLUDED.supported_currencies,"
                        + "recurring_billing_enabled=EXCLUDED.recurring_billing_enabled,"
                        + "manual_verification_enabled=EXCLUDED.manual_verification_enabled,"
                        + "prepaid_terms_enabled=EXCLUDED.prepaid_terms_enabled,"
                        + "is_active=EXCLUDED.is_active,notes=EXCLUDED.notes,updated_at=now()",
                countryId, billingEnabled, subscriptionsEnabled, defaultCurrency,
                supportedCurrencies, recurringBillingEnabled, manualVerificationEnabled,
                prepaidTermsEnabled, active, notes);
    }

    // ---- provider registry ----

    public boolean providerExists(String providerKey) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM payment_providers"
                + " WHERE provider_key=?", Integer.class, providerKey);
        return count != null && count > 0;
    }

    /** Provider config JSON, used by adapters for account details and credentials. */
    public Optional<String> providerConfig(String providerKey) {
        return jdbc.query("SELECT config::text FROM payment_providers WHERE provider_key=?",
                (rs, i) -> rs.getString(1), providerKey).stream().findFirst();
    }

    public void updateProvider(String providerKey, boolean active, String configJson) {
        jdbc.update("UPDATE payment_providers SET is_active=?,"
                        + "config=COALESCE(?::jsonb,config),updated_at=now()"
                        + " WHERE provider_key=?", active, configJson, providerKey);
    }

    // ---- capability matrix ----

    public List<ProviderCapability> capabilities(UUID countryId) {
        return jdbc.query(CAPABILITY_SELECT + " WHERE k.country_id=? ORDER BY k.provider_key",
                CountryBillingRepository::capabilityRow, countryId);
    }

    public Optional<ProviderCapability> capability(String providerKey, UUID countryId) {
        return jdbc.query(CAPABILITY_SELECT + " WHERE k.provider_key=? AND k.country_id=?",
                        CountryBillingRepository::capabilityRow, providerKey, countryId)
                .stream().findFirst();
    }

    /** Upsert of one provider x country capability. Arrays are pre-validated tokens. */
    public void upsertCapability(String providerKey, UUID countryId, boolean enabled,
            boolean supportsOneTime, boolean supportsRecurring, boolean supportsRefund,
            boolean requiresManualVerification, String supportedCurrencies,
            String supportedMethods, String notes) {
        jdbc.update("INSERT INTO payment_provider_country_capabilities(provider_key,country_id,"
                        + "is_enabled,supports_one_time,supports_recurring,supports_refund,"
                        + "requires_manual_verification,supported_currencies,supported_methods,notes)"
                        + " VALUES(?,?,?,?,?,?,?,?::text[],?::text[],?)"
                        + " ON CONFLICT(provider_key,country_id) DO UPDATE SET"
                        + " is_enabled=EXCLUDED.is_enabled,"
                        + "supports_one_time=EXCLUDED.supports_one_time,"
                        + "supports_recurring=EXCLUDED.supports_recurring,"
                        + "supports_refund=EXCLUDED.supports_refund,"
                        + "requires_manual_verification=EXCLUDED.requires_manual_verification,"
                        + "supported_currencies=EXCLUDED.supported_currencies,"
                        + "supported_methods=EXCLUDED.supported_methods,"
                        + "notes=EXCLUDED.notes,updated_at=now()",
                providerKey, countryId, enabled, supportsOneTime, supportsRecurring,
                supportsRefund, requiresManualVerification, supportedCurrencies,
                supportedMethods, notes);
    }

    // ---- price options ----

    /**
     * Resolves one purchasable option. A country-specific row wins over the
     * currency-level default ({@code country_id IS NULL}), and the most
     * recently effective row wins within the same scope, so re-pricing a plan
     * never rewrites what an existing subscriber already bought.
     */
    public Optional<PriceOption> resolvePrice(UUID planId, UUID countryId, String currencyCode,
            String billingInterval, int intervalCount, String billingArrangement) {
        return jdbc.query(PRICE_SELECT + " WHERE pr.plan_id=? AND pr.currency_code=?"
                        + " AND pr.billing_interval=? AND pr.interval_count=?"
                        + " AND pr.billing_arrangement=?"
                        + " AND (pr.country_id=? OR pr.country_id IS NULL)" + PRICE_EFFECTIVE
                        + " ORDER BY pr.country_id NULLS LAST,pr.effective_from DESC LIMIT 1",
                CountryBillingRepository::priceRow, planId, currencyCode, billingInterval,
                intervalCount, billingArrangement, countryId).stream().findFirst();
    }

    /** A currently purchasable option. Used when starting a checkout. */
    public Optional<PriceOption> priceById(UUID priceId) {
        return jdbc.query(PRICE_SELECT + " WHERE pr.id=?" + PRICE_EFFECTIVE,
                CountryBillingRepository::priceRow, priceId).stream().findFirst();
    }

    /**
     * A price option regardless of whether it is still offered. Activation can
     * happen days after checkout — a manual transfer verified later — and must
     * honour the term that was bought even if the option has since been
     * retired or re-priced.
     */
    public Optional<PriceOption> purchasedPriceById(UUID priceId) {
        return jdbc.query(PRICE_SELECT.replace("AND pl.is_active", "") + " WHERE pr.id=?",
                CountryBillingRepository::priceRow, priceId).stream().findFirst();
    }

    /**
     * All currently effective, purchasable personal options visible to a
     * country: its own rows plus the currency-level defaults. Free plans are
     * excluded — a zero-amount plan is not bought.
     */
    public List<PriceOption> purchasableOptions(UUID countryId, String supportedCurrencies) {
        return jdbc.query(PRICE_SELECT + " WHERE pl.account_type='PERSONAL' AND NOT pl.is_free"
                        + " AND (pr.country_id=? OR pr.country_id IS NULL)"
                        + " AND pr.currency_code=ANY(?::text[]) AND pr.amount>0" + PRICE_EFFECTIVE
                        + " ORDER BY pl.sort_order,pl.plan_key,pr.billing_arrangement,"
                        + "pr.interval_count,pr.country_id NULLS LAST,pr.effective_from DESC",
                CountryBillingRepository::priceRow, countryId, supportedCurrencies);
    }

    public UUID insertPrice(UUID planId, UUID countryId, String currencyCode,
            java.math.BigDecimal amount, String billingInterval, int intervalCount,
            String billingArrangement) {
        return jdbc.queryForObject("INSERT INTO billing_plan_prices(plan_id,country_id,"
                        + "currency_code,amount,billing_interval,interval_count,billing_arrangement)"
                        + " VALUES(?,?,?,?,?,?,?) RETURNING id", UUID.class,
                planId, countryId, currencyCode, amount, billingInterval, intervalCount,
                billingArrangement);
    }

    /**
     * Retires a price option. Existing subscriptions keep their purchased
     * terms: a subscription snapshots its country, currency and period, and
     * never re-reads this row.
     */
    public int deactivatePrice(UUID priceId) {
        return jdbc.update("UPDATE billing_plan_prices SET is_active=false,"
                + "effective_until=COALESCE(effective_until,now()) WHERE id=?", priceId);
    }

    public Optional<UUID> planIdByKey(String planKey) {
        return jdbc.query("SELECT id FROM billing_plans WHERE plan_key=? AND is_active",
                (rs, i) -> rs.getObject("id", UUID.class), planKey).stream().findFirst();
    }

    // ---- row mappers ----

    private static CountryBillingSettings settingsRow(ResultSet rs, int i) throws SQLException {
        return new CountryBillingSettings(rs.getObject("country_id", UUID.class),
                rs.getBoolean("billing_enabled"), rs.getBoolean("subscriptions_enabled"),
                rs.getString("default_currency"), textArray(rs, "supported_currencies"),
                rs.getBoolean("recurring_billing_enabled"),
                rs.getBoolean("manual_verification_enabled"),
                rs.getBoolean("prepaid_terms_enabled"), rs.getBoolean("is_active"));
    }

    private static ProviderCapability capabilityRow(ResultSet rs, int i) throws SQLException {
        return new ProviderCapability(rs.getString("provider_key"), rs.getString("display_name"),
                rs.getString("integration_type"), rs.getBoolean("provider_active"),
                rs.getObject("country_id", UUID.class), rs.getBoolean("is_enabled"),
                rs.getBoolean("supports_one_time"), rs.getBoolean("supports_recurring"),
                rs.getBoolean("supports_refund"), rs.getBoolean("requires_manual_verification"),
                textArray(rs, "supported_currencies"), textArray(rs, "supported_methods"));
    }

    private static PriceOption priceRow(ResultSet rs, int i) throws SQLException {
        return new PriceOption(rs.getObject("id", UUID.class),
                rs.getObject("plan_id", UUID.class), rs.getString("plan_key"),
                rs.getString("plan_display_name"), rs.getObject("country_id", UUID.class),
                rs.getString("currency_code"), rs.getBigDecimal("amount"),
                rs.getString("billing_interval"), rs.getInt("interval_count"),
                rs.getString("billing_arrangement"));
    }

    private static List<String> textArray(ResultSet rs, String column) throws SQLException {
        java.sql.Array array = rs.getArray(column);
        if (array == null) {
            return List.of();
        }
        String[] values = (String[]) array.getArray();
        return List.of(values);
    }

    /** Only referenced by callers that already validated each token. */
    public static String arrayLiteral(List<String> tokens) {
        return "{" + String.join(",", tokens) + "}";
    }
}
