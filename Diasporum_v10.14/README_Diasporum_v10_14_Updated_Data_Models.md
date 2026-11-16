# Diasporum v10.14 / v10.15 Updated Data Models

This package contains the v10.14 baseline and the v10.15 platform-wide design update.

## Files

### v10.14 Baseline
- `Diasporum_v10_14_strict_clean_install.sql` — strict clean-install SQL for an empty database only.
- `Diasporum_v10_14_Marketplace_Smoke_Test.sql` — Shop and Service Marketplace catalog assertions.
- `Diasporum_Combined_Data_Model_v10_14.md` — combined Shop + Service Marketplace data-model documentation.

### v10.15 Design Update
- `Diasporum_v10_15_Design_Update.md` — comprehensive design document covering all v10.15 changes.
- `Diasporum_v10_15_schema_delta.sql` — additive SQL delta to apply on top of v10.14.

## v10.15 Summary

The v10.15 update adds **~37 new tables** and significant column additions across the following areas:

1. **Community model redesign** — Primary/secondary communities, same-origin and different-origin community support with 17 new billing features for cross-community access control.
2. **Advertising module** (11 tables) — Separate from posts; supports promoted content and dedicated ads, campaign budgets, community targeting, daily metrics, and conversion tracking. Both individual and business accounts can create ads.
3. **Event ticketing** (8 tables) — Ticket types, orders, QR-code issued tickets, check-in scanning, refunds, organiser payouts, and configurable platform fees. External payment providers (Stripe, Chapa, ArifPay).
4. **Spare Bag redesign** (7 tables) — Separate sender requests and traveller journeys. Traveller profiles with verification. Country+city based (not airport-centric). Per-item measurement units. Country-level feature configuration.
5. **AI moderation** (4 tables) — Central moderation queue with AI risk scoring, configurable policy thresholds, user appeals, and full audit trail. 15 content-type-specific policy rules seeded.
6. **On-demand translation** (1 table) — Cached translations with content-hash invalidation. Redis caching layer for hot translations.
7. **Country verification** (2 tables) — Live location verification during registration with configurable grace periods per country.
8. **Business add-ons** (2 tables) — Extra listing quota packages (e.g. 30/50 listings) purchasable when subscription quota runs out.
9. **Feed/ad statistics** — Per-community daily impression metrics for posts and ad campaigns.
10. **Featured listing statistics** — Daily metrics for featured items per community.
11. **Cross-community features** — Multi-community post targeting, matchmaking visibility scopes, cross-community messaging, listing visibility rules.

### Key design fixes
- Removed origin-only community membership restriction (old trigger blocked different-origin joins).
- Ads decoupled from posts (`is_sponsored` deprecated; ads are a separate module).
- Spare Bag simplified from airport-centric to country+city model with separate sender/traveller flows.
- Matchmaking visibility expanded (own community, same current country, same origin, selected communities).
- Call-to-action fields added to posts and ad creatives.

## Important

All files have been statically inspected and authored but the SQL has NOT been executed against PostgreSQL. Before use:
1. Install `Diasporum_v10_14_strict_clean_install.sql` into a disposable PostgreSQL 15+ / PostGIS database.
2. Apply `Diasporum_v10_15_schema_delta.sql` as an additive migration.
3. Run the smoke-test file and application integration tests.
4. Never run clean-install or delta scripts against a populated production database without review.
