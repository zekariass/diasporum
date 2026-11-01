# Diasporum --- Project Context for AI Coding Agents

> **Purpose:** This file is the starting context for any AI coding agent
> working in this repository. Read it before inspecting or changing
> code.
>
> **Current design baseline:** Diasporum System Design and PostgreSQL
> schema **v10.12**.
>
> **Status:** This document records project intent and architectural
> constraints. It does not prove that any feature is implemented or that
> the database schema has been executed successfully.

## 1. Product overview

Diasporum is a community and practical-support platform for diaspora
communities. People identify their country of origin and their current
country, join relevant communities, participate in community content,
and discover people, services and opportunities relevant to their
location.

The product has three codebases with different responsibilities:

1.  **Mobile application --- primary user experience:** React Native +
    Expo + TypeScript.
2.  **Backend --- core application and business logic:** Java + Spring
    Boot REST API, implemented as a modular monolith.
3.  **Web application --- limited scope:** Next.js website for the
    **admin/moderation console** and an **informational public-facing
    static website**. It is not the main consumer social-network
    experience. Do not assume the full mobile feed or all user-facing
    features must be recreated on the website.

The mobile app and web admin console call the backend API. Neither
client connects directly to PostgreSQL.

## 2. Product and architecture principles

-   **Mobile-first:** The primary product experience is the React Native
    Expo application.
-   **REST-first backend:** Spring Boot exposes APIs consumed by the
    mobile app and the admin website.
-   **Modular monolith:** Keep a single deployable backend initially,
    with clear domain/module boundaries. Do not introduce microservices
    without an explicit architectural decision.
-   **PostgreSQL is the durable source of truth:** Realtime providers
    deliver events; they do not replace durable database records.
-   **Server-side authorization:** Enforce account status, scoped roles, privacy,
    community visibility, moderation and billing entitlements in the backend.
    Hiding UI elements is not security.
-   **Country/community-aware:** Scope content, taxonomies and
    visibility correctly. Do not assume every item is globally visible.
-   **Provider-neutral integrations:** Isolate external vendors behind
    adapters where practical, especially for media, voice and payments.
-   **Incremental delivery:** Implement one small, testable milestone at
    a time. Avoid building the entire product in one task.
-   **Privacy and safety by design:** Protect exact addresses, sensitive
    profile preferences, private media, messages and report identities.
-   **Configuration over hard-coding:** Country-specific taxonomies,
    billing features, quotas and rollout rules should follow the
    approved design and be configurable where specified.

## 3. Technology baseline

Use the existing repository and its configuration as the source of truth
for currently installed versions. Do not upgrade versions merely for
preference.

### Mobile application (primary client)

-   React Native
-   Expo SDK --- use the version already selected for the Diasporum
    project; keep it independent from the separate Qaliye app's Expo
    SDK.
-   TypeScript
-   Expo Router if present in the initialized project
-   Secure platform-appropriate token storage for authentication

Do not copy Qaliye's `package.json`, lockfile, native configuration or
app identifiers into Diasporum.

### Backend (core system)

-   Java 21
-   Spring Boot
-   REST APIs
-   PostgreSQL with PostGIS
-   Flyway for versioned database migrations
-   Spring Security with first-party account authentication and Diasporum-issued JWTs
-   Quartz/Spring background processing where required by the design
-   Automated unit, integration and security tests

Preserve the Spring Initializr project that already exists. Inspect its
actual build tool, dependencies and versions before making changes.

### Web application (secondary, limited scope)

-   Next.js
-   TypeScript
-   Tailwind CSS if selected in the existing project

Its scope is: - Admin and moderation console with role-protected
access. - Informational, public-facing static website. - Any additional
web feature only when explicitly approved.

Do not treat Next.js as the main end-user social app or duplicate the
entire mobile app in the web client.

### Infrastructure and external providers

-   **Identity and authentication:** Spring Boot owns Diasporum accounts, local
    email/password credentials, social identity linking, sessions, refresh-token
    rotation and application token issuance. Google and Apple verify external
    identities; they do not own Diasporum sessions. Keycloak is a possible future
    migration target, not a runtime dependency in v10.12.
-   **Object storage:** Cloudflare R2 for object bytes.
-   **Realtime:** Ably for presence and realtime event delivery; durable
    state remains in PostgreSQL and is retrieved through the API.
-   **Voice:** Choose and configure one RTC/SFU provider per
    deployment/session, such as LiveKit or Cloudflare Realtime SFU. The
    provider decision remains open unless the repository documents a
    later decision.
-   **Video:** A managed video service such as Cloudflare Stream is a
    candidate, not an assumed final decision.
-   **Payments:** Stripe for web payments; mobile subscriptions/payments
    follow the approved billing and app-store design. Local/manual
    payment methods may be needed in specific markets.
-   **Mobile push:** Expo Push Notifications with token registration,
    delivery retries/receipts and invalid-token cleanup as designed.

Do not add provider SDKs or credentials before they are needed and
approved.

## 4. Main product modules

The full product scope includes the following. This list describes
intended scope, not a claim that the modules are already implemented.

-   Profiles, identity and community membership.
-   Country/community selection and switching.
-   Feed and posts, categories, media, comments, reactions, polls and
    Reels.
-   People discovery, following and blocking.
-   Direct messages, message requests and conversation contexts.
-   Persistent General Chat and temporary voice-room sessions.
-   Business accounts, business directory and reviews.
-   Events and RSVPs.
-   Jobs and applications.
-   Property and vehicle listings.
-   Spare Bag listings connecting parcel requests and traveller offers.
-   Matchmaking for eligible adults.
-   Service marketplace with service providers, job requests,
    responses/quotes, lead access, reviews and reports.
-   Community Help & Offers for informal assistance, donations, language
    practice, newcomer support and volunteering.
-   Billing, subscriptions, entitlements and usage limits.
-   Notifications and notification preferences.
-   Moderation, reporting, administration and audit logs.
-   Feature rollout/configuration and operational tooling.

## 5. Important v10.12 design decisions

Use the v10.12 system design and schema as the authoritative baseline
unless a later approved document supersedes them. v10.11 product features remain
carried forward except where explicitly changed by v10.12.

### Feed and Reels

-   Reels are a feed post type and reuse existing feed media/social
    tables; do not invent a separate Reel details table without an
    approved design change.
-   Reels modes are Community, Nearby and Following.
-   Community and Following feeds are chronological initially; no AI
    ranking service is required for MVP.
-   Nearby uses server-side PostGIS distance between the viewer's and
    creator's current-address locations, according to the approved
    design. Do not expose exact addresses, coordinates or exact numeric
    distances to clients.

### Community Help & Offers

-   Community Help is a specialised community-feed post, not a separate
    marketplace.
-   Help posts use `feed_posts.post_type = 'COMMUNITY_HELP'` and the
    `community_help_posts` lifecycle record.
-   Help kinds are `REQUEST` and `OFFER`; statuses include `OPEN`,
    `PAUSED`, `RESOLVED`, `CLOSED` and `EXPIRED`.
-   Responses reuse context-aware direct conversations with
    `context_type = 'COMMUNITY_HELP_POST'` and the feed post ID as
    context.
-   Paid professional work belongs in the Service Marketplace, not
    Community Help.

### Messaging and social relationships

-   Reuse the shared context-aware conversation system. Do not create
    duplicate chat systems for each feature.
-   Conversation context must separate conversations about distinct
    listings or other distinct subjects where required by the design.
-   Enforce message requests, privacy, block rules and conversation
    participant authorization on the backend.
-   Follow relationships are the source of truth for the social graph
    where specified; do not add redundant friendship tables without an
    approved change.
-   Matchmaking matches and follows are distinct concepts.

### Voice rooms

-   A voice room persists separately from its live session.
-   Live session comments are ephemeral and session-scoped.
-   The 30-minute grace period is a recovery window, not automatic room
    expiry.
-   Use the selected RTC/SFU for audio and Ably for realtime application
    events. Do not route audio through Ably.

### Service marketplace

-   Customers post service jobs/requests; providers discover them and
    respond/quote or request lead access according to configured rules.
-   No booking, escrow or in-app service payment lifecycle is implied by
    the current design.
-   Provider distance is based on a base location and configurable
    `radius_km`; do not reintroduce a removed coverage table.

### Billing

-   Keep feature rollout flags separate from billing/entitlement access
    rules.
-   Enforce entitlements and quotas in the backend for every protected
    action.
-   A `quantity_limit` of `NULL` means unlimited when the entitlement is
    enabled; zero means no usage is allowed; positive values are caps,
    according to the approved schema semantics.
-   Do not hard-code prices, limits or billing policy when the design
    calls for configuration.

## 5A. v10.12 account identity, authentication and roles

### Account identity and profile separation

- `users` is the permanent account identity. It owns the UUID, primary email, email verification state, account status and account lifecycle timestamps.
- `profiles` is an optional one-to-one extension of `users`; `profiles.id` is both its PK and FK to `users.id`. It contains username, display name, bio, origin/current country, city, date of birth, trust score and profile completion data.
- Do not treat `profiles` as the account or authentication table. All user ownership, actor, membership, session and role foreign keys reference `users.id` unless a relationship is explicitly about profile-only data.
- A user may authenticate and hold a session before completing onboarding and creating `profiles`.

### Authentication methods and account linking

- Support email/password, Google and Apple.
- `users.email` is the one primary email address per account; `email_normalized` is generated from trimmed, lower-case email and is unique for non-deleted accounts. Do not remove Gmail dots or plus tags or apply provider-specific email alias rules.
- `user_credentials` is optional and stores the Argon2id PHC password hash. Google/Apple-only accounts do not need a password credential.
- `external_identities` stores provider `issuer` + stable `subject` mapped to `users.id`. Lookup an existing provider subject before considering email linking.
- A new verified Google/Apple identity with the same normalized email may link to the existing account only when the existing account email is already verified and the provider email assurance is sufficient. For untrusted/ambiguous external-domain assertions, require an additional email challenge or authenticated proof of the existing account. Never link on an unverified email string alone.
- Different normalized emails create different accounts. Apple Hide My Email relay addresses are treated as the email Apple returns; they are not silently equated with a personal mailbox.
- Never silently merge two already-existing accounts. Account merge is a separate, explicit, audited workflow and is outside the initial v10.12 scope.
- Once linked, future login resolves by `(issuer, subject)` even if the provider later changes the displayed email.

### Sessions and tokens

- Spring Boot issues Diasporum access JWTs; Google and Apple tokens are input identity evidence only, not Diasporum API tokens.
- Use asymmetric JWT signing (RS256 or ES256), audience restriction, 10-15 minute access-token lifetime, `kid` and key rotation/JWKS publication. Resolve `sub` to `users.id`; use `sid` for the session reference and validate active session state on protected requests for prompt revocation.
- Use cryptographically random opaque refresh tokens. Persist only SHA-256 token hashes in `user_refresh_tokens`; rotate on every use, retain consumed-token lineage and revoke the affected token family/session on replay. Initial lifetime policy: 30-day refresh token and 90-day absolute session lifetime.
- `user_sessions` is per device/client. Revoke sessions on logout, password reset/change, account suspension/deletion and security incident.
- Expo keeps refresh credentials in OS-backed secure storage. Next.js admin uses a server-side BFF/session with HttpOnly, Secure, SameSite cookies; do not put long-lived refresh tokens in browser localStorage.
- Email verification and password-reset tokens are random, single-use, time-limited and stored as hashes.
- Apple provider refresh credentials needed for revocation are stored only in `external_identity_credentials`, encrypted with a key held outside PostgreSQL.

### Password baseline

- Use Argon2id with a minimum starting baseline of 19 MiB memory, two iterations and parallelism one, then benchmark and tune upward for production; store the encoded PHC hash, never plaintext or reversible password encryption.
- For password-only authentication, require at least 15 characters, permit long passphrases (at least 64 characters), do not impose arbitrary composition rules, and block common/compromised passwords.
- Apply rate limits, generic authentication/recovery responses, progressive delays and abuse detection. Do not create a permanent `login_attempts` table solely for throttling.
- A successful password reset/change revokes existing refresh sessions; the user signs in again.

### Role model (no generic roles/permissions tables)

- Platform roles in `global_user_roles`: `PLATFORM_ADMIN`, `PLATFORM_MODERATOR`, `CONTENT_EDITOR`, `SUPPORT_AGENT`. `PLATFORM_ADMIN` is global-only. Other platform roles can be assigned globally, by country or by community using `scope_type`, `country_id` and `community_id`.
- Community roles remain in `community_memberships`: `MEMBER`, `TRUSTED_HELPER`, `MODERATOR`, `COMMUNITY_ADMIN`. These apply only to that community and never grant platform authority.
- Business roles remain in `business_account_members`: `OWNER`, `ADMINISTRATOR`, `EDITOR`, `LISTING_MANAGER`, `BILLING_MANAGER`. They apply only to the named business account.
- Voice participant roles (`LISTENER`, `SPEAKER`, `HOST`, `MODERATOR`) remain session-scoped and are not account roles.
- Do not add generic `roles`, `user_roles` or `permissions` tables. Do not maintain `business_role_permissions` or `business_account_has_permission()`; define fixed role capabilities in the owning Java module's policy classes and test them.
- Subscription tiers and billing entitlements are not security roles. An ordinary active account does not need a `USER` role.

### Authentication tables

New v10.12 tables: `users`, `user_credentials`, `user_sessions`, `user_refresh_tokens`, `email_verification_tokens`, `password_reset_tokens`, and `external_identity_credentials` (provider credential vault for revocation operations). Existing `external_identities` is retained but now references `users.id`. Existing `profiles`, `global_user_roles`, `community_memberships`, `business_account_members` and `audit_logs` are retained with identity-reference changes described in the schema.

## 6. Database and migration rules

-   The canonical schema is `Diasporum_PostgreSQL_Schema_v10_12.sql`.
-   `Diasporum_v10_12_strict_clean_install.sql` contains the same schema
    body wrapped in an explicit outer transaction. It is intended only
    for a brand-new, empty PostgreSQL database with PostGIS available.
-   These are clean-install baselines, **not upgrade scripts** for a
    populated or existing database.
-   `Diasporum_v10_12_Smoke_Test.sql` provides schema assertions and
    integration scenarios; review it and execute it only in an
    appropriate test environment.
-   The schema has been statically reviewed, but it must not be
    described as live-database validated unless it has actually been run
    against PostgreSQL/PostGIS.
-   Use Flyway versioned migrations for application database evolution.
    Agree on how the initial v10.12 baseline is represented in Flyway
    before creating or running migrations.
-   Never drop, reset or overwrite a database without explicit approval.
-   Do not change the schema to match an implementation convenience.
    Identify a concrete mismatch, explain the impact and request
    approval for a design change.

## 7. Security, privacy and reliability requirements

-   Authenticate email/password in Spring Boot using Argon2id. Verify Google/Apple
    identity tokens server-side and map `(issuer, subject)` to `users.id` in
    `external_identities`; never use email alone as a provider identity key.
-   Keep `users` as the permanent account identity and `profiles` as an optional
    one-to-one profile extension (`profiles.id = users.id`). Account status belongs
    to `users`; profile details belong to `profiles`.
-   Apply authentication and authorization to every protected endpoint,
    including deep links and secondary access paths.
-   Check community membership and visibility for search, notifications,
    saved content, media access and direct retrieval---not only feed
    list endpoints.
-   Use DTO projections that exclude hidden fields. Never leak private
    addresses, coordinates, sensitive matching preferences, secrets or
    report identities in responses, errors, logs, analytics or realtime
    payloads.
-   Use HTTPS and safe environment-based secret configuration. Never
    commit real credentials.
-   Validate external URLs and uploads; prevent unsafe URL schemes and
    unauthorized media access.
-   Implement rate limits, spam controls, report/moderation workflows
    and audit history.
-   Use idempotency and safe retry handling for payment/provider
    webhooks and background jobs where applicable.
-   Persist durable changes before publishing realtime events. Use the
    approved outbox/retry approach so events are not published for
    rolled-back transactions.
-   Background jobs must be safe under duplicate execution and
    concurrent workers.
-   Define retention and implement appropriate privacy export/deletion
    workflows.
-   Never claim security auditing, load testing, migration success or
    runtime validation without evidence.

## 8. Development workflow for AI agents

Before coding: 1. Read this file and the relevant v10.12 design/schema
documentation. 2. Inspect the repository, Git status, existing code and
tests. 3. Identify whether the task is in the mobile app, backend or
admin/static website. 4. Check the existing implementation before
proposing new classes, tables, dependencies or abstractions. 5. State
assumptions and any blocking decisions.

While coding: - Work only in the repository and scope assigned. - Keep
changes small and focused. - Reuse existing patterns where sound. - Do
not duplicate features or tables already provided by shared modules. -
Do not change product scope, provider decisions, schema or dependency
major versions without approval. - Do not overwrite user changes or
perform destructive Git/database operations. - Add or update tests for
changed behavior. - Do not put backend secrets in mobile or web
environment variables exposed to clients. In Next.js, variables prefixed
with `NEXT_PUBLIC_` are public.

After coding: - Run relevant formatting, type checks, builds and tests
where available. - Report the exact commands executed and whether they
passed. - Clearly list skipped tests and environmental blockers. -
Summarize changed files and any migrations. - Never claim success for
commands that were not run.

## 9. Scope of the first implementation milestones

Do not implement the entire platform in one task.

Recommended backend sequence: 1. Inspect and preserve the Spring
Initializr project. 2. Establish safe configuration, build/test setup,
database connectivity and the Flyway baseline strategy. 3. Implement and
test first-party authentication and authorization. 4. Implement profiles,
countries, communities and memberships. 5. Implement media foundation
and core feed APIs. 6. Implement durable General Chat and messaging
foundations. 7. Add remaining modules incrementally.

Recommended mobile sequence: 1. Verify the selected Expo SDK and starter
project. 2. Establish navigation, theme, app identity and API-client
foundation. 3. Implement authentication and onboarding after backend
contracts are agreed. 4. Add feed and core community flows
incrementally.

Recommended web sequence: 1. Establish the static public website and
shared branding. 2. Implement a separately protected admin console using
backend APIs. 3. Keep administrative permissions enforced by the
backend, not just by client-side routing.

## 10. Source of truth and conflict resolution

Use this priority order:

1.  Explicit, recent user decisions.
2.  The latest approved Diasporum system design and schema version.
3.  Existing architecture decision records and repository documentation.
4.  Existing code, after verifying whether it matches the approved
    design.
5.  Agent recommendations, clearly labelled as proposals.

If documents conflict, identify the conflict and ask for clarification
rather than silently choosing a version. Do not assume the presence of
code means a design decision has been approved.

**Before making significant changes, explain what you plan to change and
why.** Keep Diasporum mobile-first, with Spring Boot as the central
application backend and Next.js limited to the admin console and
informational public website.
