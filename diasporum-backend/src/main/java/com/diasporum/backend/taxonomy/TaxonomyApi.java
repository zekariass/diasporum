package com.diasporum.backend.taxonomy;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Public API of the taxonomy module: shared reference data (countries,
 * languages, communities, interests). Other modules consume only this
 * interface — never {@code taxonomy.internal.*}.
 */
public interface TaxonomyApi {

    Optional<CountryView> findCountryById(UUID id);

    Optional<CountryView> findCountryByIso2(String iso2);

    boolean isCountryActive(UUID id);

    /** Active countries sorted by name — onboarding pickers. */
    List<CountryView> activeCountries();

    Optional<LanguageView> findLanguageById(UUID id);

    Optional<LanguageView> findLanguageByCode(String code);

    boolean isLanguageActive(String code);

    List<LanguageView> activeLanguages();

    Optional<CommunityView> findCommunityById(UUID id);

    boolean isCommunityActive(UUID id);

    /** Active communities for an origin country — diaspora eligibility listing. */
    List<CommunityView> communitiesForOriginCountry(UUID originCountryId);

    /** Exact community for an origin+destination country pair, if it exists. */
    Optional<CommunityView> findCommunityByPair(UUID originCountryId, UUID destinationCountryId);

    /** Country content category (feed posts require one), if it exists. */
    Optional<CategoryView> findCategory(UUID categoryId);

    /** True if the category exists, is active, belongs to {@code countryId},
     * and is enabled for {@code module} ('FEED','EVENT','COMMUNITY_HELP'). */
    boolean isCategoryActiveInCountry(UUID categoryId, UUID countryId,
            String module);

    record CategoryView(UUID id, UUID countryId, String name, String slug,
            boolean active) {
    }

    Optional<InterestView> findInterestByKey(String key);

    boolean isInterestActive(String key);

    record CountryView(UUID id, String name, String iso2, String iso3,
            String demonym, String flagEmoji, boolean active) {
    }

    record LanguageView(UUID id, String languageCode, String displayName,
            boolean active, int sortOrder) {
    }

    record CommunityView(UUID id, String name, String slug, UUID originCountryId,
            UUID destinationCountryId, String description, boolean active) {
    }

    record InterestView(UUID id, String interestKey, String displayName,
            String categoryKey, boolean active, int sortOrder) {
    }
}
