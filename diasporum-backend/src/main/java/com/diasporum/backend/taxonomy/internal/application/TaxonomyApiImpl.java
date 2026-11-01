package com.diasporum.backend.taxonomy.internal.application;

import com.diasporum.backend.taxonomy.TaxonomyApi;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Delegating implementation of {@link TaxonomyApi}. */
@Service
public class TaxonomyApiImpl implements TaxonomyApi {

    private final TaxonomyService service;

    public TaxonomyApiImpl(TaxonomyService service) {
        this.service = service;
    }

    @Override
    public Optional<CountryView> findCountryById(UUID id) {
        return service.countryById(id);
    }

    @Override
    public Optional<CountryView> findCountryByIso2(String iso2) {
        return service.countryByIso2(iso2);
    }

    @Override
    public boolean isCountryActive(UUID id) {
        return service.isCountryActive(id);
    }

    @Override
    public List<CountryView> activeCountries() {
        return service.activeCountries();
    }

    @Override
    public Optional<LanguageView> findLanguageById(UUID id) {
        return service.languageById(id);
    }

    @Override
    public Optional<LanguageView> findLanguageByCode(String code) {
        return service.languageByCode(code);
    }

    @Override
    public boolean isLanguageActive(String code) {
        return service.isLanguageActive(code);
    }

    @Override
    public List<LanguageView> activeLanguages() {
        return service.activeLanguages();
    }

    @Override
    public Optional<CommunityView> findCommunityById(UUID id) {
        return service.communityById(id);
    }

    @Override
    public boolean isCommunityActive(UUID id) {
        return service.isCommunityActive(id);
    }

    @Override
    public List<CommunityView> communitiesForOriginCountry(UUID originCountryId) {
        return service.communities(true, originCountryId, null, 0, 500);
    }

    @Override
    public Optional<CommunityView> findCommunityByPair(UUID originCountryId, UUID destinationCountryId) {
        return service.communityByPair(originCountryId, destinationCountryId);
    }

    @Override
    public Optional<CategoryView> findCategory(UUID categoryId) {
        return service.findCategory(categoryId);
    }

    @Override
    public boolean isCategoryActiveInCountry(UUID categoryId, UUID countryId,
            String module) {
        return service.isCategoryActiveInCountry(categoryId, countryId, module);
    }

    @Override
    public Optional<InterestView> findInterestByKey(String key) {
        return service.interestByKey(key);
    }

    @Override
    public boolean isInterestActive(String key) {
        return service.isInterestActive(key);
    }
}
