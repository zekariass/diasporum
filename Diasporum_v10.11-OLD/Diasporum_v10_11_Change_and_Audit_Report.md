# Diasporum v10.11 change and audit report

**Baseline:** v10.10 schema/system-design package (including Reels).  
**New version:** v10.11 (Community Help & Offers release).  
**Database state:** Static checks only; no live PostgreSQL/PostGIS execution is claimed. This is a clean-install baseline, not an in-place migration.

## v10.11 release delta — Community Help & Offers

- Added `COMMUNITY_HELP` to `feed_posts.post_type`; the post continues to reuse the feed author, text, community/audience, publication/moderation lifecycle, media, comments, reactions, reports and other social infrastructure.
- Added `COMMUNITY_HELP` to `category_module`. Country categories mapped to this module are used for help categories, and `validate_feed_post_country_category()` validates Community Help posts against the right category module while preserving `FEED` for other post types.
- Added one table, `community_help_posts`, keyed one-to-one by `feed_posts.id`. It stores `REQUEST`/`OFFER`, `OPEN`/`PAUSED`/`RESOLVED`/`CLOSED`/`EXPIRED`, optional expiry and database-managed terminal timestamps.
- Added feed/metadata integrity triggers: a published Community Help post must have lifecycle metadata; lifecycle metadata must reference a Community Help post; metadata cannot be deleted independently from a published help post; help kind and post ID are immutable; terminal states cannot reopen; due expiry and managed timestamps are enforced.
- Added `COMMUNITY_HELP_POST` as a direct-message context. The existing contextual conversation uniqueness is reused; new context threads require the parent to be published and OPEN, the post author to participate, and existing messaging permission/block/privacy checks remain in force.
- Did not add a response table, separate help chat, separate comments/reactions, new location data, payment workflow or new marketplace. Responses reuse contextual direct conversations; paid professional work remains in `servicemarketplace`.
- Added database smoke assertions and API acceptance scenarios for category module mapping, draft-to-publication lifecycle, state transitions, expiry, response conversation reuse, permissions and moderation.

## v10.10 Reels carried forward

- Reels remain `feed_posts.post_type='REEL'`, using `feed_post_media` and `media_objects`.
- Community, Nearby and Following feed modes remain. Nearby uses viewer-to-creator current-address PostGIS distance; exact addresses/coordinates and numeric distance must not be returned in feed DTOs.
- No `reel_details`, per-Reel Nearby toggle or separate Nearby opt-in setting is introduced.

## v10.9 platform decisions carried forward

Follow-derived mutual connections, persistent voice-room definitions and disposable live sessions, moderation restrictions, strengthened poll rules, backend-controlled featured placements, business-account permissions/auditing, Expo push delivery, Spare Bag country normalization and existing billing/entitlement semantics remain part of the schema baseline.

## Static inventory

Counts are calculated from the canonical SQL source as text. They are not proof that PostgreSQL successfully created each object.

| Object type | Count |
|---|---:|
| `CREATE TABLE statements` | 162 |
| `CREATE VIEW statements` | 1 |
| `CREATE TYPE statements` | 44 |
| `CREATE OR REPLACE FUNCTION statements` | 114 |
| `CREATE TRIGGER statements` | 149 |
| `Explicit CREATE [UNIQUE] INDEX statements` | 209 |
| `ALTER TABLE ... ADD CONSTRAINT statements` | 17 |

## Static checks performed

- Both SQL variants have equivalent canonical schema bodies; the strict variant wraps the body in `BEGIN`/`COMMIT`.
- Checked balanced dollar-quote delimiters, object declarations, trigger-function references, removed legacy friendship objects, removed Spare Bag `listing_country_id`, no vehicle `insurance_group`, and required Reels and Community Help tables/columns/triggers.
- Checked `category_module` includes `COMMUNITY_HELP`, `feed_posts` supports `COMMUNITY_HELP`, the contextual conversation constraint includes `COMMUNITY_HELP_POST`, and `normalize_and_validate_direct_conversation()` validates published/open Community Help targets.
- Smoke tests include catalog assertions and a documented integration plan for ownership/visibility, lifecycle, expiry, message-context reuse and permission/security checks.
- The v10.11 system design and PDF were regenerated and render-checked. Final live database validation remains outstanding.

## Live validation required before production

1. Run `Diasporum_v10_11_strict_clean_install.sql` on a disposable empty PostgreSQL 15+ database with PostGIS enabled.
2. Run `Diasporum_v10_11_Smoke_Test.sql` and test that the install transaction commits and the catalog assertions pass.
3. Race-test concurrent status changes, expiry job, help response conversation creation, block/privacy changes and direct-message quotas.
4. Test moderation/removal, audience visibility, country-category module mapping, expiry semantics and notification/outbox idempotency via the real API.
5. If upgrading an existing v10.8/v10.9/v10.10 deployment, design a separate versioned migration with backfill and rehearsal; do not run clean-install SQL over it.

## Residual caveats

- No live SQL install has been executed, so PL/pgSQL syntax and runtime trigger ordering have not been proven by a PostgreSQL server.
- The app must provide country-specific Community Help categories and map them to `category_module.COMMUNITY_HELP` during admin/bootstrap configuration.
- A scheduled Spring Boot/Quartz task must transition due OPEN/PAUSED rows to EXPIRED. A future `expires_at` alone does not change `help_status` without that job.
- Direct conversations are not a substitute for backend privacy/block authorization; the API must check blocks and messaging policy on every relevant request.
