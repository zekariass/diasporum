package com.diasporum.backend.sparebag.internal.application.v2;

import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.bad;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.conflict;

import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Category;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.CountryConfig;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.CountryConfigInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.CountryRules;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.MeasurementUnit;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.SpareBagReferenceRepository;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reference data (V32 units, categories) and per-country rules
 * ({@code spare_bag_country_config}). A country with no config row gets the
 * column defaults: enabled, item disclosure required, nothing prohibited.
 */
@Service
public class SpareBagReferenceService {

    private final SpareBagReferenceRepository repository;
    private final TaxonomyApi taxonomy;
    private final SpareBagModeration moderation;

    public SpareBagReferenceService(SpareBagReferenceRepository repository,
            TaxonomyApi taxonomy, SpareBagModeration moderation) {
        this.repository = repository;
        this.taxonomy = taxonomy;
        this.moderation = moderation;
    }

    @Transactional(readOnly = true)
    public List<MeasurementUnit> units() {
        return repository.units();
    }

    @Transactional(readOnly = true)
    public List<Category> categories() {
        return repository.activeCategories();
    }

    @Transactional(readOnly = true)
    public CountryConfig countryConfig(UUID countryId) {
        requireActiveCountry(countryId);
        return config(countryId);
    }

    @Transactional
    public CountryConfig upsertCountryConfig(UUID actor, UUID countryId, CountryConfigInput in) {
        moderation.requirePlatformAdmin(actor);
        requireActiveCountry(countryId);
        CountryConfig current = config(countryId);
        List<String> prohibited = in.prohibitedCategories() == null
                ? current.prohibitedCategories()
                : new ArrayList<>(validCategories(in.prohibitedCategories()));
        repository.upsertCountryConfig(countryId,
                in.enabled() == null ? current.enabled() : in.enabled(),
                in.requiresItemDisclosure() == null ? current.requiresItemDisclosure()
                        : in.requiresItemDisclosure(),
                prohibited, in.legalNotice() == null ? current.legalNotice()
                        : SpareBagV2Support.trimToNull(in.legalNotice()));
        return config(countryId);
    }

    /** Merged rules for a route (origin + destination). */
    public CountryRules rules(UUID fromCountryId, UUID toCountryId) {
        CountryConfig from = config(fromCountryId);
        CountryConfig to = config(toCountryId);
        Set<String> prohibited = new LinkedHashSet<>();
        if (from.prohibitedCategories() != null) prohibited.addAll(from.prohibitedCategories());
        if (to.prohibitedCategories() != null) prohibited.addAll(to.prohibitedCategories());
        return new CountryRules(from.enabled() && to.enabled(),
                from.requiresItemDisclosure() || to.requiresItemDisclosure(), prohibited);
    }

    /** Both countries active (taxonomy) and enabled for Spare Bag. */
    public CountryRules requirePostableRoute(UUID fromCountryId, UUID toCountryId) {
        requireActiveCountry(fromCountryId);
        requireActiveCountry(toCountryId);
        CountryRules rules = rules(fromCountryId, toCountryId);
        if (!rules.enabled()) {
            throw conflict("SPARE_BAG_COUNTRY_DISABLED");
        }
        return rules;
    }

    public static void rejectProhibited(CountryRules rules, Collection<String> categories) {
        if (categories != null && categories.stream().anyMatch(
                c -> c != null && rules.prohibitedCategories().contains(c))) {
            throw bad("PROHIBITED_CATEGORY");
        }
    }

    public void requireActiveCountry(UUID countryId) {
        if (countryId == null || !taxonomy.isCountryActive(countryId)) {
            throw bad("COUNTRY_INVALID");
        }
    }

    /**
     * Normalises (trim, upper-case, de-duplicate) and validates category keys
     * against active {@code spare_bag_categories}; null stays null.
     */
    public List<String> validCategories(Collection<String> keys) {
        if (keys == null) {
            return null;
        }
        Set<String> active = repository.activeCategories().stream().map(Category::key)
                .collect(Collectors.toSet());
        Set<String> out = new LinkedHashSet<>();
        for (String key : keys) {
            String k = SpareBagV2Support.upper(key);
            if (k == null || !active.contains(k)) {
                throw bad("INVALID_CATEGORY");
            }
            out.add(k);
        }
        return new ArrayList<>(out);
    }

    public Set<String> unitCodes() {
        return repository.units().stream().map(MeasurementUnit::unitCode)
                .collect(Collectors.toSet());
    }

    /** Country of an active airport, or 400 {@code AIRPORT_INVALID}. */
    public UUID airportCountry(UUID airportId) {
        return repository.activeAirportCountry(airportId)
                .orElseThrow(() -> bad("AIRPORT_INVALID"));
    }

    private CountryConfig config(UUID countryId) {
        return repository.countryConfig(countryId).orElse(
                new CountryConfig(countryId, true, true, List.of(), null, false));
    }
}
