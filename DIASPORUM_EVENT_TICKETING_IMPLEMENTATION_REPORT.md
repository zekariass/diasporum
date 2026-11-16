# Diasporum — Event Ticketing Service Layer: Implementation Report

**Date:** 2026-11-16 · **Scope:** backend only (`diasporum-backend`), no mobile changes.
**Payment model:** buyers pay the Diasporum platform Stripe account (PaymentIntents) → immutable organiser ledger → manual payout by platform staff. No Stripe Connect, no organiser Stripe accounts, no subscription billing.

## 1. Files

### Migration
| File | Why |
|---|---|
| `db/migration/V38__ticket_payout_account_encryption.sql` | The only schema gap found. V31 §6d requires encryption at rest of payout details, but `iban varchar(34)` / `account_number varchar(64)` / `mobile_money_phone varchar(20)` cannot hold AES-GCM ciphertext. Widened to `text` + column comments. No other table changed. |

### Main code — `events/internal/…` (no cross-module `internal.*` imports)
| Package / file | Responsibility |
|---|---|
| `application/ticketing/TicketingProperties` | `diasporum.events.ticketing.*` (TTLs, payout key, platform Stripe config) |
| `application/ticketing/TicketPaymentGateway` | Payment port (PaymentIntent create/retrieve/cancel, refund create/retrieve) |
| `application/ticketing/TicketingAccess` | Ticketing event view; manager / finance / platform-admin authorization |
| `application/ticketing/TicketMoney` | numeric(12,2) major ↔ provider minor units; currency-precision rounding |
| `application/ticketing/TicketFeeCalculator` | Pure per-unit pricing: discount, fee, buyer/organiser split |
| `application/ticketing/TicketFeeConfigs` | Resolves the `ticket_fee_configurations` row (fee + settlement rule) |
| `application/ticketing/EventTicketingSetupService` | Ticketing settings, ticket type CRUD, promo code CRUD |
| `application/ticketing/TicketReservationService` | Atomic inventory holds, release |
| `application/ticketing/TicketOrderService` | Reservation → order, PaymentIntent, cancel, buyer/organiser views |
| `application/ticketing/TicketOrderStore` | Guarded order transitions + history, reservation release, cursors |
| `application/ticketing/TicketFulfilmentService` | One-transaction PAID: inventory, items, issued tickets, ledger |
| `application/ticketing/TicketLedger` | Sole append-only ledger writer (idempotency-keyed), balances |
| `application/ticketing/TicketRefundService` | Whole-ticket refunds, provider refund, ledger adjustments |
| `application/ticketing/TicketCheckInService` | Online + offline-batch check-in, every scan logged |
| `application/ticketing/PayoutAccountService` | Payout destinations: requirement validation, encryption, masking, admin verify |
| `application/ticketing/OrganiserPayoutService` | Eligibility, payout requests, admin approve/complete/reject, sales summary |
| `application/ticketing/TicketPaymentWebhookService` | Verified, deduplicated, replay-safe webhook processing |
| `application/ticketing/TicketingJobs` | Scheduled expiry + payment/refund reconciliation |
| `application/ticketing/TicketNotifications`, `TicketCodes` | Purchase/payout notifications; opaque ticket codes |
| `infrastructure/stripe/StripeTicketPaymentGateway`, `StripeHttp`, `StripeWebhookVerifier` | Events-scoped Stripe REST adapter + v1 HMAC verification |
| `infrastructure/crypto/PayoutDataCipher` | AES-256-GCM (`v1:` + base64(iv‖ct)), masking |
| `api/rest/EventTicketingController` | Organiser endpoints |
| `api/rest/TicketBuyerController` | Buyer endpoints |
| `api/rest/TicketCheckInController` | Check-in endpoints |
| `api/rest/OrganiserPayoutController` | Payout accounts + payout requests |
| `api/rest/TicketingAdminController` | `/api/v1/admin/ticketing/**` |
| `api/rest/TicketPaymentWebhookController` | `POST /api/v1/webhooks/ticket-payments` |

### Small edits to existing files
- `events/internal/application/EventAuthorization` — `canManageFinances(role)` (OWNER/ADMINISTRATOR; editors run events but do not move money).
- `events/internal/application/EventService` — public `requireViewer(viewer, eventId)` delegating to the existing private visibility check (buyers can only reserve events they can see).
- `security/internal/config/SecurityConfig` — `permitAll` for `POST /api/v1/webhooks/ticket-payments` (authenticated by signature).
- `application.yaml`, `.env.example` — ticketing config with explicit env mapping.

### Tests
- `events/TicketingIntegrationTest` (Testcontainers PostGIS) + `events/FakeTicketPaymentGateway`
- `events/internal/application/ticketing/TicketFeeCalculatorTest`
- `events/internal/infrastructure/stripe/StripeTicketAdapterTest` (JDK `HttpServer` stub — no network, no keys)
- `events/internal/infrastructure/crypto/PayoutDataCipherTest`

## 2. Endpoints (all `/api/v1`)
**Organiser:** `GET|PUT /events/{id}/ticketing` · `GET|POST /events/{id}/ticketing/ticket-types` · `PATCH|DELETE …/ticket-types/{typeId}` · `GET|POST /events/{id}/ticketing/promo-codes` · `PATCH|DELETE …/promo-codes/{promoId}` · `GET /events/{id}/ticketing/orders` (cursor) · `GET /events/{id}/ticketing/summary` · `GET /events/{id}/ticketing/payouts` · `GET|POST /events/{id}/ticketing/refunds` · `POST /ticket-refunds/{id}/approve|reject`
**Buyer:** `GET /events/{id}/ticket-types` · `POST /events/{id}/tickets/reserve` · `DELETE /ticket-reservations/{id}` · `POST /ticket-orders` · `GET /ticket-orders/{id}` · `POST /ticket-orders/{id}/cancel` · `POST /ticket-orders/{id}/refund-requests` · `GET /me/ticket-orders` · `GET /me/tickets?eventId=&status=`
**Check-in:** `POST /tickets/check-in` · `POST /tickets/check-in/batch`
**Payouts:** `GET /payout-account-requirements?countryId=` · `GET|POST /me/payout-accounts` · `PATCH|DELETE /me/payout-accounts/{id}` · `POST /organiser-payouts`
**Admin:** `GET /admin/ticketing/payouts` · `POST /admin/ticketing/payouts/{id}/approve|hold|release|complete|reject|fail` · `GET /admin/ticketing/payout-accounts[/{id}]` · `POST …/payout-accounts/{id}/verify|reject` · `POST /admin/ticketing/ticket-refunds`
**Webhook:** `POST /webhooks/ticket-payments` (unauthenticated; Stripe-Signature)

Ticket types are managed under `/events/{id}/ticketing/ticket-types` so the buyer-facing `GET /events/{id}/ticket-types` keeps a clean path.

## 3. State machines as implemented

### Inventory / reservation
`reserve` = one guarded UPDATE: `quantity_reserved += q WHERE is_active AND quantity_sold + quantity_reserved + q <= quantity_total` (0 rows → 409 `TICKETS_SOLD_OUT`); the CHECK is the backstop, never the mechanism. Reservation `ACTIVE` → `CONFIRMED` (on PAID, `confirmed_order_id` set) | `RELEASED` (buyer release, replaced hold, order cancelled/expired, worker). One live hold per buyer per type; a new reserve replaces an earlier hold that is not already in checkout.

### Order
| From | To | Trigger (`change_source`) |
|---|---|---|
| — | RESERVED | order created (BUYER); pricing snapshot stored in the history row's `metadata` |
| RESERVED | PAID | total = 0, same transaction (SYSTEM) |
| RESERVED | PAYMENT_PENDING | PaymentIntent attached (BUYER) |
| PAYMENT_PENDING | PAID | `payment_intent.succeeded` (PAYMENT_WEBHOOK) or worker reconcile (SYSTEM) |
| RESERVED / PAYMENT_PENDING | EXPIRED | worker after checking the intent; `payment_intent.canceled` |
| RESERVED / PAYMENT_PENDING | CANCELLED | buyer cancel (intent cancelled first) |
| PAID ⇄ REFUND_REQUESTED → PARTIALLY_REFUNDED / REFUNDED | | recomputed from ticket states + open refunds |

`PENDING` exists in the schema but is unused. Every transition is a locked conditional update plus a `ticket_order_status_history` row, so webhook, worker and buyer paths can never both win. EXPIRED/CANCELLED release the hold and give back the promo use.

**PAID (one transaction):** order → PAID · held → sold (`quantity_reserved −= q, quantity_sold += q`, guarded) · reservation → CONFIRMED · `ticket_order_items` row with name/price/discount snapshots · `q` × `issued_tickets` (opaque random `ticket_code` `TK-` + 12 Crockford chars, `qr_payload` 256-bit base64url) · ledger `TICKET_SALE` credit (gross: subtotal − discount) + `PLATFORM_FEE` debit (organiser-borne fee share) · EVENT_TICKET_PURCHASED notification. Re-entrant: an already-paid order is a no-op.

**Late payment:** if money lands for an order that is already EXPIRED/CANCELLED (or whose inventory is gone), nothing is fulfilled; a full `ADMIN_OVERRIDE` refund is queued (`late-payment:{orderId}`) and the worker sends it.

### Refund (whole ticket)
`PENDING` (buyer request, policy-checked) → `APPROVED` (organiser finance role or admin) → `PROCESSING` → `PROCESSED` | `FAILED`; `PENDING` → `REJECTED`. Organiser-initiated, event-cancelled (requires `events.cancelled_at`) and admin-override refunds start `APPROVED`. Refund policy for buyers: NO_REFUNDS → `REFUND_NOT_ALLOWED`; REFUND_UNTIL_EVENT / REFUND_UNTIL_CUTOFF → `REFUND_WINDOW_CLOSED` once passed; ORGANISER_DISCRETION → request accepted, organiser decides; a cancelled event always accepts requests. The buyer's booking fee (`platform_fee_refund`) is returned only for EVENT_CANCELLED and ADMIN_OVERRIDE.
**PROCESSED (one idempotent transaction):** ticket → REFUNDED · `quantity_sold − 1` · ledger `REFUND_DEDUCTION` debit (ticket net) + `FEE_REFUND` credit (organiser-borne fee share for that ticket) · order recomputed. Ledger rows are only appended.

### Payout (MANUAL only)
`PENDING` ⇄ `ON_HOLD` → (approve: `approved_by_user_id`, `approved_at`; payout account must be VERIFIED) `PROCESSING` → (complete: `transfer_reference`, `transferred_by_user_id`, `completed_at`) `COMPLETED` + ledger `PAYOUT` debit. `PENDING/ON_HOLD` → `CANCELLED` (reject, `failure_reason`); `PROCESSING` → `FAILED` (`failure_reason`). Approval-before-completion, MANUAL transfer reference and `provider_payout_id` rules are **not re-checked in Java**: they are the table's CHECKs, and a violation is surfaced as 409 `PAYOUT_STATE_INVALID` (covered by a test that completes an unapproved payout).

## 4. Stripe configuration — where it landed
**An events-scoped adapter with its own config**, not shared platform config. Exploration showed the brief's premise was off: there is **no Stripe SDK** in the build (the shop calls Stripe's REST API with the JDK `HttpClient` through its module-internal `ProviderHttp`), and **no `STRIPE_*` env vars** existed (shop config binds only via `diasporum.shop.stripe.*`). Rather than move shop code into `platform`, ticketing has a small REST client and its own v1 signature verifier (both mirror the shop's, no import), and explicit env mapping:

| Env var | Property |
|---|---|
| `STRIPE_SECRET_KEY` | `diasporum.events.ticketing.stripe.secret-key` (platform account; the shop could share it later) |
| `STRIPE_TICKETS_WEBHOOK_SECRET` | `…stripe.webhook-secret` (Stripe issues one secret per endpoint) |
| `STRIPE_API_BASE` | `…stripe.api-base` (default `https://api.stripe.com`) |
| `PAYOUT_DATA_ENCRYPTION_KEY` | `…payout-data-key` (base64 32-byte AES key) |
| `DIASPORUM_TICKET_RESERVATION_TTL` / `_PAYMENT_TTL` / `_EXPIRY_INTERVAL` | PT15M / PT15M / PT1M |

Blank secret key → paid checkout fails closed (503 `PAYMENT_PROVIDER_UNAVAILABLE`); free tickets still work. Blank payout key → payout-account writes fail closed (503 `PAYOUT_ENCRYPTION_UNAVAILABLE`), reads show `****`. PaymentIntents carry `Idempotency-Key: ticket-order:{id}`, refunds `ticket-refund:{id}`; no `transfer_data` / application fee.

## 5. Money and settlement rules used
- **Fee config resolution:** active row for (event country, event category) → (country, any category) → (global, any category). **No fee rows are seeded** in any migration, so today every event resolves to the fallback: **zero fee, `payout_delay_days` 7, `min_payout_amount` 0** (the column defaults, logged at WARN). Ops must insert `ticket_fee_configurations` rows before charging commission.
- **Per-unit fee:** `round(unitNet × commission_rate_bps / 10000) + fixed fee`; `fixed_fee_minor` is converted from minor units by the currency's fraction digits and applied only when the config currency equals the event currency (no FX). A free unit (including 100%-discounted) carries no fee.
- **Who pays:** `events.ticket_fee_model` overrides `config.fee_model`. BUYER_PAYS → buyer; ORGANISER_ABSORBS → organiser; SPLIT → organiser bears `round(fee × organiser_split_bps / 10000)`, buyer the remainder. `ticket_orders.platform_fee_amount` = the buyer-paid part (so `total = subtotal − discount + platform_fee` holds); the organiser part is the ledger `PLATFORM_FEE` debit.
- **Discounts:** PERCENTAGE per unit; FIXED_AMOUNT per ticket, capped at price.
- **Settlement rule (payout eligibility):** `coalesce(ends_at, starts_at) + payout_delay_days ≤ now` and `available = SUM(credit − debit) − SUM(net_payout_amount of PENDING/ON_HOLD/PROCESSING payouts)` with `available > 0` and `≥ min_payout_amount`. Requests are serialized per event (`pg_advisory_xact_lock`), so concurrent requests can't spend the same balance. `net_payout_amount = available`; gross/fees/refunds/ticket counts are informational period totals.

## 6. Idempotency and replay safety
- `ticket_orders.idempotency_key` = `buyerId:clientKey` (column is globally unique); replay returns the same order; reuse with another reservation → 409 `IDEMPOTENCY_KEY_REUSED`.
- `ticket_refunds.idempotency_key` = `refund:{ticketId}:{attempt}`; `ticket_organiser_payouts.idempotency_key` = `actorId:clientKey`.
- Ledger keys: `order:{id}:sale`, `order:{id}:fee`, `refund:{id}:deduction`, `refund:{id}:fee`, `payout:{id}` with `ON CONFLICT DO NOTHING`.
- Webhook: signature verified **before anything is stored** (an unverified event id must not enter the dedup index); insert `ON CONFLICT DO NOTHING` committed separately; claim RECEIVED/FAILED → PROCESSING; objects re-fetched from Stripe and matched by our stored provider id (payload amounts are never trusted; amount/currency mismatch → FAILED, not fulfilled); failure → FAILED + 500 so Stripe retries. Duplicate delivery → 200 `IGNORED`.

## 7. Verification
Run locally on 2026-11-16 with Docker 28.0.4 and Testcontainers `postgis/postgis:17-3.5`. All Stripe calls were stubbed: no live keys were used.

**Full `./mvnw -o verify`** (this covers the `test` phase; 2 h 29 min):
`Tests run: 470, Failures: 0, Errors: 2` → BUILD FAILURE. Both errors were Testcontainers infrastructure timeouts, not test assertions:
- `SocialModuleIntegrationTest` failed at class level. The container started, but its port mapping didn't appear within the 5 s wait (`ports={}`), so none of its 10 tests ran and it was counted as 1 error.
- `SpareBagModuleIntegrationTest.spareBagMigrationUpgradesLatestMainAndSeedCanBeReappliedSafely` hit the same container startup timeout.

Neither module is touched by this change. An earlier full run failed on 33 classes because the Ryuk reaper container (`testcontainers/ryuk`) didn't start within 5 s. That was the same class of local Docker slowness.

**Re-run of the two affected classes** (`./mvnw -o test -Dtest=SocialModuleIntegrationTest,SpareBagModuleIntegrationTest`):
`Tests run: 25, Failures: 0, Errors: 0` → BUILD SUCCESS (Social 10/10, SpareBag 15/15).

**Effective total:** 470 − 1 (class-level error) + 10 = **479 tests, 0 failures**. That is the previous suite of 452 plus 27 new tests.

| New test class | Tests | Result |
|---|---|---|
| `events.TicketingIntegrationTest` | 14 | pass |
| `TicketFeeCalculatorTest` | 5 | pass |
| `StripeTicketAdapterTest` (adapter against a local HTTP stub, plus webhook signature tests) | 5 | pass |
| `PayoutDataCipherTest` | 3 | pass |

- `architecture.ModuleBoundaryTest`: **27/27 pass**, unchanged. No cross-module `internal..` imports and no cycles.
- V38 applied cleanly on every Testcontainers database in the run.
- Scenarios the brief required, all covered in `TicketingIntegrationTest`:
  - oversell race (two threads, last ticket)
  - free-ticket path
  - webhook dedup and bad-signature rejection (nothing persisted)
  - refund → ledger REFUND_DEDUCTION + FEE_REFUND, with the ledger UPDATE trigger still blocking changes
  - payout eligibility math and the full request → approve → complete flow, where completing without approval is rejected
  - check-in idempotency, including the offline batch
  - expiry worker: releases holds, expires orders, cancels their PaymentIntents, reconciles a missed webhook, and a second run changes nothing

## 8. Deferred (explicitly out of scope)
- **STRIPE_GLOBAL disbursement** — schema-ready (`disbursement_method`, `provider_payout_id`), no adapter; requests always insert `MANUAL`.
- **Ticket transfers** — `TRANSFERRED` status exists; not implemented.
- **Partial-ticket refunds** — refunds are whole tickets only.
- **Multi-ticket-type carts** — one order = one reservation = one ticket type, matching the schema's 1:1 `ticket_orders.reservation_id` (unique). Buyers place one order per type.
- **Automatic bulk refunds on event cancellation** — `EventService.cancel` is not hooked; organisers/admins issue `EVENT_CANCELLED` refunds per order.
- **Admin CRUD for `ticket_fee_configurations`** — rows must be inserted by ops (none seeded).
- **Logging of unknown-code scans** — `ticket_check_ins.issued_ticket_id` is NOT NULL, so a code matching no ticket returns `INVALID` but cannot be logged.
- **Reservation idempotency key** — `ticket_reservations` has no such column; a repeated reserve replaces the buyer's earlier hold instead of stacking.
- **Event staff role** — no staff table exists; check-in is allowed to event managers (owner / business OWNER/ADMINISTRATOR/EDITOR) and platform admins.
- **Late-payment revival** — a payment landing after expiry is refunded, not re-fulfilled.
