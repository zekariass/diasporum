# Diasporum v10.15 — Platform-Wide Design Update

**Status:** Proposed design for review; not an executable migration.  
**Baseline:** Diasporum v10.14 PostgreSQL/PostGIS schema and system design.  
**Prepared:** 15 November 2026.

This update adds cross-community features, a redesigned advertising module, event ticketing, a redesigned Spare Bag module, AI moderation, on-demand translation, business add-ons, feed/ad statistics, country verification, and comprehensive billing entitlements for same-origin and different-origin communities.

> **Migration warning:** This is a design document. All DDL changes must be authored as additive Flyway migrations against the actual deployed v10.14 database. Never run clean-install SQL over a populated database.

---

## 1. Community Model Redesign

### 1.1 Primary and secondary communities

A community is defined by a combination of `origin_country_id` (country of origin) and `destination_country_id` (country of residence). For example, "Ethiopians in the UK" has origin=Ethiopia, destination=UK. A special "home country" community exists where origin and destination are the same country (e.g. "Ethiopians in Ethiopia").

**Primary community:** Each user/business has exactly one primary community, automatically determined by their `profiles.origin_country_id` and `profiles.current_country_id`. The primary community is stored as a derived reference — users cannot manually override it.

**Secondary communities:** Users can join additional communities beyond their primary one. Behaviour in secondary communities is governed by billing entitlements:

- **Same-origin communities:** Communities that share the same `origin_country_id` as the user. For example, if a user is Ethiopian, all communities with origin=Ethiopia are same-origin (Ethiopians in UK, Ethiopians in Canada, etc.).
- **Different-origin communities:** Communities with a different `origin_country_id` from the user.

### 1.2 Schema changes to `community_memberships`

Add `membership_type` column:

```
community_memberships
---------------------
+ membership_type TEXT NOT NULL DEFAULT 'SECONDARY'
    CHECK(membership_type IN ('PRIMARY','SECONDARY'))
```

Add a partial unique index to enforce exactly one primary community per user:
```sql
CREATE UNIQUE INDEX ux_community_membership_primary
    ON community_memberships(user_id) WHERE membership_type = 'PRIMARY';
```

**Remove the origin-country-only membership trigger** (`trg_membership_origin_country`). The old trigger required `profiles.origin_country_id = communities.origin_country_id`, which blocks joining different-origin communities. Replace with a trigger that:
- Allows anyone to join any active community (subject to billing entitlements checked by the application).
- Validates that PRIMARY membership community matches the user's `profiles.origin_country_id` + `profiles.current_country_id`.

### 1.3 Cross-community content rules

| Action | Primary community | Same-origin secondary | Different-origin secondary |
|---|---|---|---|
| View content | Free | Entitlement required | Entitlement required |
| Post (feed/poll/help) | Free (quota limited) | Entitlement + quota | Entitlement + quota |
| Like | Free | Entitlement required | Entitlement required |
| Comment | Free | Entitlement required | Entitlement required |
| Save | Free | Entitlement required | Entitlement required |
| Share | Free | Entitlement required | Entitlement required |

### 1.4 Multi-community post targeting

Posts can now target multiple communities. The existing `feed_post_communities` table is used for this. Add a `target_mode` to `feed_posts`:

```
feed_posts
----------
+ target_mode TEXT NOT NULL DEFAULT 'SINGLE_COMMUNITY'
    CHECK(target_mode IN ('SINGLE_COMMUNITY','SELECTED_COMMUNITIES','ALL_SAME_ORIGIN','ALL_SAME_CURRENT_COUNTRY'))
```

- `SINGLE_COMMUNITY`: Legacy behaviour — post appears only in `community_id`.
- `SELECTED_COMMUNITIES`: Post appears in communities listed in `feed_post_communities`.
- `ALL_SAME_ORIGIN`: Post appears in all communities sharing the author's origin country.
- `ALL_SAME_CURRENT_COUNTRY`: Post appears in all communities sharing the same destination (current) country.

`ALL_SAME_ORIGIN` requires the `TARGET_ALL_SAME_ORIGIN_COMMUNITIES` entitlement. `ALL_SAME_CURRENT_COUNTRY` is controlled similarly by admin configuration.

**As implemented (V37):** `ALL_SAME_CURRENT_COUNTRY` is gated by a new `TARGET_ALL_SAME_CURRENT_COUNTRY_COMMUNITIES` feature key, seeded fail-closed (no `feature_access_rules` row) until an admin enables it. Broadcast-mode resolution does not join profiles at read time: V37 adds `feed_posts.author_origin_country_id` / `author_current_country_id` snapshot columns (nullable FK → `countries`, partial indexes), captured at post creation so a post's broadcast audience is fixed even if the author later changes countries.

### 1.5 Feed post impression statistics

```
feed_post_community_stats
-------------------------
id UUID PK
post_id UUID FK -> feed_posts.id
community_id UUID FK -> communities.id
impressions_count BIGINT DEFAULT 0
unique_viewers_count BIGINT DEFAULT 0
likes_count BIGINT DEFAULT 0
comments_count BIGINT DEFAULT 0
shares_count BIGINT DEFAULT 0
saves_count BIGINT DEFAULT 0
metric_date DATE NOT NULL
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ

UNIQUE (post_id, community_id, metric_date)
```

---

## 2. Billing Features for Cross-Community Access

### 2.1 Same-origin community billing features

| Feature key | Feature kind | Description |
|---|---|---|
| `JOIN_SAME_ORIGIN_COMMUNITY` | BOOLEAN | Join additional same-origin communities |
| `VIEW_SAME_ORIGIN_COMMUNITY_CONTENT` | BOOLEAN | View content in same-origin communities |
| `LIKE_ON_SAME_ORIGIN_COMMUNITY` | QUOTA | Like posts in same-origin communities |
| `COMMENT_ON_SAME_ORIGIN_COMMUNITY` | QUOTA | Comment on posts in same-origin communities |
| `SAVE_ON_SAME_ORIGIN_COMMUNITY` | BOOLEAN | Save posts from same-origin communities |
| `SHARE_FROM_SAME_ORIGIN_COMMUNITY` | BOOLEAN | Share posts from same-origin communities |
| `POST_IN_SAME_ORIGIN_COMMUNITY` | QUOTA | Post in same-origin community feeds |
| `TARGET_ALL_SAME_ORIGIN_COMMUNITIES` | BOOLEAN | Target all same-origin communities with one post |
| `VIEW_ALL_SAME_ORIGIN_COMMUNITIES_CONTENT` | BOOLEAN | View feeds from all same-origin communities |

### 2.2 Different-origin community billing features

| Feature key | Feature kind | Description |
|---|---|---|
| `JOIN_DIFF_ORIGIN_COMMUNITY` | BOOLEAN | Join different-origin communities |
| `VIEW_DIFF_ORIGIN_COMMUNITY_CONTENT` | BOOLEAN | View content in different-origin communities |
| `LIKE_ON_DIFF_ORIGIN_COMMUNITY` | QUOTA | Like posts in different-origin communities |
| `COMMENT_ON_DIFF_ORIGIN_COMMUNITY` | QUOTA | Comment on posts in different-origin communities |
| `SAVE_ON_DIFF_ORIGIN_COMMUNITY` | BOOLEAN | Save posts from different-origin communities |
| `SHARE_FROM_DIFF_ORIGIN_COMMUNITY` | BOOLEAN | Share posts from different-origin communities |
| `POST_IN_DIFF_ORIGIN_COMMUNITY` | QUOTA | Post in different-origin community feeds |
| `TARGET_ALL_DIFF_ORIGIN_COMMUNITIES` | BOOLEAN | Target all different-origin communities with one post |

### 2.3 Post limits in database

Post quotas per plan are already configurable in `billing_plan_entitlements` via `POST_CREATE`. The new community-scoped features add orthogonal quotas: a user may have unlimited posts in their primary community but limited cross-posting.

---

## 3. Advertising Module (Complete Redesign)

Advertising is no longer a post type. It is a separate module that allows users and businesses to promote existing content or create dedicated advertisements.

### 3.1 Core advertising tables

### 3.0 Standard CTA codes

Before campaigns, a reference table of allowed call-to-action types. The mobile app renders a dropdown; the backend validates.

```
ad_call_to_action_types
-----------------------
code VARCHAR(40) PK          -- e.g. LEARN_MORE, SHOP_NOW, BOOK_NOW, ...
display_label VARCHAR(80) NOT NULL
is_active BOOLEAN NOT NULL DEFAULT true
sort_order INTEGER NOT NULL DEFAULT 0
```

Seeded: LEARN_MORE, SHOP_NOW, BOOK_NOW, CONTACT_US, SIGN_UP, GET_OFFER, GET_DIRECTIONS, SEND_MESSAGE, CALL_NOW, VISIT_WEBSITE, VIEW_EVENT, VIEW_LISTING, VIEW_PRODUCT, APPLY_NOW, DOWNLOAD, GET_QUOTE, VIEW_PROFILE.

```
ad_campaigns
------------
id UUID PK
individual_user_id UUID FK -> users.id NULL
business_account_id UUID FK -> business_accounts.id NULL
created_by_user_id UUID FK -> users.id NOT NULL
name VARCHAR(200) NOT NULL
description TEXT NULL
campaign_kind VARCHAR(40) NOT NULL
    CHECK('STANDARD','COMMUNITY_SPONSORSHIP','MARKETPLACE_AD')
objective VARCHAR(40) NOT NULL
    CHECK('AWARENESS','TRAFFIC','ENGAGEMENT','LEADS','CONVERSIONS')
pricing_model VARCHAR(30) NOT NULL
    CHECK('FIXED_FEE','PREPAID_BUDGET')
currency_code CHAR(3) NOT NULL

-- FIXED_FEE payment linkage
fixed_fee_amount_minor BIGINT NULL     -- the agreed flat price
billing_order_id UUID FK -> billing_orders.id NULL  -- payment record
-- PREPAID_BUDGET limits
budget_limit_minor BIGINT NULL
daily_budget_limit_minor BIGINT NULL

starts_at / ends_at TIMESTAMPTZ NOT NULL
timezone VARCHAR(64) NOT NULL DEFAULT 'UTC'
frequency_cap_count INTEGER NULL
frequency_cap_window_hours INTEGER NULL

-- Community-scope targeting (Diasporum-specific)
community_target_scope VARCHAR(30) NOT NULL DEFAULT 'SELECTED'
    CHECK('SELECTED',                 -- manual community picks
          'ALL_SAME_ORIGIN',          -- all communities sharing origin country
          'ALL_SAME_CURRENT_COUNTRY', -- all communities in advertiser's country
          'ALL_COMMUNITIES')          -- platform-wide, admin-approved only

-- Denormalised summary counters (updated on metric flush)
total_impressions BIGINT NOT NULL DEFAULT 0
total_clicks BIGINT NOT NULL DEFAULT 0
total_spend_minor BIGINT NOT NULL DEFAULT 0

status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
    CHECK('DRAFT','PENDING_PAYMENT','PENDING_REVIEW','APPROVED','SCHEDULED',
        'ACTIVE','PAUSED','REJECTED','COMPLETED','CANCELLED','BUDGET_EXHAUSTED')
rejection_reason TEXT NULL           -- why the ad was rejected
moderation_queue_id UUID FK -> moderation_queue.id NULL  -- links to moderation review

CHECK(ends_at > starts_at)
CHECK((individual_user_id IS NOT NULL)::int + (business_account_id IS NOT NULL)::int = 1)
CHECK(FIXED_FEE => fixed_fee_amount_minor IS NOT NULL)
CHECK(PREPAID_BUDGET => budget_limit_minor IS NOT NULL)
```

**Community target scope** — instead of forcing advertisers to manually pick 50 communities, they select a scope:

| Scope | Behaviour | Who can use |
|---|---|---|
| `SELECTED` | Manual community picks in `ad_campaign_community_targets` | Everyone |
| `ALL_SAME_ORIGIN` | All communities sharing advertiser's origin country | Advertiser's origin |
| `ALL_SAME_CURRENT_COUNTRY` | All communities in advertiser's current country | Advertiser's location |
| `ALL_COMMUNITIES` | Platform-wide | Admin-approved only |

The `ad_campaign_community_targets` table is only used when `scope = 'SELECTED'`. Other scopes are resolved dynamically by the application.

```
ad_creatives
------------
id UUID PK
campaign_id UUID FK -> ad_campaigns.id ON DELETE CASCADE
name VARCHAR(200) NOT NULL
creative_type VARCHAR(30) NOT NULL
    CHECK('PROMOTED_CONTENT','DEDICATED')
headline VARCHAR(300) NULL
primary_text TEXT NULL
description TEXT NULL
call_to_action_code VARCHAR(40) NULL FK -> ad_call_to_action_types.code
call_to_action_url TEXT NULL CHECK('^https?://')
language_code VARCHAR(20) NULL
status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK('DRAFT','READY','ARCHIVED')
created_by_user_id UUID FK -> users.id
created_at / updated_at
```

```
ad_creative_assets
------------------
id UUID PK
creative_id UUID FK -> ad_creatives.id ON DELETE CASCADE
media_asset_id UUID FK -> media_objects.id ON DELETE RESTRICT
asset_role VARCHAR(30) NOT NULL CHECK(asset_role IN ('PRIMARY_IMAGE','PRIMARY_VIDEO','THUMBNAIL','CAROUSEL_IMAGE','LOGO'))
display_order INTEGER NOT NULL DEFAULT 0
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

```
ad_creative_sources
-------------------
creative_id UUID PK FK -> ad_creatives.id ON DELETE CASCADE
source_type VARCHAR(40) NOT NULL
    CHECK(source_type IN ('FEED_POST','PROPERTY_LISTING','VEHICLE_LISTING','JOB_LISTING',
        'EVENT','SHOP_PRODUCT','SERVICE_LISTING','BUSINESS_PROFILE','SPARE_BAG_LISTING',
        'TRAVELLER_JOURNEY'))
source_id UUID NOT NULL

NOTE: Only populated for PROMOTED_CONTENT creatives. Validated by application.
```

```
ad_placement_types
------------------
id UUID PK
code VARCHAR(80) NOT NULL UNIQUE
name VARCHAR(150) NOT NULL
surface VARCHAR(30) NOT NULL CHECK(surface IN ('FEED','MARKETPLACE','EVENTS','JOBS','PROPERTY','VEHICLE','SPARE_BAG','SERVICE','BANNER','INTERSTITIAL'))
format VARCHAR(30) NOT NULL CHECK(format IN ('NATIVE_CARD','BANNER','INTERSTITIAL','CAROUSEL','VIDEO'))
description TEXT NULL
supports_image BOOLEAN NOT NULL DEFAULT true
supports_video BOOLEAN NOT NULL DEFAULT false
supports_text_only BOOLEAN NOT NULL DEFAULT false
is_active BOOLEAN NOT NULL DEFAULT true
display_order INTEGER NOT NULL DEFAULT 0
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

```
ad_campaign_placements
----------------------
campaign_id UUID FK -> ad_campaigns.id ON DELETE CASCADE
placement_type_id UUID FK -> ad_placement_types.id ON DELETE RESTRICT
created_at TIMESTAMPTZ NOT NULL DEFAULT now()

PK (campaign_id, placement_type_id)
```

```
ad_campaign_community_targets
-----------------------------
campaign_id UUID FK -> ad_campaigns.id ON DELETE CASCADE
community_id UUID FK -> communities.id ON DELETE CASCADE
target_mode VARCHAR(10) NOT NULL DEFAULT 'INCLUDE'
    CHECK(target_mode IN ('INCLUDE','EXCLUDE'))
created_at TIMESTAMPTZ NOT NULL DEFAULT now()

PK (campaign_id, community_id)
```

### 3.2 Campaign history and analytics

```
ad_campaign_status_history
--------------------------
id UUID PK
campaign_id UUID FK -> ad_campaigns.id ON DELETE CASCADE
previous_status VARCHAR(30) NULL
new_status VARCHAR(30) NOT NULL
reason_code VARCHAR(80) NULL
reason_description TEXT NULL
changed_by_user_id UUID FK -> users.id ON DELETE SET NULL
change_source VARCHAR(20) NOT NULL
    CHECK(change_source IN ('USER','ADMIN','SYSTEM','AI_MODERATION'))
changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

```
ad_campaign_metrics
-------------------
id UUID PK
campaign_id UUID FK -> ad_campaigns.id ON DELETE CASCADE
creative_id UUID FK -> ad_creatives.id ON DELETE CASCADE
placement_type_id UUID FK -> ad_placement_types.id ON DELETE SET NULL
community_id UUID FK -> communities.id ON DELETE SET NULL
metric_date DATE NOT NULL
impressions_count BIGINT NOT NULL DEFAULT 0
viewable_impressions_count BIGINT NOT NULL DEFAULT 0
clicks_count BIGINT NOT NULL DEFAULT 0
invalid_clicks_count BIGINT NOT NULL DEFAULT 0
conversions_count BIGINT NOT NULL DEFAULT 0
delivery_cost_minor BIGINT NOT NULL DEFAULT 0
currency_code VARCHAR(3) NOT NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE NULLS NOT DISTINCT (campaign_id, creative_id, placement_type_id, community_id, metric_date)
```

### 3.3 Optional financial and conversion tables

```
ad_campaign_budget_ledger
-------------------------
id UUID PK
campaign_id UUID FK -> ad_campaigns.id ON DELETE CASCADE
entry_type VARCHAR(30) NOT NULL
    CHECK(entry_type IN ('DEPOSIT','SPEND','REFUND','ADJUSTMENT'))
amount_minor BIGINT NOT NULL
currency_code VARCHAR(3) NOT NULL
billing_transaction_id UUID NULL
billing_refund_id UUID NULL
source_reference VARCHAR(150) NULL
adjustment_reason TEXT NULL
created_by_user_id UUID FK -> users.id ON DELETE SET NULL
idempotency_key VARCHAR(150) NOT NULL UNIQUE
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

```
ad_conversion_events
--------------------
id UUID PK
campaign_id UUID FK -> ad_campaigns.id ON DELETE CASCADE
creative_id UUID FK -> ad_creatives.id ON DELETE SET NULL
community_id UUID FK -> communities.id ON DELETE SET NULL
conversion_type VARCHAR(40) NOT NULL
attribution_method VARCHAR(30) NOT NULL
source_module VARCHAR(40) NULL
source_event_reference VARCHAR(150) NULL
attribution_reference_hash BYTEA NULL
conversion_value_minor BIGINT NULL
currency_code VARCHAR(3) NULL
idempotency_key VARCHAR(150) NOT NULL UNIQUE
converted_at TIMESTAMPTZ NOT NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

### 3.3.5 Community sponsorship details

For `COMMUNITY_SPONSORSHIP` campaigns — a business sponsors a specific community and gets its name/logo shown to members.

```
ad_community_sponsorships
--------------------------
id UUID PK
campaign_id UUID NOT NULL UNIQUE FK -> ad_campaigns.id ON DELETE CASCADE
sponsored_community_id UUID FK -> communities.id ON DELETE CASCADE
sponsorship_tier VARCHAR(30) DEFAULT 'STANDARD'
    CHECK('STANDARD','PREMIUM','EXCLUSIVE')
sponsor_display_name VARCHAR(200) NULL
sponsor_logo_media_id UUID FK -> media_objects.id NULL
benefits JSONB NOT NULL DEFAULT '[]'   -- what the sponsor gets (placement list, badge, etc.)
visible_to_members BOOLEAN NOT NULL DEFAULT true
created_at / updated_at
```

One sponsorship row per campaign (UNIQUE on `campaign_id`). The `sponsored_community_id` identifies which community is sponsored.

### 3.4 Seed data for placements

```sql
INSERT INTO ad_placement_types(code, name, surface, format) VALUES
('FEED_NATIVE','Feed Native Ad','FEED','NATIVE_CARD'),
('FEED_BANNER','Feed Banner','FEED','BANNER'),
('MARKETPLACE_NATIVE','Marketplace Ad','MARKETPLACE','NATIVE_CARD'),
('EVENTS_NATIVE','Events Ad','EVENTS','NATIVE_CARD'),
('JOBS_NATIVE','Jobs Ad','JOBS','NATIVE_CARD'),
('PROPERTY_NATIVE','Property Ad','PROPERTY','NATIVE_CARD'),
('VEHICLE_NATIVE','Vehicle Ad','VEHICLE','NATIVE_CARD'),
('SPARE_BAG_NATIVE','Spare Bag Ad','SPARE_BAG','NATIVE_CARD'),
('SERVICE_NATIVE','Service Ad','SERVICE','NATIVE_CARD');
```

### 3.5 Design notes

1. **No `ad_accounts`:** Reuse existing users, business accounts and business membership permissions.
2. **No `ad_impressions` or `ad_clicks`:** Increment counters in `ad_campaign_metrics`.
3. **Community sponsorship** is a campaign kind, not a separate table.
4. **Promoted content** references the original post/listing/event through `ad_creative_sources`.
5. **Dedicated advertisement** stores content in `ad_creatives` with media in `ad_creative_assets`.
6. Both individual users and business accounts can create ads (changed from business-only).

### 3.6 Removing `is_sponsored` from `feed_posts`

The `is_sponsored` column on `feed_posts` is superseded by the `ad_campaigns` module. A post is considered "sponsored" if an active `ad_creative_sources` row references it with a `PROMOTED_CONTENT` creative in an ACTIVE campaign. The column will be retained but deprecated.

---

## 4. Featured Listings

Featured listings are separate from Ads. A featured listing gives priority placement within its specific marketplace and optionally in the feed.

### 4.1 Featured listing pricing tiers

The existing `featured_items` and `featured_placement_rules` infrastructure is reused. Two placement strategies:

| Placement | Effect | Example price |
|---|---|---|
| Marketplace-only | Priority in the specific listing category (property, vehicle, jobs, etc.) | £4 |
| Marketplace + Feed | Priority in the listing category AND appears in the community feed | £8 |

### 4.2 Featured listing statistics

```
featured_item_statistics
------------------------
id UUID PK
featured_item_id UUID FK -> featured_items.id ON DELETE CASCADE
community_id UUID FK -> communities.id ON DELETE SET NULL
metric_date DATE NOT NULL
impressions_count BIGINT NOT NULL DEFAULT 0
clicks_count BIGINT NOT NULL DEFAULT 0
saves_count BIGINT NOT NULL DEFAULT 0
contacts_count BIGINT NOT NULL DEFAULT 0
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE (featured_item_id, community_id, metric_date)
```

---

## 5. Event Ticketing System

### 5.1 Existing `events` table changes

```
events
------
+ business_account_id UUID FK -> business_accounts.id ON DELETE SET NULL
+ is_ticketed BOOLEAN NOT NULL DEFAULT false
+ ticket_currency_code CHAR(3) NULL   -- enforced on all ticket types
+ ticket_fee_model VARCHAR(30) NULL
    CHECK('BUYER_PAYS','ORGANISER_ABSORBS','SPLIT')
+ refund_policy VARCHAR(30) NOT NULL DEFAULT 'ORGANISER_DISCRETION'
    CHECK('NO_REFUNDS','ORGANISER_DISCRETION','REFUND_UNTIL_EVENT','REFUND_UNTIL_CUTOFF')
+ refund_cutoff_hours INTEGER NULL     -- hours before event; for REFUND_UNTIL_CUTOFF
+ cancellation_reason TEXT NULL
+ cancelled_at TIMESTAMPTZ NULL
+ target_mode TEXT NOT NULL DEFAULT 'SINGLE_COMMUNITY'
    CHECK('SINGLE_COMMUNITY','SELECTED_COMMUNITIES','ALL_SAME_ORIGIN','ALL_SAME_CURRENT_COUNTRY')
```

`ticket_currency_code` enforces that all ticket types for this event use the same currency (validated by trigger).

### 5.2 Payout account field requirements (per country)

Bank account structures differ by country — UK needs sort code + account number, US needs ABA routing + account number, India needs IFSC + account number, Mexico needs CLABE, Ethiopia just needs account number + bank name, and so on.

Instead of hard-coding columns per country, a **config table** declares which fields each country requires. The mobile app reads this to render the correct form; the backend validates against it.

```
payout_account_field_requirements
---------------------------------
id UUID PK
country_id UUID FK -> countries.id
payout_method VARCHAR(30) CHECK('BANK_ACCOUNT','MOBILE_MONEY')
required_fields TEXT[] NOT NULL          -- e.g. ['sort_code','account_number']
optional_fields TEXT[] DEFAULT '{}'
field_labels JSONB NOT NULL              -- {"sort_code": "Sort Code", ...}
field_patterns JSONB NOT NULL            -- {"sort_code": "^[0-9]{6}$", ...}
is_active BOOLEAN NOT NULL DEFAULT true

UNIQUE(country_id, payout_method)
```

Seeded requirements for key markets:

| Country | Method | Required fields |
|---|---|---|
| GB | BANK_ACCOUNT | `sort_code`, `account_number` |
| US | BANK_ACCOUNT | `routing_number`, `account_number` |
| ET | BANK_ACCOUNT | `account_number`, `bank_name` |
| ET | MOBILE_MONEY | `mobile_money_provider`, `mobile_money_phone` (Telebirr) |
| KE | BANK_ACCOUNT | `account_number`, `bank_name` |
| KE | MOBILE_MONEY | `mobile_money_provider`, `mobile_money_phone` (M-Pesa) |
| NG | BANK_ACCOUNT | `account_number` (NUBAN), `bank_code` |
| IN | BANK_ACCOUNT | `ifsc_code`, `account_number` |
| CA | BANK_ACCOUNT | `transit_number`, `institution_number`, `account_number` |
| AU | BANK_ACCOUNT | `bsb`, `account_number` |
| EU/AE/SA/TR/etc | BANK_ACCOUNT | `iban` |
| MX | BANK_ACCOUNT | `clabe` |
| BR | BANK_ACCOUNT | `pix_key` |

### 5.3 Organiser payout accounts

Organisers register payout destination details once — staff verify them and manually transfer payouts.

```
event_organiser_payout_accounts
-------------------------------
id UUID PK
organiser_user_id UUID FK -> users.id NULL
business_account_id UUID FK -> business_accounts.id NULL
payout_method VARCHAR(30) CHECK('BANK_ACCOUNT','MOBILE_MONEY','OTHER')
country_id UUID FK -> countries.id
currency_code CHAR(3) NOT NULL
account_holder_name VARCHAR(200) NOT NULL
bank_name VARCHAR(200) NULL

-- Universal structured fields (columns for masking/lookup)
iban VARCHAR(34) NULL
account_number VARCHAR(64) NULL

-- Country-specific bank fields as JSONB
--   GB: {"sort_code":"200415"}
--   US: {"routing_number":"021000021"}
--   IN: {"ifsc_code":"HDFC0001234"}
--   ET: {"branch_name":"Bole Branch"}
--   CA: {"transit_number":"01642","institution_number":"001"}
bank_details JSONB NOT NULL DEFAULT '{}'

mobile_money_provider VARCHAR(50) NULL     -- TELEBIRR, MPESA, AMOLE, ...
mobile_money_phone VARCHAR(20) NULL

other_details JSONB NULL                   -- fallback

verification_status VARCHAR(20) DEFAULT 'PENDING'
    CHECK('PENDING','VERIFIED','REJECTED')
verified_at TIMESTAMPTZ NULL
verified_by_user_id UUID FK -> users.id NULL
verification_notes TEXT NULL
is_default BOOLEAN NOT NULL DEFAULT false

XOR: exactly one of organiser_user_id / business_account_id
CHECK: BANK_ACCOUNT => iban OR account_number OR non-empty bank_details
CHECK: MOBILE_MONEY => provider AND phone required
UNIQUE: one default payout account per organiser
```

> **Security:** `account_number`, `iban`, `bank_details`, `mobile_money_phone` are sensitive financial data. Encrypt at rest; mask in all API responses and logs.

### 5.4 Ticket types

```
event_ticket_types
------------------
id UUID PK
event_id UUID FK -> events.id ON DELETE CASCADE
name VARCHAR(150) NOT NULL
description TEXT NULL
price_amount NUMERIC(12,2) NOT NULL CHECK(>= 0)   -- 0 = free ticket
currency_code CHAR(3) NOT NULL   -- trigger validates = event.ticket_currency_code
quantity_total INTEGER NOT NULL CHECK(> 0)
quantity_sold INTEGER NOT NULL DEFAULT 0
quantity_reserved INTEGER NOT NULL DEFAULT 0
max_per_order INTEGER NOT NULL DEFAULT 10 CHECK(>= 1)
sales_start_at / sales_end_at TIMESTAMPTZ NOT NULL
sort_order INTEGER NOT NULL DEFAULT 0
is_active BOOLEAN NOT NULL DEFAULT true
restrictions JSONB NOT NULL DEFAULT '{}'

CHECK(sales_end_at > sales_start_at)
CHECK(quantity_sold + quantity_reserved <= quantity_total)
```

### 5.5 Event ticket promo codes

```
event_ticket_promo_codes
------------------------
id UUID PK
event_id UUID FK -> events.id ON DELETE CASCADE
code VARCHAR(50) NOT NULL UNIQUE per event (UNIQUE(event_id, code))
discount_type VARCHAR(20) CHECK('PERCENTAGE','FIXED_AMOUNT')
discount_value NUMERIC(12,2) NOT NULL CHECK(> 0)
currency_code CHAR(3) NULL  -- required for FIXED_AMOUNT
max_uses INTEGER NULL       -- NULL = unlimited
used_count INTEGER NOT NULL DEFAULT 0
max_uses_per_user INTEGER NULL
applicable_ticket_type_ids UUID[] NULL  -- NULL = applies to all
valid_from / valid_until TIMESTAMPTZ
is_active BOOLEAN NOT NULL DEFAULT true
created_by_user_id UUID FK -> users.id

CHECK(PERCENTAGE => discount_value <= 100)
CHECK(FIXED_AMOUNT => currency_code IS NOT NULL)
```

### 5.6 Ticket reservations

Holds tickets during checkout with a TTL. Prevents overselling under concurrent load.

```
ticket_reservations
-------------------
id UUID PK
ticket_type_id UUID FK -> event_ticket_types.id ON DELETE CASCADE
buyer_user_id UUID FK -> users.id ON DELETE CASCADE
quantity INTEGER NOT NULL CHECK(> 0)
status VARCHAR(20) DEFAULT 'ACTIVE' CHECK('ACTIVE','CONFIRMED','RELEASED','EXPIRED')
expires_at TIMESTAMPTZ NOT NULL   -- TTL for hold
confirmed_order_id UUID NULL      -- deferred FK -> ticket_orders.id, set when CONFIRMED
created_at / updated_at

CHECK(expires_at > created_at)
CHECK(status <> 'CONFIRMED' OR confirmed_order_id IS NOT NULL)
```

A scheduled job releases expired reservations and decrements `quantity_reserved` on ticket types.

### 5.7 Ticket orders

```
ticket_orders
-------------
id UUID PK
event_id UUID FK -> events.id ON DELETE RESTRICT
buyer_user_id UUID FK -> users.id ON DELETE SET NULL
order_number TEXT NOT NULL UNIQUE
currency_code CHAR(3) NOT NULL
subtotal_amount NUMERIC(12,2) NOT NULL
platform_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0
discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0
total_amount NUMERIC(12,2) NOT NULL
fee_paid_by VARCHAR(30) CHECK('BUYER_PAYS','ORGANISER_ABSORBS','SPLIT')
promo_code_id UUID FK -> event_ticket_promo_codes.id NULL
reservation_id UUID FK -> ticket_reservations.id NULL   -- deferred FK
status VARCHAR(30) DEFAULT 'PENDING'
    CHECK('PENDING','RESERVED','PAYMENT_PENDING','PAID','CANCELLED',
          'REFUND_REQUESTED','PARTIALLY_REFUNDED','REFUNDED','EXPIRED')
payment_provider TEXT NULL
payment_provider_id TEXT NULL
payment_method_summary VARCHAR(60) NULL   -- e.g. "Visa ****4242"
idempotency_key TEXT UNIQUE
paid_at / cancelled_at / expires_at TIMESTAMPTZ NULL

CHECK(total_amount = subtotal_amount - discount_amount + platform_fee_amount)
CHECK(status <> 'PAID' OR paid_at IS NOT NULL)
UNIQUE(payment_provider, payment_provider_id) WHERE payment_provider_id IS NOT NULL
UNIQUE(reservation_id) WHERE reservation_id IS NOT NULL
```

Both `reservation_id` and `confirmed_order_id` are **deferred FKs** — created via `ALTER TABLE` after both tables exist to break the circular dependency.

### 5.8 Ticket order items

```
ticket_order_items
------------------
id UUID PK
order_id UUID FK -> ticket_orders.id ON DELETE CASCADE
ticket_type_id UUID FK -> event_ticket_types.id ON DELETE RESTRICT
ticket_type_name_snapshot VARCHAR(150) NOT NULL  -- immutable snapshot
quantity INTEGER NOT NULL CHECK(> 0)
unit_price NUMERIC(12,2) NOT NULL
discount_per_unit NUMERIC(12,2) NOT NULL DEFAULT 0
line_total NUMERIC(12,2) NOT NULL
```

### 5.9 Ticket order status history

Audit trail for every order state transition.

```
ticket_order_status_history
---------------------------
id UUID PK
order_id UUID FK -> ticket_orders.id ON DELETE CASCADE
previous_status VARCHAR(30) NULL
new_status VARCHAR(30) NOT NULL
changed_by_user_id UUID FK -> users.id NULL
change_source VARCHAR(20) CHECK('BUYER','ORGANISER','ADMIN','SYSTEM','PAYMENT_WEBHOOK')
reason TEXT NULL
metadata JSONB NULL
changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

### 5.10 Issued tickets

```
issued_tickets
--------------
id UUID PK
order_item_id UUID FK -> ticket_order_items.id
ticket_type_id UUID FK -> event_ticket_types.id
event_id UUID FK -> events.id
holder_user_id UUID FK -> users.id NULL
holder_name VARCHAR(200) NULL          -- for non-account holders
holder_email VARCHAR(320) NULL
ticket_code TEXT NOT NULL UNIQUE
qr_payload TEXT NOT NULL UNIQUE
status VARCHAR(20) DEFAULT 'VALID'
    CHECK('VALID','CHECKED_IN','CANCELLED','REFUNDED','EXPIRED','TRANSFERRED')
checked_in_at TIMESTAMPTZ NULL
checked_in_by_user_id UUID FK -> users.id NULL
transferred_to_ticket_id UUID FK -> issued_tickets.id NULL  -- ticket transfer chain
```

### 5.11 Ticket check-ins

Every scan attempt is logged — valid or not. Supports offline scanning for unreliable connectivity venues.

```
ticket_check_ins
----------------
id UUID PK
issued_ticket_id UUID FK -> issued_tickets.id
scanned_by_user_id UUID FK -> users.id NULL
scan_result VARCHAR(20) CHECK('VALID','ALREADY_CHECKED_IN','INVALID',
    'REFUNDED','CANCELLED','EXPIRED','TRANSFERRED')
scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
device_id TEXT NULL
latitude / longitude NUMERIC(9,6) NULL  -- venue validation
is_offline_scan BOOLEAN NOT NULL DEFAULT false
synced_at TIMESTAMPTZ NULL              -- NULL until offline scan synced
notes TEXT NULL
```

### 5.12 Ticket refunds

```
ticket_refunds
--------------
id UUID PK
order_id UUID FK -> ticket_orders.id
issued_ticket_id UUID FK -> issued_tickets.id NULL
refund_amount NUMERIC(12,2) NOT NULL CHECK(> 0)
platform_fee_refund NUMERIC(12,2) NOT NULL DEFAULT 0  -- tracks fee reversal
currency_code CHAR(3) NOT NULL
refund_type VARCHAR(20) CHECK('BUYER_REQUESTED','ORGANISER_INITIATED',
    'EVENT_CANCELLED','ADMIN_OVERRIDE')
status VARCHAR(20) DEFAULT 'PENDING'
    CHECK('PENDING','APPROVED','PROCESSING','PROCESSED','REJECTED','FAILED')
reason TEXT NOT NULL
provider_refund_id TEXT NULL
idempotency_key TEXT UNIQUE
requested_by / approved_by UUID FK -> users.id
created_at / approved_at / processed_at TIMESTAMPTZ
```

### 5.13 Ticket payment events

Webhook handling from external payment providers. Prevents duplicate processing.

```
ticket_payment_events
---------------------
id UUID PK
provider_key VARCHAR(40) NOT NULL
provider_event_id TEXT NOT NULL
event_type TEXT NOT NULL
order_id UUID FK -> ticket_orders.id NULL
refund_id UUID FK -> ticket_refunds.id NULL
payload JSONB NOT NULL
signature_verified BOOLEAN NOT NULL DEFAULT false
status VARCHAR(20) DEFAULT 'RECEIVED'
    CHECK('RECEIVED','PROCESSING','PROCESSED','FAILED','IGNORED')
error_detail TEXT NULL
received_at / processed_at TIMESTAMPTZ

UNIQUE(provider_key, provider_event_id)
```

### 5.14 Organiser payouts

```
ticket_organiser_payouts
------------------------
id UUID PK
event_id UUID FK -> events.id ON DELETE RESTRICT
payout_account_id UUID FK -> event_organiser_payout_accounts.id ON DELETE RESTRICT
organiser_user_id UUID FK -> users.id NULL
business_account_id UUID FK -> business_accounts.id NULL
period_start / period_end TIMESTAMPTZ NOT NULL
gross_revenue NUMERIC(12,2) NOT NULL
total_platform_fees NUMERIC(12,2) NOT NULL DEFAULT 0
total_refunds_deducted NUMERIC(12,2) NOT NULL DEFAULT 0
net_payout_amount NUMERIC(12,2) NOT NULL
currency_code CHAR(3) NOT NULL
tickets_sold_count / tickets_refunded_count INTEGER NOT NULL DEFAULT 0
status VARCHAR(20) DEFAULT 'PENDING'
    CHECK('PENDING','PROCESSING','COMPLETED','FAILED','ON_HOLD','CANCELLED')
disbursement_method VARCHAR(20) DEFAULT 'MANUAL'
    CHECK('MANUAL','STRIPE_GLOBAL')    -- MANUAL = staff wire; STRIPE_GLOBAL = Stripe Global Payouts (later per-country option)
provider_payout_id TEXT NULL           -- Stripe payout object id when disbursement_method='STRIPE_GLOBAL'
requested_by_user_id UUID FK -> users.id NULL  -- user who submitted the payout request (NULL = admin-initiated)
approved_by_user_id UUID FK -> users.id NULL   -- admin who approved the payout
approved_at TIMESTAMPTZ NULL
transfer_reference TEXT NULL             -- bank ref / mobile money txn id recorded by staff
transferred_by_user_id UUID FK -> users.id NULL  -- staff member who made the transfer
failure_reason TEXT NULL
idempotency_key TEXT UNIQUE
scheduled_at TIMESTAMPTZ NULL
completed_at TIMESTAMPTZ NULL

XOR: exactly one of organiser_user_id / business_account_id
Workflow: requested (PENDING) -> approved (approved_at required for PROCESSING/COMPLETED)
    -> staff transfer -> COMPLETED (completed_at; MANUAL also requires transfer_reference)
provider_payout_id only valid with disbursement_method='STRIPE_GLOBAL'; partial
    unique index prevents duplicate provider payout records
```

**Payout flow** — buyer payment lands in Diasporum's Stripe (or local provider) account; the ledger credits the organiser; the organiser requests a payout; an admin reviews and approves; staff transfer via banking facilities and record `transfer_reference`. Organisers never need provider accounts. `disbursement_method='STRIPE_GLOBAL'` is reserved for a later per-country optimisation where Stripe Global Payouts is available — it does not require the organiser to hold a Stripe account either.

### 5.15 Organiser financial ledger

Immutable, append-only journal of all money movements. The organiser's available balance is always `SUM(credit_amount - debit_amount)`.

```
ticket_organiser_ledger
-----------------------
id UUID PK
event_id UUID FK -> events.id ON DELETE RESTRICT
organiser_user_id / business_account_id (XOR)
entry_type VARCHAR(30) CHECK('TICKET_SALE','PLATFORM_FEE','REFUND_DEDUCTION',
    'FEE_REFUND','PAYOUT','ADJUSTMENT')
order_id UUID FK -> ticket_orders.id NULL
refund_id UUID FK -> ticket_refunds.id NULL
payout_id UUID FK -> ticket_organiser_payouts.id NULL
credit_amount NUMERIC(12,2) NOT NULL DEFAULT 0
debit_amount NUMERIC(12,2) NOT NULL DEFAULT 0
currency_code CHAR(3) NOT NULL
description TEXT NULL
idempotency_key TEXT NOT NULL UNIQUE

CHECK: exactly one of credit/debit > 0 (never both)
Triggers: UPDATE and DELETE are blocked (immutability)
```

**Ledger flow example** (£20 ticket, BUYER_PAYS fee model):

| Entry | Credit | Debit | Balance |
|---|---|---|---|
| TICKET_SALE | £20.00 | | £20.00 |
| PLATFORM_FEE | | £2.00 | £18.00 |
| PAYOUT | | £18.00 | £0.00 |

If ticket is refunded before payout:

| Entry | Credit | Debit | Balance |
|---|---|---|---|
| TICKET_SALE | £20.00 | | £20.00 |
| PLATFORM_FEE | | £2.00 | £18.00 |
| REFUND_DEDUCTION | | £20.00 | -£2.00 |
| FEE_REFUND | £2.00 | | £0.00 |

### 5.16 Ticket fee configuration

```
ticket_fee_configurations
-------------------------
id UUID PK
country_id UUID FK -> countries.id NULL  -- NULL = global default
event_category_id UUID FK -> event_categories.id NULL
fixed_fee_minor BIGINT NOT NULL DEFAULT 0
commission_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(0-5000)
currency_code CHAR(3) NOT NULL
fee_model VARCHAR(30) DEFAULT 'BUYER_PAYS' CHECK('BUYER_PAYS','ORGANISER_ABSORBS','SPLIT')
organiser_split_bps INTEGER NULL  -- required when fee_model = 'SPLIT'
min_payout_amount NUMERIC(12,2) NULL  -- minimum amount before payout is triggered
payout_delay_days INTEGER NOT NULL DEFAULT 7 CHECK(0-90)
is_active BOOLEAN NOT NULL DEFAULT true
```

### 5.17 Payment providers

Event ticket payments use external payment providers (Stripe, Chapa, ArifPay) — not In-App Purchase — for physical events. This is compliant with Apple and Google policies.

### 5.18 Ticketing design rationale

| What was missing | What was added | Why |
|---|---|---|
| No organiser balance tracking | `ticket_organiser_ledger` | Need to compute available balance, reconcile sales/refunds/payouts |
| No ticket reservation | `ticket_reservations` | Prevents overselling during concurrent checkout |
| No order audit trail | `ticket_order_status_history` | Regulatory/dispute resolution needs |
| No payment webhook handling | `ticket_payment_events` | Stripe/Chapa callbacks need deduplication and processing tracking |
| Payout account as loose text | `event_organiser_payout_accounts` | Reusable across events, proper onboarding lifecycle |
| No promo codes | `event_ticket_promo_codes` | Standard event monetisation tool |
| No currency consistency | `ticket_currency_code` on events + trigger | Mixed currencies in one event causes payment/accounting chaos |
| No refund policy fields | `refund_policy`, `refund_cutoff_hours` | Explicit cancellation/refund rules per event |
| No offline scanning support | `is_offline_scan`, `synced_at` on check-ins | Ethiopia and other markets have unreliable venue connectivity |
| No ticket transfer | `TRANSFERRED` status + `transferred_to_ticket_id` | Attendees need to give tickets to others |

---

## 6. Spare Bag Module Redesign

### 6.1 Structure

Two distinct posting types with separate tabs:
1. **Items to Send** — Posted by parcel senders
2. **Traveller Journeys** — Posted by travellers

### 6.2 Traveller profiles

```
spare_bag_traveller_profiles
-----------------------------
id UUID PK
user_id UUID FK -> users.id ON DELETE CASCADE UNIQUE
display_name VARCHAR(150) NULL
bio TEXT NULL CHECK(bio IS NULL OR length(bio) <= 2000)
is_verified BOOLEAN NOT NULL DEFAULT false
verification_status VARCHAR(20) NOT NULL DEFAULT 'NOT_VERIFIED'
    CHECK(verification_status IN ('NOT_VERIFIED','PENDING','VERIFIED','REJECTED','REVOKED'))
accepted_item_categories TEXT[] NULL
regular_routes JSONB NULL
status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK(status IN ('ACTIVE','PAUSED','SUSPENDED','CLOSED'))
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

### 6.3 Measurement units for items

```
spare_bag_measurement_units
---------------------------
unit_code VARCHAR(10) PK CHECK(unit_code = upper(trim(unit_code)))
display_name VARCHAR(50) NOT NULL
unit_type VARCHAR(20) NOT NULL CHECK(unit_type IN ('WEIGHT','VOLUME','PIECE','PAIR','PACKAGE'))
```

Seed data:
```sql
INSERT INTO spare_bag_measurement_units VALUES
('KG','Kilogram','WEIGHT'),('G','Gram','WEIGHT'),
('ML','Millilitre','VOLUME'),('L','Litre','VOLUME'),
('PIECE','Piece','PIECE'),('PAIR','Pair','PAIR'),
('BOX','Box','PACKAGE'),('PACK','Pack','PACKAGE');
```

### 6.4 Sender item requests (Items to Send)

Replace the monolithic `spare_bag_listings` with:

```
spare_bag_sender_requests
-------------------------
id UUID PK
owner_user_id UUID FK -> users.id ON DELETE CASCADE
from_country_id UUID FK -> countries.id ON DELETE RESTRICT
from_city VARCHAR(150) NOT NULL
to_country_id UUID FK -> countries.id ON DELETE RESTRICT
to_city VARCHAR(150) NOT NULL
description TEXT NULL CHECK(description IS NULL OR length(description) <= 5000)
status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED','MATCHED','CLOSED','EXPIRED','REMOVED'))
published_at TIMESTAMPTZ NULL
closes_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
deleted_at TIMESTAMPTZ NULL

CHECK(from_country_id <> to_country_id OR from_city <> to_city)
```

```
spare_bag_sender_items
----------------------
id UUID PK
sender_request_id UUID FK -> spare_bag_sender_requests.id ON DELETE CASCADE
item_name VARCHAR(200) NOT NULL
item_description TEXT NULL CHECK(item_description IS NULL OR length(item_description) <= 1000)
category_key TEXT FK -> spare_bag_categories.category_key ON DELETE RESTRICT NULL
quantity NUMERIC(10,2) NOT NULL CHECK(quantity > 0)
unit_code VARCHAR(10) FK -> spare_bag_measurement_units.unit_code ON DELETE RESTRICT
per_unit_amount NUMERIC(10,2) NULL CHECK(per_unit_amount IS NULL OR per_unit_amount > 0)
per_unit_unit VARCHAR(10) NULL
declared_value_amount NUMERIC(12,2) NULL CHECK(declared_value_amount IS NULL OR declared_value_amount >= 0)
declared_value_currency CHAR(3) NULL
sort_order INTEGER NOT NULL DEFAULT 0
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

```
spare_bag_sender_request_media
------------------------------
sender_request_id UUID FK -> spare_bag_sender_requests.id ON DELETE CASCADE
media_id UUID FK -> media_objects.id ON DELETE RESTRICT
sort_order INTEGER NOT NULL DEFAULT 0
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
PK(sender_request_id, media_id)
```

### 6.5 Traveller journeys

```
spare_bag_traveller_journeys
-----------------------------
id UUID PK
traveller_profile_id UUID FK -> spare_bag_traveller_profiles.id ON DELETE CASCADE
from_country_id UUID FK -> countries.id ON DELETE RESTRICT
from_city VARCHAR(150) NOT NULL
to_country_id UUID FK -> countries.id ON DELETE RESTRICT
to_city VARCHAR(150) NOT NULL
from_airport_id UUID FK -> airports.id ON DELETE SET NULL
to_airport_id UUID FK -> airports.id ON DELETE SET NULL
pickup_location TEXT NULL CHECK(pickup_location IS NULL OR length(pickup_location) <= 500)
delivery_location TEXT NULL CHECK(delivery_location IS NULL OR length(delivery_location) <= 500)
travel_date DATE NOT NULL
travel_date_end DATE NULL
available_capacity_kg NUMERIC(8,2) NULL CHECK(available_capacity_kg IS NULL OR available_capacity_kg > 0)
max_single_parcel_kg NUMERIC(8,2) NULL CHECK(max_single_parcel_kg IS NULL OR max_single_parcel_kg > 0)
price_per_kg NUMERIC(12,2) NULL CHECK(price_per_kg IS NULL OR price_per_kg >= 0)
price_per_piece NUMERIC(12,2) NULL CHECK(price_per_piece IS NULL OR price_per_piece >= 0)
price_currency CHAR(3) NOT NULL CHECK(price_currency ~ '^[A-Z]{3}$')
accepted_categories TEXT[] NULL
notes TEXT NULL CHECK(notes IS NULL OR length(notes) <= 3000)
status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED','CLOSED','EXPIRED','REMOVED'))
published_at TIMESTAMPTZ NULL
closes_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
deleted_at TIMESTAMPTZ NULL

CHECK(travel_date_end IS NULL OR travel_date_end >= travel_date)
CHECK(from_country_id <> to_country_id OR from_city <> to_city)
```

### 6.6 Visibility rules for Spare Bag

Spare Bag visibility depends on origin and destination country:
- Users of communities whose `destination_country_id` matches the sender's `from_country_id` can see and respond.
- Users of communities whose `destination_country_id` matches the sender's `to_country_id` can also see and respond.
- Users in the "home country" community (origin = destination = that country) can also see items going to/from their country.

### 6.7 Configurable availability per country

```
spare_bag_country_config
------------------------
country_id UUID PK FK -> countries.id ON DELETE CASCADE
is_enabled BOOLEAN NOT NULL DEFAULT true
requires_item_disclosure BOOLEAN NOT NULL DEFAULT true
prohibited_categories TEXT[] NULL
legal_notice TEXT NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

---

## 7. AI Moderation Module

### 7.1 Architecture

A central moderation module shared across all features. Provider-independent interface for AI classification.

### 7.2 Moderation review queue

```
moderation_queue
----------------
id UUID PK
content_type VARCHAR(40) NOT NULL
    CHECK(content_type IN ('FEED_POST','COMMENT','POLL','PROFILE','PROFILE_PICTURE',
        'BUSINESS_PROFILE','PROPERTY_LISTING','VEHICLE_LISTING','JOB_LISTING',
        'SHOP_PRODUCT','AD_CAMPAIGN','AD_CREATIVE','PRIVATE_MESSAGE','GROUP_CHAT_MESSAGE',
        'VOICE_ROOM','EVENT','SERVICE_LISTING','SPARE_BAG_REQUEST','SPARE_BAG_JOURNEY',
        'MATCHMAKING_PROFILE'))
content_id UUID NOT NULL
submitted_by VARCHAR(20) NOT NULL CHECK(submitted_by IN ('AI','USER_REPORT','ADMIN','SYSTEM'))
ai_risk_score NUMERIC(5,4) NULL CHECK(ai_risk_score IS NULL OR ai_risk_score BETWEEN 0 AND 1)
ai_risk_level VARCHAR(10) NULL CHECK(ai_risk_level IS NULL OR ai_risk_level IN ('LOW','UNCERTAIN','HIGH'))
ai_categories TEXT[] NULL
ai_provider TEXT NULL
ai_response_id TEXT NULL
queue_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK(queue_status IN ('PENDING','ASSIGNED','IN_REVIEW','RESOLVED','ESCALATED','AUTO_RESOLVED'))
assigned_to_user_id UUID FK -> users.id ON DELETE SET NULL
priority INTEGER NOT NULL DEFAULT 0
decision VARCHAR(20) NULL
    CHECK(decision IS NULL OR decision IN ('APPROVE','REJECT','RESTRICT','QUARANTINE','WARN','ESCALATE'))
decision_reason TEXT NULL
decided_by_user_id UUID FK -> users.id ON DELETE SET NULL
decided_at TIMESTAMPTZ NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

### 7.3 Moderation policy rules

```
moderation_policy_rules
-----------------------
id UUID PK
policy_key VARCHAR(80) NOT NULL UNIQUE
content_type VARCHAR(40) NOT NULL
risk_threshold_auto_approve NUMERIC(5,4) NOT NULL DEFAULT 0.2
risk_threshold_auto_reject NUMERIC(5,4) NOT NULL DEFAULT 0.9
requires_human_review BOOLEAN NOT NULL DEFAULT false
is_active BOOLEAN NOT NULL DEFAULT true
config JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

### 7.4 User appeals

```
moderation_appeals
------------------
id UUID PK
moderation_queue_id UUID FK -> moderation_queue.id ON DELETE CASCADE NULL
moderation_action_id UUID FK -> moderation_actions.id ON DELETE CASCADE NULL
appellant_user_id UUID FK -> users.id ON DELETE CASCADE
appeal_reason TEXT NOT NULL CHECK(length(trim(appeal_reason)) BETWEEN 1 AND 4000)
status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED'
    CHECK(status IN ('SUBMITTED','IN_REVIEW','UPHELD','OVERTURNED','DISMISSED'))
reviewed_by_user_id UUID FK -> users.id ON DELETE SET NULL
review_notes TEXT NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
reviewed_at TIMESTAMPTZ NULL

CHECK(moderation_queue_id IS NOT NULL OR moderation_action_id IS NOT NULL)
```

### 7.5 Moderation audit trail

```
moderation_audit_log
--------------------
id UUID PK
moderation_queue_id UUID FK -> moderation_queue.id ON DELETE SET NULL
action_type VARCHAR(30) NOT NULL
    CHECK(action_type IN ('AI_REVIEW','HUMAN_REVIEW','AUTO_ACTION','MANUAL_ACTION',
        'APPEAL_SUBMITTED','APPEAL_REVIEWED','CONTENT_RESTORED','ACCOUNT_SANCTION'))
actor_type VARCHAR(20) NOT NULL CHECK(actor_type IN ('AI','ADMIN','MODERATOR','SYSTEM'))
actor_user_id UUID FK -> users.id ON DELETE SET NULL
target_user_id UUID FK -> users.id ON DELETE SET NULL
content_type VARCHAR(40) NULL
content_id UUID NULL
details JSONB NOT NULL DEFAULT '{}'::jsonb
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

---

## 8. On-Demand Translation

### 8.1 Translation cache

```
content_translations
--------------------
id UUID PK
content_type VARCHAR(40) NOT NULL
    CHECK(content_type IN ('FEED_POST','COMMENT','POLL_QUESTION','POLL_OPTION','EVENT_DESCRIPTION',
        'BUSINESS_POST','PROPERTY_DESCRIPTION','VEHICLE_DESCRIPTION','JOB_DESCRIPTION',
        'SHOP_PRODUCT_DESCRIPTION','SERVICE_LISTING','GROUP_CHAT_MESSAGE'))
content_id UUID NOT NULL
field_name VARCHAR(60) NOT NULL DEFAULT 'body'
source_language_code VARCHAR(20) NOT NULL
target_language_code VARCHAR(20) NOT NULL
translated_text TEXT NOT NULL
provider TEXT NOT NULL
provider_response_id TEXT NULL
content_hash VARCHAR(64) NOT NULL
confidence_score NUMERIC(5,4) NULL
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
expires_at TIMESTAMPTZ NULL

UNIQUE(content_type, content_id, field_name, target_language_code)
```

### 8.2 Translation process

1. Get the viewer's preferred language from `user_settings.preferred_language_code`.
2. Check `content_translations` for existing translation.
3. If `content_hash` matches the current content hash, return cached translation.
4. Otherwise, request translation from provider.
5. Cache the result.
6. When original content changes, invalidate translations by updating `content_hash`.

### 8.3 Redis caching

Hot translations are cached in Redis with key pattern `translation:{content_type}:{content_id}:{field}:{lang}`. TTL is configurable. Database serves as the durable fallback.

---

## 9. Cross-Community Features

### 9.1 Listings visibility

| Feature | Own community | Same current-country communities | Other communities |
|---|---|---|---|
| Property listings | Create + view | View + contact | View + contact (by switching community) |
| Vehicle listings | Create + view | View + contact | View + contact (by switching community) |
| Job listings | Create + view | View + apply | View + apply |
| Business directory | Create + view | View + contact | View + contact |

Listings can only be created in own community and communities of the same current country. Users in other communities can view and contact listers but cannot create listings there.

### 9.2 Shop marketplace

- Shops are owned by local businesses.
- Users can shop across communities (cross-shopping is possible).
- Filter items from own community and other communities of the same current country (not same origin).

### 9.3 Matchmaking visibility

Add scope options to `matchmaking_profiles.visibility_scope`:

Update the `visibility_scope` on matchmaking profiles to support more granular options:

```
matchmaking_profiles
--------------------
UPDATE visibility_scope CHECK to allow:
    'COMMUNITY' -- Own community only
    'SAME_CURRENT_COUNTRY' -- Communities with same destination_country_id
    'SAME_ORIGIN_COUNTRY' -- Communities with same origin_country_id  
    'SELECTED_COMMUNITIES' -- Specific list of communities
    'COUNTRY' -- (legacy, treated as SAME_CURRENT_COUNTRY)
```

The `matchmaking_profile_communities` table already exists for selected communities.

### 9.4 Service marketplace

Service marketplace is accessible only within communities of the same country. No cross-country service access.

### 9.5 Cross-community messaging

Messaging is allowed between users across all communities — both user-to-user and user-to-business. No community boundary restriction on DMs.

---

## 10. Country Verification

### 10.1 Live location verification

```
country_verifications
---------------------
id UUID PK
user_id UUID FK -> users.id ON DELETE CASCADE
country_id UUID FK -> countries.id ON DELETE RESTRICT
verification_method VARCHAR(30) NOT NULL
    CHECK(verification_method IN ('LIVE_LOCATION','MANUAL_REVIEW','ADMIN_OVERRIDE','DOCUMENT'))
latitude NUMERIC(9,6) NULL
longitude NUMERIC(9,6) NULL
location_accuracy_m NUMERIC(10,2) NULL
verified_at TIMESTAMPTZ NULL
expires_at TIMESTAMPTZ NULL
status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','VERIFIED','FAILED','EXPIRED','REVOKED'))
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

### 10.2 Grace period configuration

```
country_verification_config
----------------------------
country_id UUID PK FK -> countries.id ON DELETE CASCADE
verification_required BOOLEAN NOT NULL DEFAULT false
grace_period_days INTEGER NOT NULL DEFAULT 30 CHECK(grace_period_days >= 0)
reverification_interval_days INTEGER NULL CHECK(reverification_interval_days IS NULL OR reverification_interval_days > 0)
allowed_methods TEXT[] NOT NULL DEFAULT '{LIVE_LOCATION}'
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

---

## 11. Business Add-Ons

### 11.1 Add-on packages

Businesses can purchase additional listing quotas when their subscription quota runs out.

```
billing_addon_packages
----------------------
id UUID PK
package_key VARCHAR(80) NOT NULL UNIQUE
display_name VARCHAR(200) NOT NULL
description TEXT NULL
target_feature_key TEXT NOT NULL FK -> billing_features.feature_key
quantity_granted INTEGER NOT NULL CHECK(quantity_granted > 0)
validity_days INTEGER NOT NULL CHECK(validity_days > 0)
is_active BOOLEAN NOT NULL DEFAULT true
sort_order INTEGER NOT NULL DEFAULT 0
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

```
billing_addon_prices
--------------------
id UUID PK
addon_package_id UUID FK -> billing_addon_packages.id ON DELETE CASCADE
currency_code CHAR(3) NOT NULL
amount NUMERIC(12,2) NOT NULL CHECK(amount > 0)
provider_key TEXT NULL
provider_product_id TEXT NULL
is_active BOOLEAN NOT NULL DEFAULT true
effective_from TIMESTAMPTZ NOT NULL DEFAULT now()
effective_until TIMESTAMPTZ NULL
UNIQUE(addon_package_id, currency_code, effective_from)
```

Example packages:
- 30 extra property listings (£9.99)
- 50 extra property listings (£14.99)
- 30 extra job listings (£7.99)

Add-on purchases create `billing_entitlement_grants` with `source_type='PURCHASE'`.

---

## 12. Feature Configuration by Country

### 12.1 Feature availability

The existing `feature_flags` table already supports country-scoped configuration. Use it to disable features per country.

Example: Disable Voice Rooms for Ethiopia ↔ Ethiopia community:

```sql
INSERT INTO feature_flags(flag_key, country_id, is_enabled, config)
SELECT 'VOICE_ROOM', c.id, false, '{"reason":"Not available for home-country communities"}'
FROM countries c WHERE c.iso2 = 'ET';
```

---

## 13. Events Community Targeting

Events can target multiple communities:

```
events
------
+ target_mode TEXT NOT NULL DEFAULT 'SINGLE_COMMUNITY'
    CHECK(target_mode IN ('SINGLE_COMMUNITY','SELECTED_COMMUNITIES','ALL_SAME_ORIGIN','ALL_SAME_CURRENT_COUNTRY'))
```

The existing `event_listing_communities` table handles `SELECTED_COMMUNITIES`. The application resolves `ALL_SAME_ORIGIN` and `ALL_SAME_CURRENT_COUNTRY` dynamically.

---

## 14. Call to Action for Posts and Ads

```
feed_posts
----------
+ cta_label VARCHAR(60) NULL
+ cta_url TEXT NULL
    CHECK(cta_url IS NULL OR cta_url ~* '^https?://')
```

For ads, the `ad_creatives` table already has `call_to_action_code` and `call_to_action_url`.

---

## 15. Ads Statistics and Feed Statistics

### 15.1 Ad statistics

Ad campaign metrics are tracked per creative, placement, community, and date in `ad_campaign_metrics`.

### 15.2 Feed post statistics

`feed_post_community_stats` tracks impressions per community per day (defined in Section 1.5).

---

## 16. Monetisation Sources Summary

| Revenue source | Implementation |
|---|---|
| Per-listing charges | `billing_products` with `LISTING_PUBLICATION` kind |
| Featured listings | `featured_items` with `PAID_PROMOTION` kind + `featured_item_statistics` |
| Service lead access | `SERVICE_LEAD_ACCESS` billing feature |
| Business subscriptions | `billing_subscriptions` with `BUSINESS` plan type |
| User subscriptions | `billing_subscriptions` with `PERSONAL` plan type |
| Ads (fixed price) | `ad_campaigns` with `FIXED_FEE` pricing model |
| Ads (campaign budget) | `ad_campaigns` with `PREPAID_BUDGET` pricing model |
| Community sponsorship | `ad_campaigns` with `COMMUNITY_SPONSORSHIP` kind |
| Event ticket sales | `ticket_orders` with platform fee |
| Business add-ons | `billing_addon_packages` purchases |

---

## 17. Admin and AI Content Review

### 17.1 Workflow

```
User submits content
    ↓
AI moderation (moderation_queue with ai_risk_score)
    ├── Low risk (< threshold): Auto-approve → PUBLISHED
    ├── Uncertain (between thresholds): Send to moderation_queue → PENDING
    └── High risk (> threshold): Auto-restrict → QUARANTINE/REJECT
         ↓
Human moderator reviews queue
    ├── Approve → PUBLISHED
    ├── Reject → REMOVED
    └── Restrict → HIDDEN (pending further review)
```

### 17.2 Content types and moderation intensity

| Content type | Moderation approach | Strictness |
|---|---|---|
| Feed posts | AI before publication | Standard |
| Comments/replies | AI moderation | Standard |
| Polls | AI on questions/options | Standard |
| Profile info/pictures | AI + image moderation | Standard |
| Business profiles | AI + verification | Enhanced |
| Property/Vehicle listings | AI + fraud checks | Enhanced |
| Job listings | AI + scam detection | Enhanced |
| Shop products | AI moderation | Standard |
| Advertising campaigns | Stricter AI + approval | Strict |
| Private messages | Anti-spam + report-based | Reactive |
| Group chats | Reporting + spam detection | Reactive |
| Voice rooms | User reporting + moderator | Reactive |

### 17.3 Business account violations

Add `violation_count` and `restricted_until` to business accounts:

```
business_accounts
-----------------
+ violation_count INTEGER NOT NULL DEFAULT 0
+ restricted_until TIMESTAMPTZ NULL
+ identity_verified BOOLEAN NOT NULL DEFAULT false
+ identity_verification_required BOOLEAN NOT NULL DEFAULT false
```

---

## 18. Updated Enum Types

### New enums needed:

```sql
-- Extend visibility_scope to add matchmaking-specific scopes
-- (handled as TEXT CHECK on matchmaking_profiles rather than altering the enum)

-- Extend content_reference_type for new ad/featured content types
ALTER TYPE content_reference_type ADD VALUE IF NOT EXISTS 'SERVICE' AFTER 'SPARE_BAG_LISTING';

-- Extend notification_type for new features
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'EVENT_TICKET_PURCHASED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'EVENT_TICKET_CHECKED_IN';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'EVENT_PAYOUT';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'AD_CAMPAIGN_STATUS';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'AD_CAMPAIGN_REVIEW';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'MODERATION_APPEAL';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'TRANSLATION_READY';

-- Extend report_target_type for new content
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'AD_CAMPAIGN';
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'AD_CREATIVE';
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'EVENT_TICKET_TYPE';
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'SPARE_BAG_SENDER_REQUEST';
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'SPARE_BAG_TRAVELLER_JOURNEY';
```

---

## 19. Key Design Issues Fixed

1. **Community membership restriction removed:** The old trigger `trg_membership_origin_country` forced same-origin membership. Now any user can join any community, with entitlement checks in the application layer.

2. **Ads decoupled from posts:** `is_sponsored` on `feed_posts` is deprecated. Ads are a separate module with their own campaign, creative, and metrics tables.

3. **Spare Bag simplified:** Removed airport-centric design. Now uses country + city. Separate sender requests and traveller journeys. Added traveller profiles.

4. **Multi-community posts:** Posts can now target multiple communities, all same-origin, or all same-current-country communities.

5. **Missing matchmaking visibility:** Added `SAME_CURRENT_COUNTRY` and `SAME_ORIGIN_COUNTRY` options.

6. **Missing event ticketing:** Complete ticketing system with QR codes, check-ins, refunds, and organiser payouts.

7. **No translation support:** Added on-demand translation with caching.

8. **No AI moderation infrastructure:** Added moderation queue, policy rules, appeals, and audit trail.

9. **No country verification:** Added live location verification with configurable grace periods.

10. **Business add-ons missing:** Added add-on packages for extra listing quotas.

---

## 20. Spring Boot Module Structure Updates

### New modules:

```text
advertising/
├── AdvertisingApi.java
└── internal/
    ├── api/rest/          # campaign, creative, placement controllers
    ├── application/       # campaign lifecycle, targeting, analytics
    ├── domain/            # campaign, creative, metrics entities
    └── infrastructure/
        └── persistence/

moderation/
├── ModerationApi.java
└── internal/
    ├── api/rest/          # queue, appeals, admin dashboard
    ├── application/       # AI integration, policy engine, queue management
    ├── domain/            # queue, policy, audit entities
    ├── infrastructure/
    │   ├── ai/            # provider adapters (OpenAI, etc.)
    │   └── persistence/
    └── jobs/              # scheduled review, appeal processing

translation/
├── TranslationApi.java
└── internal/
    ├── api/rest/          # on-demand translation endpoints
    ├── application/       # translation orchestration
    ├── domain/            # translation cache entities
    ├── infrastructure/
    │   ├── provider/      # translation provider adapters
    │   ├── redis/         # Redis cache adapter
    │   └── persistence/

ticketing/
├── TicketingApi.java
└── internal/
    ├── api/rest/          # ticket purchase, check-in, organiser
    ├── application/       # order, inventory, payment orchestration
    ├── domain/            # ticket types, orders, check-ins
    ├── infrastructure/
    │   ├── payment/       # Stripe, Chapa, ArifPay adapters
    │   └── persistence/
    └── jobs/              # reservation expiry, payout processing
```

### Updated modules:

- `community/` — Add cross-community membership management, same-origin/different-origin logic
- `feed/` — Add multi-community targeting, CTA fields, community stats
- `sparebag/` — Complete redesign with sender requests, traveller journeys, traveller profiles
- `events/` — Add ticketing integration, multi-community targeting
- `billing/` — Add add-on packages, new community billing features

---

## 21. Proposed Table Summary (New Tables: ~48)

### Community enhancements (2)
1. `feed_post_community_stats`
2. `country_verifications`

### Country verification (1)
3. `country_verification_config`

### Advertising (13)
4. `ad_call_to_action_types`
5. `ad_campaigns`
6. `ad_creatives`
7. `ad_creative_assets`
8. `ad_creative_sources`
9. `ad_placement_types`
10. `ad_campaign_placements`
11. `ad_campaign_community_targets`
12. `ad_campaign_status_history`
13. `ad_campaign_metrics`
14. `ad_campaign_budget_ledger`
15. `ad_conversion_events`
16. `ad_community_sponsorships`

### Featured listing statistics (1)
17. `featured_item_statistics`

### Event ticketing (16)
18. `payout_account_field_requirements`
19. `event_organiser_payout_accounts`
20. `event_ticket_types`
21. `event_ticket_promo_codes`
22. `ticket_reservations`
23. `ticket_orders`
24. `ticket_order_items`
25. `ticket_order_status_history`
26. `issued_tickets`
27. `ticket_check_ins`
28. `ticket_refunds`
29. `ticket_payment_events`
30. `ticket_organiser_payouts`
31. `ticket_organiser_ledger`
32. `ticket_fee_configurations`

### Spare Bag redesign (7)
33. `spare_bag_traveller_profiles`
34. `spare_bag_measurement_units`
35. `spare_bag_sender_requests`
36. `spare_bag_sender_items`
37. `spare_bag_sender_request_media`
38. `spare_bag_traveller_journeys`
39. `spare_bag_country_config`

### AI Moderation (4)
40. `moderation_queue`
41. `moderation_policy_rules`
42. `moderation_appeals`
43. `moderation_audit_log`

### Translation (1)
44. `content_translations`

### Country verification (2)
45. `country_verifications`
46. `country_verification_config`

### Business add-ons (2)
47. `billing_addon_packages`
48. `billing_addon_prices`

### Column additions to existing tables (~15 columns across 5 tables)

---

## 22. Decisions Requiring Approval

1. **Whether to drop old `spare_bag_listings` table** or keep for backward compatibility during migration.
2. **AI moderation provider** selection (OpenAI, Google Cloud AI, AWS Comprehend, etc.).
3. **Translation provider** selection (Google Translate, DeepL, AWS Translate, etc.).
4. **Ticket payment providers** per country (Stripe, Chapa, ArifPay).
5. **Community sponsorship pricing model** and minimum commitments.
6. **Ad campaign minimum budgets** and pricing floors.
7. **Platform fee structure** for event tickets (fixed + commission percentages).
8. **Offline ticket scanning** strategy for unreliable connectivity venues.
9. **Country verification strictness** — which countries require verification at registration vs. grace period.
10. **Business identity verification** requirements per country.

---

## 23. Required Tests

1. Primary/secondary community assignment and enforcement.
2. Same-origin and different-origin entitlement checks on all cross-community actions.
3. Multi-community post targeting with proper audience resolution.
4. Ad campaign lifecycle: draft → review → active → completed/budget exhausted.
5. Promoted content correctly links to source posts/listings.
6. Ad metrics aggregation per creative/placement/community/day.
7. Event ticket purchase with inventory reservation and race condition handling.
8. QR code generation, validation, and check-in with duplicate prevention.
9. Ticket refund lifecycle and organiser payout calculation.
10. Spare Bag sender request → traveller journey matching and messaging.
11. Traveller profile verification workflow.
12. AI moderation scoring with auto-approve/auto-reject thresholds.
13. Moderation queue assignment and human review workflow.
14. Appeal submission and review lifecycle.
15. On-demand translation with cache invalidation on content update.
16. Country verification with live location and grace period.
17. Business add-on purchase creating entitlement grants.
18. Featured listing statistics aggregation.
19. Feed post community statistics tracking.
20. Cross-community messaging without community boundary.

---

## 24. Country-Based Billing and Subscriptions (implemented in V35–V36)

Designed after the v10.15 delta; extends the existing `billing_*` tables — the
entitlement resolver (`BillingService.consume*`) is unchanged.

**Model:** country policy (`country_billing_settings`) ∩ provider×country
capability (`payment_provider_country_capabilities`) ∩ priced option
(`billing_plan_prices` + `country_id`/`interval_count`/`billing_arrangement`)
→ purchasable offer. Entitlements are identical regardless of purchase channel.

**New tables**
- `payment_providers` — provider registry (STRIPE, APPLE_IAP, GOOGLE_PLAY,
  TELEBIRR, CHAPA, ARIFPAY, BANK_TRANSFER); `integration_type` API/SDK_RECEIPT/MANUAL
- `payment_provider_country_capabilities` — capability matrix per provider×country:
  one-time/recurring/refund support, manual verification, currencies, methods
- `country_billing_settings` — per-country billing policy: enablement, currencies,
  recurring gate, manual-verification acceptance (CASCADE on country delete, like
  other per-country config tables — test suites rely on `DELETE FROM countries`)
- `billing_payment_proofs` — manual-verification submissions (bank ref, receipt
  media, PENDING/VERIFIED/REJECTED + verifier audit)

**Altered tables**
- `billing_plan_prices`: `+country_id` (NULL = currency-level default),
  `+interval_count`, `+billing_arrangement` (RECURRING/PREPAID);
  UNIQUE NULLS NOT DISTINCT over the expanded option key
- `billing_subscriptions`: `+billing_arrangement`, `+source_type`,
  `+country_id`/`+currency_code` purchase snapshots, `+source_order_id`,
  `+provider_billing_id`, `+renewal_reminder_sent_at`
- `billing_orders`: `+subscription_id`, `+country_id`

**Lifecycle semantics**
- RECURRING: provider auto-renews; `cancel_at_period_end`; PAST_DUE driven by
  provider webhooks (dunning config deferred)
- PREPAID: ACTIVE for the purchased term, then EXPIRED by scheduled job;
  renewal = a new order extending `current_period_end` on the same subscription
  row (orders + payments are the term history)
- Manual verification: order PENDING → proof submitted → admin verifies →
  payment SUCCEEDED → subscription activates
- Existing subscriptions are never auto-converted when a country gains
  recurring capability; switching is a voluntary new purchase — the old
  prepaid subscription runs to its term
- Price/config changes never retroactively alter purchased terms
- Billing country = explicit selection at checkout, defaulting to
  `profiles.current_country_id`; never IP-derived. Store-purchase countries
  (Apple/Google storefront) are provider data, not billing country

**Deliberately deferred**: Stripe/Apple/Google/Telebirr/Chapa/ArifPay adapter
implementations (capability rows exist; `ManualPaymentProvider` for
BANK_TRANSFER is the only implementation), dunning/retry policies, scheduled
plan changes, merchant account registry.
