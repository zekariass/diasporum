# Diasporum v10.12 change and audit report

**Baseline:** v10.11 system design, PostgreSQL/PostGIS schema and supporting project files.  
**New version:** v10.12 — first-party authentication and account identity redesign.  
**Database state:** Static review and consistency checks only; no live PostgreSQL/PostGIS execution is claimed. This is a clean-install baseline, not an in-place migration.

## v10.12 release delta — authentication and identity

- Added `users` as the permanent account identity, with primary email, generated normalized email, email verification state, account status and account lifecycle timestamps.
- Redesigned `profiles` as an optional one-to-one extension of `users`, using the same UUID as PK/FK. Profile-specific fields remain in `profiles`; account lifecycle fields moved to `users`.
- Re-pointed user/account ownership, actor, membership and other user foreign keys from `profiles(id)` to `users(id)` so authentication and account identity do not depend on public profile completion.
- Retained `external_identities` but changed its account reference to `user_id -> users.id`; provider identity is keyed by unique `(issuer, subject)`.
- Added `user_credentials` for optional Argon2id password credentials. Google/Apple-only accounts need no password row.
- Added `user_sessions` for per-device session lifecycle and `user_refresh_tokens` for hashed, rotating refresh-token lineage/reuse detection.
- Added `email_verification_tokens` and `password_reset_tokens`; token values are random, single-use and time-limited, with only SHA-256 hashes persisted.
- Added `external_identity_credentials` as an encrypted provider-credential vault for provider lifecycle operations such as Apple refresh-token revocation.
- Added `PENDING_VERIFICATION` to `account_status` and added a trigger to revoke all active sessions/refresh tokens when an account becomes suspended, deletion-pending or deleted.
- Preserved one primary email per account. New Google/Apple identities are first resolved by `(issuer, subject)`; a new identity may link to an existing account only under verified-email assurance rules. Different normalized emails create separate accounts; unverified or missing email never triggers automatic linking; existing accounts are not silently merged.
- Expanded `global_user_roles` with explicit `GLOBAL`, `COUNTRY` and `COMMUNITY` assignment scope. `PLATFORM_ADMIN` is global-only.
- Preserved the v10.11 community and business role scopes. Removed `business_role_permissions` and `business_account_has_permission()`; business role capabilities move to fixed Java policy classes in the `businessaccounts` module.
- Reused `audit_logs` for security and role-assignment audit events; no separate `auth_events` or `login_attempts` table is added.

## Role model

| Scope | Roles | Storage |
|---|---|---|
| Platform | `PLATFORM_ADMIN`, `PLATFORM_MODERATOR`, `CONTENT_EDITOR`, `SUPPORT_AGENT` | `global_user_roles` with explicit scope |
| Community | `MEMBER`, `TRUSTED_HELPER`, `MODERATOR`, `COMMUNITY_ADMIN` | `community_memberships` |
| Business | `OWNER`, `ADMINISTRATOR`, `EDITOR`, `LISTING_MANAGER`, `BILLING_MANAGER` | `business_account_members` |
| Voice session | `LISTENER`, `SPEAKER`, `HOST`, `MODERATOR` | Existing voice participant/session tables |

No generic `roles`, `user_roles` or `permissions` tables are introduced. Subscription tiers and billing entitlements remain separate from security roles.

## Carried-forward v10.11 product features

Community Help & Offers remains a structured feed-post type with its own `community_help_posts` lifecycle and contextual conversations. Reels, Follow-derived mutual connections, persistent voice-room definitions, service marketplace, Business Accounts, billing, PostGIS discovery and all other approved v10.11 product design decisions remain carried forward except where v10.12 explicitly changes the account identity/authentication model or business permission storage.

## Static inventory

Counts are calculated from the canonical v10.12 SQL source as text; they are not proof that PostgreSQL successfully created each object.

| Object type | Count |
|---|---:|
| `CREATE TABLE statements` | 168 |
| `CREATE VIEW statements` | 1 |
| `CREATE TYPE statements` | 44 |
| `CREATE OR REPLACE FUNCTION statements` | 115 |
| `CREATE TRIGGER statements` | 151 |
| Explicit `CREATE [UNIQUE] INDEX` statements | 223 |
| `ALTER TABLE ... ADD CONSTRAINT` statements | 17 |

The table count is net of seven added tables and one removed table relative to v10.11 (the optional provider credential vault is included in the seven additions; `business_role_permissions` is removed). The function and trigger totals above were recounted from the final canonical SQL; all totals are static declaration counts, not proof of successful database execution.

## Static checks performed

- Confirmed the canonical and strict-install schema bodies are identical apart from the strict wrapper.
- Confirmed `users`, `user_credentials`, `user_sessions`, `user_refresh_tokens`, `email_verification_tokens`, `password_reset_tokens` and `external_identity_credentials` are declared.
- Confirmed `profiles.id` is a primary-key foreign key to `users.id`, and `profiles` no longer contains `account_status` or `deleted_at`.
- Confirmed all former `REFERENCES profiles(id)` identity foreign keys are re-pointed to `users(id)`; profile-only joins remain where profile details (country or date of birth) are required.
- Confirmed `external_identities` now contains `user_id` and no `profile_id` column.
- Confirmed `global_user_roles` includes scoped assignment columns and `PLATFORM_ADMIN` is global-only.
- Confirmed `business_role_permissions` and `business_account_has_permission()` are absent from the active schema.
- Confirmed refresh-token hashes have a 32-byte constraint and token-family active uniqueness; account restriction revokes sessions through a trigger.
- Updated smoke assertions and documented API-level scenarios for provider verification, email linking, token replay, recovery, role scopes and Java policy enforcement.
- Updated the system design, API folder structure, project context and README to describe the same v10.12 architecture.

## Important design and migration caveats

- No live PostgreSQL/PostGIS install or smoke run has been performed in this environment. PL/pgSQL compilation, trigger order, PostgreSQL generated-column/index behavior, foreign-key graph and runtime concurrency must be validated on PostgreSQL 15+.
- The v10.12 schema is a clean-install baseline. For an existing v10.11 database, create a separate versioned migration. Preserve each existing `profiles.id` as the corresponding new `users.id`; populate `users.email` and `external_identities.user_id` from trusted existing identity data; reconcile null/missing/unverified emails and duplicate normalized emails before enforcing uniqueness; move account status/deletion state from profiles to users; and review every FK/trigger before deployment.
- The `users.email` uniqueness rule uses trim + lower-case only. Do not rewrite provider-specific aliases (Gmail dots or plus tags).
- Provider email claims vary in assurance. Auto-linking must require verified evidence for both sides and an additional email/account proof where Google is asserting a non-Google mailbox or provider assurance is otherwise insufficient. Never link on an unverified email string alone.
- Apple credentials required for revocation must be encrypted with a key managed outside PostgreSQL. Do not store raw ID tokens as persistent credentials.
- Argon2id parameters must be benchmarked on production hardware. Rate limiting must be distributed across backend instances; do not rely solely on in-process counters.
- Role capability rules are now code-owned. Unit and integration tests must cover every role's allowed/denied business operations and community/platform scope boundaries.

## Live validation required before production

1. Run `Diasporum_v10_12_strict_clean_install.sql` on a disposable empty PostgreSQL 15+ database with PostGIS available.
2. Run `Diasporum_v10_12_Smoke_Test.sql` and verify the install transaction commits and all catalog assertions pass.
3. Rehearse a separate v10.11-to-v10.12 migration on a copy of real data, preserving all account/profile UUIDs and reconciling email uniqueness/verification.
4. Test password registration, login, email verification, password reset, Google/Apple identity verification, email-based linking, different-email account separation and account-link conflict handling.
5. Race-test concurrent refresh, refresh-token replay/revocation, password reset, account suspension, session logout and identity unlinking.
6. Test platform/community/business role escalation boundaries and every fixed Java business role policy.
7. Run privacy, deletion, audit, moderation, messaging and full API regression tests against PostgreSQL/PostGIS.

