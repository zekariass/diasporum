# Diasporum v10.13 Shop Marketplace SQL package

Prepared: 4 November 2026
Baseline: the user-supplied Diasporum v10.12 PostgreSQL/PostGIS clean-install schema.

## Files

- `Diasporum_PostgreSQL_Schema_v10_13.sql` — full v10.13 fresh-install schema candidate. It contains the supplied v10.12 schema body with marketplace-specific extensions to shared contracts and 74 new marketplace tables, plus the shared `location_places` reference-data catalogue and the `user_discovery_locations.location_place_id` link.
- `Diasporum_v10_13_strict_clean_install.sql` — same full schema wrapped in `BEGIN`/`COMMIT` for a disposable fresh database.
- `Diasporum_v10_13_Shop_Marketplace_Smoke_Test.sql` — marketplace catalog assertions plus `location_places` catalog/behaviour assertions to run after a successful fresh install; the script rolls back its transaction.
- `Diasporum_Shop_Marketplace_Data_Model_v10_13.md` — logical table definitions and design rules, including §25 documenting `location_places` as shared platform reference data (not a marketplace table).
- `Diasporum_System_Design_v10_13.docx` and `.pdf` — consolidated system design.
- `Diasporum_v10_13_Change_and_Decision_Report.md` — change summary and validation status.
- `Diasporum_Default_Extended_Community_System_Design.md` — implemented Default/Extended Community access, Billing, mobile and administration architecture supplement.
- `DIASPORUM_DEFAULT_EXTENDED_COMMUNITY_IMPLEMENTATION_REPORT.md` — implementation scope, automated verification and remaining runtime/deployment limits.
- `../diasporum-backend/docs/community-access-api-v1.yaml` — OpenAPI 3.1 access, eligibility, publication replay and administration contract.
- `../diasporum-backend/src/main/resources/db/migration/V24__default_extended_community_access.sql` — additive application-database migration for the implemented Default/Extended model.

## Critical usage warning

The v10.13 SQL is a **clean-install candidate**, not an in-place upgrade script. Run it only against a brand-new, empty PostgreSQL 15+ database with PostGIS available. Never run it over an existing Diasporum database. The supplied v10.12 SQL is not modified.

No Flyway migration version is assigned to the Shop Marketplace or `location_places` design proposals. Before implementing or upgrading those portions, inspect the actual Flyway history and deployed schema, then split the changes into an additive migration sequence and rehearse that sequence against a restored copy. Do not modify an already-applied migration.

The separate implemented Default/Extended Community supplement does have an application migration: `V24__default_extended_community_access.sql`. Deploy that migration through the backend's normal Flyway process after backup and restored-copy rehearsal; do not substitute either clean-install SQL file for an in-place upgrade. Section 26 of the data-model document describes its schema objects and reuse of the existing `idempotency_keys` table.

## Validation status

Static checks confirmed: 74 unique marketplace table declarations; every table reference in the marketplace section points to a table declared in the full schema; no subquery was found inside a CHECK constraint; SQL delimiters are balanced; marketplace enum, media purpose, featured placement and conversation context changes are present; `location_places` is declared after `countries` and before `user_discovery_locations` gains its `location_place_id` foreign key; canonical and strict schema bodies are byte-identical apart from the `BEGIN`/`COMMIT` wrapper.

**Live check performed:** the strict clean-install file executed end-to-end on a disposable `postgis/postgis:17-3.5` container (fresh database) and the smoke test passed all marketplace and `location_places` assertions inside a rolled-back transaction. Still untested: transaction concurrency, RLS (if later introduced), application services, Stripe, Shippo and tax provider workflows.

## Key design boundaries

- Marketplace commerce is separate from the existing lead/contact Service Marketplace.
- Existing `users`, `profiles`, Business Accounts, `countries`, `addresses`, `media_objects`, Billing entitlements, featured placements, reports/moderation, Messaging, Notifications, `audit_logs`, `idempotency_keys` and `outbox_events` are reused.
- Subscription billing tables are not reused for customer product orders/payments.
- Seller transfer and bank payout are different records/states.
- Tax is provider-backed; the SQL stores registration, calculation, liability and document snapshots, not a homemade global tax rules engine.
- Global market availability must be explicitly enabled country by country.
- `location_places` is shared platform reference data (searchable city/town/place catalogue), not a Shop Marketplace table. It ships no fabricated worldwide dataset — only schema, constraints, triggers and an approved-source import strategy.
- Matchmaking discovery keeps two separate concepts: optional private `addresses` references and the consented approximate `user_discovery_locations` point. Catalogue selections store `CITY_CENTRE` with a database-derived place-centre point; device fixes stay `DEVICE_APPROXIMATE` with no catalogue link required.
