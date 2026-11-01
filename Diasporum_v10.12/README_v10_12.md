# Diasporum v10.12 deliverables

This release carries forward the v10.11 product/schema baseline and redesigns authentication as a first-party Spring Boot capability. It is a clean-install baseline, not an in-place migration.

## Files

- `Diasporum_System_Design_v10_12.docx` — editable full system design with the v10.12 identity/authentication appendix.
- `Diasporum_System_Design_v10_12.pdf` — PDF viewing copy.
- `Diasporum_PostgreSQL_Schema_v10_12.sql` — canonical PostgreSQL/PostGIS schema.
- `Diasporum_v10_12_strict_clean_install.sql` — matching schema body wrapped in `BEGIN`/`COMMIT`; use only with a new, empty PostgreSQL 15+ database with PostGIS available.
- `Diasporum_v10_12_Smoke_Test.sql` — executable catalog assertions plus documented application/security integration scenarios.
- `Diasporum_v10_12_Change_and_Audit_Report.md` — v10.12 changes, static checks and outstanding validation.
- `Diasporum_Spring_Boot_REST_API_Folder_Structure_v10_12.md` — REST-first modular-monolith structure and first-party identity/security module responsibilities.
- `Diasporum_Project_Context_v10_12.md` — AI coding-agent project context and approved architecture decisions.
- `README_v10_12.md` — this guide.

## v10.12 authentication and identity design

- `users` is the permanent account identity; `profiles` is an optional one-to-one profile extension (`profiles.id = users.id`). Account status and account lifecycle fields belong to `users`, not `profiles`.
- Spring Boot owns email/password authentication, account identity, social identity linking, session management, refresh-token rotation and Diasporum JWT issuance.
- Google and Apple verify external identities; they do not issue tokens for Diasporum API sessions.
- One primary normalized email per account. Email/password, Google and Apple can link to one account only under verified-email assurance rules. Different normalized emails create separate accounts. Existing provider identities resolve by `(issuer, subject)` before email matching.
- New authentication tables: `users`, `user_credentials`, `user_sessions`, `user_refresh_tokens`, `email_verification_tokens`, `password_reset_tokens`, and `external_identity_credentials` (provider credential vault for revocation operations). Existing `external_identities` is retained and references `users.id`.
- Access tokens are short-lived, asymmetrically signed Diasporum JWTs (initial target 10-15 minutes). Refresh tokens are opaque, random, stored only as SHA-256 hashes, rotated on each use and replay-detected; initial policy is a 30-day refresh lifetime with a 90-day absolute session lifetime. Validate active session state (`sid`) so revocation takes effect before JWT expiry. Expo stores refresh tokens in platform-secure storage; Next.js admin uses an HttpOnly/Secure/SameSite BFF session.
- Passwords use Argon2id (OWASP starting baseline: 19 MiB memory, two iterations, parallelism one; benchmark/tune for production). Password-only login requires a 15-character minimum, supports at least 64 characters, and does not impose arbitrary character-composition rules. Email verification and recovery tokens are single-use, time-limited and stored as hashes.

## v10.12 role model

- Platform: `PLATFORM_ADMIN`, `PLATFORM_MODERATOR`, `CONTENT_EDITOR`, `SUPPORT_AGENT`, stored in scoped `global_user_roles` assignments. `PLATFORM_ADMIN` is global-only; other roles may be global, country or community scoped.
- Community: `MEMBER`, `TRUSTED_HELPER`, `MODERATOR`, `COMMUNITY_ADMIN`, stored in `community_memberships`.
- Business: `OWNER`, `ADMINISTRATOR`, `EDITOR`, `LISTING_MANAGER`, `BILLING_MANAGER`, stored in `business_account_members`.
- Voice participant roles remain session-scoped. Subscription tiers and billing entitlements are not security roles.
- No generic roles/permissions tables. The database-driven `business_role_permissions` matrix and `business_account_has_permission()` function are removed; fixed Java role policies in the owning module define business capabilities.

## Carried-forward product decisions

- Reels continue to use `feed_posts` with `post_type='REEL'`, existing media and engagement tables, and Community/Nearby/Following modes.
- Community Help uses `feed_posts.post_type='COMMUNITY_HELP'` plus `community_help_posts`; contextual responses reuse direct conversations.
- Follow-derived mutual connections, persistent voice rooms with disposable live sessions, business account memberships, service marketplace, billing entitlements, PostGIS discovery and other v10.11 product functionality remain carried forward unless explicitly changed above.

## Installation and migration warning

Use only one of the two SQL files for a fresh installation; their schema bodies match. Never run the strict clean-install script against a populated database. The v10.12 schema changes the identity root from `profiles` to `users` and re-points account/user foreign keys. An existing v10.11 database requires a separately designed migration with a backfill that preserves every existing profile UUID as its `users.id`, rehearsals, rollback/forward-fix planning and data-integrity validation. Do not treat the clean-install baseline as an upgrade script.

## Validation status

Static consistency checks and documentation rendering are performed for this package. The SQL has not been executed against a live PostgreSQL/PostGIS server in this environment. Run the strict clean install and smoke assertions on a disposable PostgreSQL 15+ staging database, then run API integration, concurrency, privacy and security tests before production.
