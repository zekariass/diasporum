# Diasporum Property Marketplace

This document describes the implemented property module and its API contract. It covers sale and rental listings only; bookings, payments, rent collection, deposits processing, escrow, contracts, mortgages, and transaction processing are outside this module.

## Architecture and shared boundaries

The backend lives in the existing `propertylistings` module. REST DTOs, JDBC services, validation, and authorization are under `propertylistings.internal`; persistence entities and exact address data are not exposed through the API.

The implementation reuses:

- `users.id` and authenticated `DiasporumUserPrincipal` identity.
- `IdentityApi` and `CommunityApi` for country/community audiences.
- `BusinessAccountsApi` for live account status, membership, and listing-management roles.
- `TaxonomyApi` for property types and country mappings.
- `MediaApi` and the existing R2 initialize/upload/complete lifecycle with purpose `PROPERTY`.
- `MessagingApi` with the `PROPERTY_LISTING` conversation context.
- `ModerationApi` and the shared `reports` workflow with target `PROPERTY_LISTING`.
- `BillingApi` for configured `PROPERTY_LISTING_PUBLISH` entitlement consumption.

The Expo mobile feature uses the shared authenticated API client, session, theme, navigation, Business Workspace capabilities, and media upload infrastructure. No consumer web UI, additional tab, or separate Business Workspace property entry point was added.

## Database and lifecycle

The v10.12 baseline owns property listings, addresses, media associations, saves, amenities, audiences, and discovery locations. Forward-only `V9__property_marketplace.sql` follows Messaging M4 V6, Jobs V7, and Business Directory V8 and additively provides:

- Terminal `CLOSED` status, `closed_at`, and the invariant that exactly one of `status = 'CLOSED'` or `closed_at IS NULL` is false.
- `PROPERTY` media purpose and `PROPERTY_LISTING` report target.
- Owner, discovery, room/price, and duplicate-open-report indexes.
- Canonical property types, country mappings, and amenities using idempotent seeds.

Supported listing purposes are `SALE` and `RENT`. Listings start as `DRAFT`.

- `DRAFT -> PUBLISHED`: requires a manager, valid complete content, and at least one attached READY image.
- `PUBLISHED -> PAUSED`: temporarily removes the listing from public discovery.
- `PAUSED -> PUBLISHED`: revalidates publishable content and starts a new 90-day expiry period.
- Non-removed listings can transition to `CLOSED`; closure is terminal and cannot be edited or reopened.
- Repeated publish, pause, close, save, unsave, and media-attach operations are idempotent where applicable.

Publication consumes the configured publishing entitlement atomically with idempotency key `PROPERTY_LISTING_PUBLISH:{propertyId}`. Repeated publication does not consume twice. `NOT_CONFIGURED` follows the approved non-blocking rollout behavior; an explicitly configured but insufficient entitlement returns HTTP 402. This is entitlement accounting only, not checkout or payment processing.

## Authorization and privacy

Every endpoint requires authentication. The server derives ownership from the principal; the client cannot supply an owner user ID.

- Personal listings are managed only by their owner.
- Business listings require an `ACTIVE` account and a live accepted membership with role `OWNER`, `ADMINISTRATOR`, or `LISTING_MANAGER`.
- Membership and account status are checked on every management mutation. Revoked or insufficient access therefore stops management without changing listing ownership.
- Public detail and discovery include only non-expired `PUBLISHED` listings allowed by `COUNTRY`, `COMMUNITY`, or `SELECTED_COMMUNITIES` audience policy.
- Managers can view their own non-public listings. Other viewers receive 404 for inaccessible content so its existence is not disclosed.

Public location DTOs contain only `city`, `region`, and the rounded approximate discovery coordinates. Street lines, postal code, formatted address, address ID, and exact coordinates remain private. Signed media URL generation repeats the property visibility check.

Contact fields are returned only when their corresponding visibility flags permit them. Enquiries use the shared messaging boundary and cannot be started by the personal owner or a member of the owning business account.

## REST API

All paths are under `/api/v1`. Page responses contain `items` and an optional opaque `nextCursor`; `size` defaults to 20 and is capped at 50.

| Method and path | Purpose |
| --- | --- |
| `GET /properties/types?countryId={uuid}` | Country-enabled property types |
| `GET /properties/amenities` | Amenity catalog |
| `POST /properties` | Create a draft; returns 201 |
| `PUT /properties/{propertyId}` | Replace editable draft/listing fields without transferring ownership |
| `GET /properties/{propertyId}` | Audience-aware property detail |
| `POST /properties/{propertyId}/publish` | Validate and publish a draft |
| `POST /properties/{propertyId}/pause` | Pause a published listing |
| `POST /properties/{propertyId}/reopen` | Republish a paused listing |
| `POST /properties/{propertyId}/close` | Terminally close a listing |
| `GET /properties` | Audience-aware discovery and structured search |
| `GET /me/properties` | Personal and authorized business listings; optional `status` and `businessAccountId` |
| `GET /me/properties/saved` | Currently visible saved listings |
| `PUT /properties/{propertyId}/save` | Idempotently save a visible published listing; returns 204 |
| `DELETE /properties/{propertyId}/save` | Idempotently remove a save; returns 204 |
| `POST /properties/{propertyId}/media/{mediaId}` | Attach an owned READY `PROPERTY` image |
| `PUT /properties/{propertyId}/media` | Reorder the complete attached-media set and select its cover |
| `DELETE /properties/{propertyId}/media/{mediaId}` | Remove an attached image and normalize cover/order |
| `GET /properties/{propertyId}/media/{mediaId}/download-url` | Visibility-checked signed image URL |
| `POST /properties/{propertyId}/enquiry` | Create or reuse the shared property conversation |
| `POST /properties/{propertyId}/report` | Submit a shared moderation report; returns 201 |

Discovery supports `countryId`, `communityId`, `propertyTypeId`, `listingPurpose`, `minPrice`, `maxPrice`, `minBedrooms`, `maxBedrooms`, `bathrooms`, `furnishedStatus`, `city`, `search`, `latitude`, `longitude`, `radiusKm`, `cursor`, and `size`.

Results use stable descending `(created_at, id)` ordering. Owner lists use `(updated_at, id)` and saved lists use save time and property ID. Radius search requires a complete valid coordinate/radius tuple and uses PostGIS `ST_DWithin` against `addresses.discovery_location`; exact address coordinates are never returned.

Errors follow the shared API conventions: 400 for validation, 401 for missing authentication, 403 for management/audience denial where appropriate, 404 for missing or private content, 409 for lifecycle conflicts, and 402 for a configured missing publish entitlement.

## JSONB attribute policy

Core searchable fields remain relational. `additionalAttributes` is limited to bounded, category-aware values rather than arbitrary nested JSON.

- Residential and fallback types: `energyRating`, `yearBuilt`, `floor`, `parkingSpaces`, `petsAllowed`, `smokingAllowed`, `reference`.
- Land: `plotUse`, `planningPermission`, `reference`.
- Commercial: `commercialUse`, `energyRating`, `yearBuilt`, `floor`, `parkingSpaces`, `reference`.

At most 30 keys are accepted. Keys must be lower camel case and at most 64 characters. Values may be scalars or arrays of at most 20 scalars; nested objects, nested arrays, nulls, binary/POJO values, and strings over 500 characters are rejected with `INVALID_PROPERTY_ATTRIBUTES`.

## Mobile flows

Expo Router routes under `/(app)/properties` provide:

- Discovery, keyword search, structured filters, clear/retry/refresh, nearby search, and cursor pagination.
- Detail gallery, approximate-location privacy text, save/unsave, contact methods, enquiry, and reporting.
- Grouped create/edit forms with personal/business ownership, audience selection, private exact address input, amenities, and JSONB preservation.
- Draft save, review, explicit publish, pause, reopen, and confirmed terminal close.
- R2 image upload, attach, reorder, cover selection, and removal.
- Owner listings by status and saved-property collections.

Location permission is requested only after the user explicitly selects nearby search. Denial leaves manual city and other filters intact. Business capability is revalidated before submission and enforced again by the backend. Publication is initiated only from the review/detail flow, not as a side effect of saving a draft.
