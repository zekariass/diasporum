package com.diasporum.backend.taxonomy.internal.api.rest;

import com.diasporum.backend.taxonomy.TaxonomyApi.CommunityView;
import com.diasporum.backend.taxonomy.TaxonomyApi.CountryView;
import com.diasporum.backend.taxonomy.TaxonomyApi.InterestView;
import com.diasporum.backend.taxonomy.TaxonomyApi.LanguageView;
import com.diasporum.backend.taxonomy.internal.application.TaxonomyService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Read-only reference-catalog endpoints under {@code /api/v1/taxonomy}.
 * Authenticated by the default security policy; no admin write operations.
 */
@RestController
@RequestMapping("/api/v1/taxonomy")
public class TaxonomyController {

    private final TaxonomyService service;

    public TaxonomyController(TaxonomyService service) {
        this.service = service;
    }

    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_PAGE_SIZE = 200;

    private static int clamp(int v, int def, int max) {
        return v <= 0 ? def : Math.min(v, max);
    }

    @GetMapping("/countries")
    public Map<String, Object> countries(
            @RequestParam(required = false) Boolean active,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        size = clamp(size, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        return page(service.countries(active, search, page, size),
                service.countCountries(active, search), page, size);
    }

    @GetMapping("/countries/{id}")
    public CountryView country(@PathVariable UUID id) {
        return service.countryById(id).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "COUNTRY_NOT_FOUND"));
    }

    @GetMapping("/languages")
    public Map<String, Object> languages(
            @RequestParam(required = false) Boolean active,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        size = clamp(size, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        return page(service.languages(active, search, page, size),
                service.countLanguages(active, search), page, size);
    }

    @GetMapping("/languages/{id}")
    public LanguageView language(@PathVariable UUID id) {
        return service.languageById(id).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "LANGUAGE_NOT_FOUND"));
    }

    @GetMapping("/communities")
    public Map<String, Object> communities(
            @RequestParam(required = false) Boolean active,
            @RequestParam(required = false) UUID originCountryId,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        size = clamp(size, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        return page(service.communities(active, originCountryId, search, page, size),
                service.countCommunities(active, originCountryId, search), page, size);
    }

    @GetMapping("/communities/{id}")
    public CommunityView community(@PathVariable UUID id) {
        return service.communityById(id).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "COMMUNITY_NOT_FOUND"));
    }

    /**
     * Country practical categories for a module — the feed category-filter
     * contract documented as GET /categories?module=FEED. The caller supplies
     * the destination country (active community's destinationCountryId).
     */
    @GetMapping("/categories")
    public Map<String, Object> categories(
            @RequestParam UUID countryId,
            @RequestParam String module) {
        return Map.of("items",
                service.categoriesForCountryModule(countryId, module));
    }

    @GetMapping("/interests")
    public Map<String, Object> interests(
            @RequestParam(required = false) Boolean active,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        size = clamp(size, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
        return page(service.interests(active, category, search, page, size),
                service.countInterests(active, category, search), page, size);
    }

    @GetMapping("/interests/{key}")
    public InterestView interest(@PathVariable String key) {
        return service.interestByKey(key).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INTEREST_NOT_FOUND"));
    }

    private static Map<String, Object> page(List<?> items, Object total, int page,
            int size) {
        return Map.of("items", items, "total", total, "page", page, "size", size);
    }
}
