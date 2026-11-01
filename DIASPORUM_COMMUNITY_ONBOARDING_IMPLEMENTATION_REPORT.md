# DIASPORUM — Community Onboarding Implementation Report

Date: 2025-10-31  
Scope: Automatic community assignment during onboarding, per Diasporum v10.12

---

## 1. Initial repository assessment

### Backend (`diasporum-backend`)

| Component | Pre-existing | Assessment |
|---|---|---|
| `communities` table | ✅ | `UNIQUE(origin_country_id, destination_country_id)` already enforces pair uniqueness |
| `community_memberships` table | ✅ | `role`, `status`, `joined_at`, `left_at` — complete |
| `user_settings` table | ✅ | `default_community_id`, `active_community_id` columns exist |
| `trg_membership_origin_country` trigger | ✅ | Enforces `community.origin_country_id == profile.origin_country_id` on INSERT/UPDATE |
| `trg_user_settings_membership_integrity` | ✅ | Validates `default_community_id`/`active_community_id` reference ACTIVE memberships |
| `trg_bootstrap_profile_settings` | ✅ | Creates `user_settings` + `user_privacy_settings` rows on profile INSERT |
| `CommunityService.join()` | ✅ | Already idempotent; already enforces origin-country match |
| `CommunityService.setActiveCommunity()` | ✅ | Already validates ACTIVE membership before persisting |
| `CommunityService.availableCommunities()` | ✅ | Already returns only same-origin communities |
| `TaxonomyApi.findCommunityByPair()` | ❌ Missing | Added — exact `(origin,destination)` lookup |
| `IdentityApi.setDefaultCommunity()` | ❌ Missing | Added — upsert into `user_settings.default_community_id` |
| `GET /me/community-preview` | ❌ Missing | Added — read-only, no side effects |
| `POST /me/onboarding/complete` | ❌ Missing | Added — transactional membership + defaults creation |
| `ProfileService.updateProfile()` upsert | ❌ Missing | Added — `INSERT … ON CONFLICT DO NOTHING` so first PATCH creates the row |
| Flyway V3 NOT NULL relaxation | ❌ Missing | Added — `display_name`, `origin_country_id`, `current_country_id` now nullable until complete |

### Mobile (`diasporum-mobile`)

| Component | Pre-existing | Assessment |
|---|---|---|
| `OnboardingStep` | `communities` + `active-community` | Replaced with `community-preview` |
| `ONBOARDING_STEPS` | 8 steps | Reduced to 7 steps (preview is informational, not a data step) |
| `communities.tsx` (onboarding) | Manual browse-and-join | Removed — violates spec rule "must not be asked to browse and select" |
| `active-community.tsx` (onboarding) | Manual active-community picker | Removed — auto-assigned |
| `community-preview.tsx` | ❌ Missing | Created — shows auto-assigned community + flags |
| `community-api.communityPreview()` | ❌ Missing | Added |
| `community-api.completeOnboarding()` | ❌ Missing | Added |
| `session-provider.completeOnboarding` | ❌ Missing | Added |
| `resolveOnboardingStep` | Manual-step routing | Updated — `community-preview` is the last non-main step |

---

## 2. New onboarding flow

```
welcome → country-origin → country-current → community-preview → profile → languages → main-app
```

| Step | Screen | Action |
|---|---|---|
| welcome | `welcome.tsx` | Welcome CTA → `country-origin` |
| country-origin | `country-origin.tsx` | Select origin country → PATCH profile → `country-current` |
| country-current | `country-current.tsx` | Select current country → PATCH profile → `community-preview` |
| **community-preview** | `community-preview.tsx` | Shows auto-assigned community card → `profile` |
| profile | `profile.tsx` | Name, username, bio, city → `languages` |
| languages | `languages.tsx` | Preferred language → `completeOnboarding` → `main-app` |
| main-app | `(app)/(tabs)` | App entry |

`community-preview` is purely informational — it calls `GET /me/community-preview` and renders the result. It never creates membership.

---

## 3. Community preview screen design

**Screen:** `src/app/(onboarding)/community-preview.tsx`

Layout:

- `OnboardingHeader` with back button + segmented progress bar (step 4 of 7)
- Hero icon badge (`🏠`) + title "Your Diasporum community"
- Subtitle: "Based on your country of origin and where you currently live, you'll automatically join this community."
- **Community card** (bordered, brand-coloured):
  - Flag row: `[origin flag] ──→── [destination flag]` with country names beneath
  - Divider
  - Community name (20 px bold)
  - Community description
  - "Auto-assigned" badge (primary-surface background)
- Explanation text: "This will be your default community… You can join other {demonym} communities in different countries and switch between them anytime."
- CTA button: `Start using Diasporum` (profile complete) or `Continue` (mid-flow resume)

Dynamic content — no hardcoded names, flags or demonyms.

**Edge cases handled:**

| Case | Behaviour |
|---|---|
| Community not found (404) | "No community found for your country combination." + Retry |
| Countries not set (422) | "Please go back and select them." + Retry |
| `completeOnboarding` fails | Inline error above button, retry allowed |
| Origin == current country | Works — community pair (X,X) is looked up; seed data may need a matching community |

---

## 4. Backend changes

### `TaxonomyApi` / `TaxonomyApiImpl` / `TaxonomyService`

Added `findCommunityByPair(UUID originCountryId, UUID destinationCountryId)`:

```java
Optional<CommunityView> findCommunityByPair(UUID originCountryId, UUID destinationCountryId);
```

Implementation — single indexed lookup on `(origin_country_id, destination_country_id)`:

```java
public Optional<CommunityView> communityByPair(UUID originCountryId, UUID destinationCountryId) {
    return jdbc.query("SELECT id,name,slug,origin_country_id,destination_country_id,"
            + " description,is_active FROM communities"
            + " WHERE origin_country_id=? AND destination_country_id=?",
            (rs, i) -> community(rs), originCountryId, destinationCountryId)
            .stream().findFirst();
}
```

### `IdentityApi` / `IdentityApiImpl`

Added `setDefaultCommunity(UUID profileId, UUID communityId)` — upsert into `user_settings`:

```java
void setDefaultCommunity(UUID profileId, UUID communityId);
```

```java
jdbc.update("INSERT INTO user_settings(user_id,default_community_id,updated_at)"
        + " VALUES(?,?,now()) ON CONFLICT(user_id)"
        + " DO UPDATE SET default_community_id=?, updated_at=now()",
        profileId, communityId, communityId);
```

### `ProfileService`

Added upsert at top of `updateProfile` so new users don't hit `404 PROFILE_NOT_FOUND` on their first PATCH:

```java
jdbc.update("INSERT INTO profiles(id) VALUES(?) ON CONFLICT(id) DO NOTHING", profileId);
```

### `CommunityService`

Added two methods:

```java
/** Read-only preview — returns the matching community + country details. */
public CommunityPreviewResult communityPreview(UUID userId)

/** Transactional completion — membership + defaults + active community. Idempotent. */
@Transactional
public OnboardingResult completeOnboarding(UUID userId)
```

`completeOnboarding` sequence (single transaction):
1. `requireUser(userId)` → loads `ProfileSummary` (origin + current countries)
2. `previewFor(p)` → `taxonomy.findCommunityByPair` → 404/`COMMUNITY_INACTIVE` if missing/inactive
3. `join(userId, community.id())` → idempotent membership (`MEMBER`/`ACTIVE`)
4. `identity.setDefaultCommunity(userId, community.id())` → upserts `user_settings.default_community_id`
5. `identity.setActiveCommunity(userId, community.id())` → sets `active_community_id`

New records:

```java
public record CommunityPreviewResult(CommunityView community,
        CountryView originCountry, CountryView destinationCountry) {}

public record OnboardingResult(MembershipView membership, CommunityView community) {}
```

### `CommunityController`

Two new endpoints:

```
GET  /api/v1/me/community-preview
POST /api/v1/me/onboarding/complete
```

Both resolve `principal.userId()` — no client-supplied IDs accepted.

---

## 5. Database changes

### Flyway V3 — `V3__relax_profile_not_null_for_onboarding.sql`

```sql
ALTER TABLE profiles ALTER COLUMN display_name      DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN origin_country_id  DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN current_country_id DROP NOT NULL;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_display_name_check;
ALTER TABLE profiles ADD  CONSTRAINT profiles_display_name_check
    CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 80);
```

Completion is still enforced by `refreshCompletion` — `profile_completed_at` is stamped only when `display_name`, `username`, `origin_country_id` and `current_country_id` are all non-null.

---

## 6. Eligibility enforcement summary

| Rule | Layer | Mechanism |
|---|---|---|
| Same-origin join only | Backend service | `join()` throws `COMMUNITY_ORIGIN_MISMATCH` |
| Same-origin join only | DB trigger | `trg_membership_origin_country` — safety net |
| Auto-assigned community exists | Service | `findCommunityByPair` → 404/`COMMUNITY_INACTIVE` |
| Active community must be member | Service | `setActiveCommunity()` throws `NOT_A_MEMBER` |
| Default/active must be valid membership | DB trigger | `trg_user_settings_membership_integrity` |
| No client-side trust | Controller | `principal.userId()` only — never reads user IDs from body |

---

## 7. Mobile changes

### `session-types.ts`

```typescript
// Removed: 'communities', 'active-community'
// Added:   'community-preview'

export type OnboardingStep =
  | 'welcome' | 'country-origin' | 'country-current'
  | 'community-preview' | 'profile' | 'languages' | 'main-app';
```

`resolveOnboardingStep` updated — `community-preview` is the destination when `memberships.length === 0 || !activeCommunityId`:

```typescript
if (state.memberships.length === 0 || !state.activeCommunityId) {
    return 'community-preview';
}
return 'main-app';
```

### `community-api.ts`

```typescript
communityPreview()      // GET  /api/v1/me/community-preview
completeOnboarding()    // POST /api/v1/me/onboarding/complete
```

New types added to `community-types.ts`: `CommunityPreviewResponse`, `OnboardingCompleteResponse`.

### `session-provider.tsx`

```typescript
const completeOnboarding = useCallback(async () => {
    await communityApi.completeOnboarding();
    await refresh();
}, [communityApi, refresh]);
```

### `use-onboarding.ts`

`STEP_ROUTES` updated. `completeOnboarding` added to the returned hook object.

### `country-current.tsx`

Now navigates to `/(onboarding)/community-preview` (was `/(onboarding)/profile`).

### `languages.tsx`

Still navigates to `community-preview` — the preview screen then calls `POST /me/onboarding/complete` when `profileCompleted` is `true`.

### Deleted files

- `src/app/(onboarding)/communities.tsx` — manual browse screen removed
- `src/app/(onboarding)/active-community.tsx` — manual picker removed

### Updated test

`session-resolver.test.ts` — expectations updated from `'communities'`/`'active-community'` to `'community-preview'`. **10 tests, all passing.**

---

## 8. Communities tab (`(app)/(tabs)/communities.tsx`)

The main-app Communities tab is **unchanged** — it already handles:
- Viewing joined communities
- Switching active community (with backend membership validation)
- Discovering + joining additional communities (server-side origin filter)

The only flow change is that users now arrive with a membership already set, so the tab shows their default community instead of the empty "join one first" state.

---

## 9. Testing

| Test | Status |
|---|---|
| `session-resolver.test.ts` — 10 unit tests | ✅ Pass |
| `mvnw compile` — backend | ✅ Clean |
| `tsc --noEmit` — mobile | ✅ Clean |
| `expo lint` — mobile | ✅ Clean (pre-existing warnings only) |

---

## 10. Remaining decisions / gaps

| Item | Decision needed |
|---|---|
| Same-country pair (origin == current) | Seed a matching community (e.g., `ET→ET`) or show "no community" — currently shows error |
| `community-preview` in `ONBOARDING_STEPS` at index 3 | On resume after `languages`, progress bar shows step 4/6 — acceptable but worth reviewing |
| Current-country change post-onboarding | Not implemented — spec says "inspect rules before implementing"; no auto-migration policy defined |
| `ONBOARDING_STEPS` ordering | `community-preview` sits at index 3 (after `country-current`, before `profile`) matching spec ordering |
