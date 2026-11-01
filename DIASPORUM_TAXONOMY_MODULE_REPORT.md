# Diasporum — Taxonomy Module Report
**Date:** 2026-10-30 — no migrations, no schema/env/Keycloak changes, no commits.

## Tables used (all existing — no new schema)
`countries`, `communities` (origin+destination FK→countries, UNIQUE pair), `languages`, `interests`. `user_languages`/`user_interests` remain identity-owned joins. `country_categories` exists but is feed/business-facing — deferred to those modules.

## `TaxonomyApi` (module root)
Records: `CountryView`, `LanguageView`, `CommunityView`, `InterestView` — public-safe, no entities/repos. Ops: `findCountryById/ByIso2`, `isCountryActive`, `activeCountries`, `findLanguageById/ByCode`, `isLanguageActive`, `activeLanguages`, `findCommunityById`, `isCommunityActive`, `findInterestByKey`, `isInterestActive`. Impl: `internal/application/TaxonomyApiImpl` → `TaxonomyService` (JdbcTemplate).

## REST (`/api/v1/taxonomy`, authenticated, read-only)
- `GET /countries?active&search&page&size` + `/{id}` — name/iso2 ILIKE search, paginated {items,total,page,size}
- `GET /languages?active&search` + `/{id}` — sort_order-ordered
- `GET /communities?active&originCountryId&search` + `/{id}` — country filter
- `GET /interests?active&category&search` + `/{key}`
404 via `ResponseStatusException` → ApiError envelope; size clamped to 200.

## Seed data — mechanism ready, dataset pending approval
`TaxonomyReferenceSeeder` — idempotent upserts on natural keys (`iso2`/`language_code`/`interest_key`), `ON CONFLICT DO UPDATE` on display fields only — **`is_active` deliberately NOT overridden** so admin curation survives re-runs. Communities excluded (admin-managed). Tested: upsert preserves deactivated flag, no duplicates. **The actual country/language dataset needs your approval before loading** — no invented production seed data was committed.

## Identity integration (boundary-respecting)
`ProfileService.requireActiveCountry` → `TaxonomyApi.isCountryActive`; `SettingsService.requireCommunity` → `TaxonomyApi.isCommunityActive`; `GET /api/v1/countries` → `TaxonomyApi.activeCountries` (dead `CountryView`+query removed). Only `taxonomy` root types cross the boundary — verified by ModuleBoundaryTest.

## Caching decision — none added
Small, indexed reference tables; PG buffer cache suffices. No Redis/dep added. Revisit with a TTL map only if profiling shows hot paths.

## Tests — 65/65 BUILD SUCCESS
`TaxonomyIntegrationTest` (4): lookups+validation, seeder idempotency+flag-preservation, HTTP search/pagination/404/401, identity country validation via TaxonomyApi. All existing suites green.

## Issues fixed during the run
`? IS NULL` binds failed PG type inference → `CAST(? AS <type>) IS NULL` on all nullable filter predicates.

## Remaining decisions
1. **Country/language dataset** — approve the list to load via the seeder
2. `country_categories` exposure — when feed/community-help modules land
3. `/api/v1/countries` (identity) vs `/api/v1/taxonomy/countries` duplication — keep both (onboarding UX) or consolidate later
