# Diasporum v10.11 deliverables

This release carries forward v10.9 platform decisions and the v10.10 Reels feature, then adds structured **Community Help & Offers** as v10.11. It is a clean-install baseline, not an in-place migration.

## Files

- `Diasporum_System_Design_v10_11.docx` — editable full system design with Appendix M for Community Help & Offers.
- `Diasporum_System_Design_v10_11.pdf` — PDF viewing copy.
- `Diasporum_PostgreSQL_Schema_v10_11.sql` — canonical PostgreSQL/PostGIS schema.
- `Diasporum_v10_11_strict_clean_install.sql` — matching schema body wrapped in `BEGIN`/`COMMIT`; use only with a new, empty PostgreSQL 15+ database with PostGIS available.
- `Diasporum_v10_11_Smoke_Test.sql` — executable catalog assertions plus application integration scenarios.
- `Diasporum_v10_11_Change_and_Audit_Report.md` — changes, static checks, and outstanding validation.
- `Diasporum_Spring_Boot_REST_API_Folder_Structure_v10_11.md` — REST-first modular-monolith structure, including Reels and Community Help responsibilities.
- `README_v10_11.md` — this guide.

## Community Help & Offers design

- `feed_posts.post_type='COMMUNITY_HELP'` reuses existing feed content, categories, visibility, publication/moderation, comments, reactions, media and reports.
- `category_module` gains `COMMUNITY_HELP`; country-specific help categories are configured in `country_categories` and mapped through `country_category_modules`.
- `community_help_posts` is the only new feature table. It stores `help_kind` (`REQUEST`/`OFFER`), `help_status` (`OPEN`, `PAUSED`, `RESOLVED`, `CLOSED`, `EXPIRED`), optional expiry and managed terminal timestamps.
- Responses reuse direct conversations with `context_type='COMMUNITY_HELP_POST'` and `context_id=feed_posts.id`. There is no separate response or chat table.
- Create the `feed_posts` parent as DRAFT, insert its lifecycle row, and publish after validation/moderation. A scheduled Spring Boot/Quartz job transitions due OPEN/PAUSED entries to EXPIRED.
- Paid professional work remains in the Service Marketplace; Community Help is for informal assistance, donations, language practice, newcomer support and volunteering.

## Reels design carried forward

- Reels use `feed_posts` with `post_type='REEL'` and reuse feed media/social tables.
- Community and Following are chronological. Nearby uses PostGIS distance between viewer and creator current addresses. No filming-location field, `reel_details` table, per-Reel Nearby toggle or extra Nearby opt-in setting is included.
- No AI ranking service is required for the initial release.

## Installation and migration warning

Use only one of the two SQL files for a fresh installation; their schema bodies match. Never run the strict clean-install script against a populated database. A live v10.8/v10.9/v10.10 deployment requires a separately designed migration, data backfill, rehearsal and rollback/forward-fix plan. Do not treat the clean-install baseline as an upgrade script.

## Validation status

Static checks include SQL-body equivalence, code-level object/trigger references, presence of new Community Help constraints and DOCX/PDF rendering. SQL has **not** been executed against a live PostgreSQL/PostGIS server in this environment. Run the strict clean install and smoke tests on disposable staging, then execute API integration tests for lifecycle transitions, conversation context, permissions, expiration, privacy and moderation before production.
