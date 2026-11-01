# Diasporum Mobile — Phase 2 Implementation Report

**Phase:** Onboarding, Identity and User Profile  
**Status:** COMPLETE WITH CONDITIONS  
**Date:** 2026-01-19  
**Repo:** `C:\PROJECT\DIASPORUM\diasporum-mobile`

---

## 1. Executive Summary

Phase 2 delivers the complete authenticated user journey: post-login onboarding resolution, a 7-step onboarding flow (welcome → origin country → current country → profile → languages → communities → active community), and a 5-tab main application shell with a functional profile screen and edit-profile flow.

The Phase 1 authentication infrastructure is preserved unchanged. The new `SessionProvider` wraps `AuthProvider` and loads the full backend session state (`me`, `profile`, `memberships`, `activeCommunityId`) after authentication succeeds. A single `resolveOnboardingStep()` function is the authoritative routing decision — no scattered onboarding logic.

**Status: COMPLETE WITH CONDITIONS** — all code is implemented and verified statically. Live backend integration and Android deep-link testing remain unverified due to unavailable runtime environments.

---

## 2. Implemented Features

| Feature | Status | Backend endpoint used |
|---|---|---|
| Post-auth session resolution | ✅ | `GET /me`, `GET /me/profile`, `GET /me/communities`, `GET /me/active-community` |
| Onboarding step resolver | ✅ | Derived from session state |
| Welcome screen | ✅ | None |
| Country of origin selection | ✅ | `GET /taxonomy/countries`, `PATCH /me/profile` |
| Current country selection | ✅ | `GET /taxonomy/countries`, `PATCH /me/profile` |
| Profile info (name, username, bio, city) | ✅ | `PATCH /me/profile`, `GET /usernames/availability` |
| Username availability check (debounced) | ✅ | `GET /usernames/availability?username=` |
| Language preference | ✅ | `GET /taxonomy/languages`, `PATCH /me/settings` |
| Community discovery + join | ✅ | `GET /me/communities/available`, `POST /communities/{id}/join` |
| Active community selection | ✅ | `PUT /me/active-community`, `GET /me/active-community` |
| 5-tab bottom navigation | ✅ | — |
| Profile tab (view) | ✅ | `GET /me/profile` (via session) |
| Edit profile screen | ✅ | `PATCH /me/profile` |
| Community tab (switch active) | ✅ | `PUT /me/active-community`, `GET /me/communities/available` |

---

## 3. Backend API Integration

### Endpoints consumed (all verified against live controller code)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/me` | Profile ID + `profileCompleted` |
| GET | `/api/v1/me/profile` | Full profile (all fields) |
| PATCH | `/api/v1/me/profile` | Update whitelist fields |
| GET | `/api/v1/me/profile/completion` | Completion status + missing fields |
| GET | `/api/v1/usernames/availability` | Debounced username check |
| GET | `/api/v1/me/settings` | `preferredLanguageCode` |
| PATCH | `/api/v1/me/settings` | Save `preferredLanguageCode` |
| GET | `/api/v1/taxonomy/countries` | Country catalogue (paginated) |
| GET | `/api/v1/taxonomy/languages` | Language catalogue (paginated) |
| GET | `/api/v1/taxonomy/communities` | Community catalogue (paginated) |
| GET | `/api/v1/me/communities` | User's ACTIVE memberships |
| GET | `/api/v1/me/communities/available` | Eligible communities (filtered by origin country) |
| POST | `/api/v1/communities/{id}/join` | Join (idempotent) |
| GET | `/api/v1/me/active-community` | Current active community |
| PUT | `/api/v1/me/active-community` | Set active community |

### Backend gaps (documented, not worked around)

| Gap | Impact | Required backend change |
|---|---|---|
| `avatarMediaId` not in `PATCHABLE` profile fields | Profile photo cannot be associated with profile | Add `avatarMediaId` to `ProfileController.PATCHABLE` and `UpdateProfileRequest` — no migration needed (field already exists in schema) |
| `preferredLanguageCode` is a single string | Multi-language selection not supported | Backend change needed: `preferredLanguageCodes` list or `user_languages` table — migration required |
| `availableCommunities` returns `List` not paged | Large catalogues may be slow | Optional: add pagination to `GET /me/communities/available` |

---

## 4. Architecture and State Management

### Session state flow

```
AuthProvider (Phase 1)
  └── SessionProvider (Phase 2)
        ├── loads: GET /me + GET /me/profile + GET /me/communities + GET /me/active-community
        ├── exposes: session, apiClient, onboardingStep, refresh(), updateProfile(),
        │            joinCommunity(), setActiveCommunity(), updatePreferredLanguage()
        └── resolveOnboardingStep(session, welcomeSeen) → OnboardingStep
```

### Navigation structure

```
src/app/
├── _layout.tsx              # AuthProvider > SessionProvider > Stack
├── index.tsx                # AuthState + SessionState → correct route
├── (auth)/
│   ├── _layout.tsx          # authenticated → /(app)/(tabs)
│   └── login.tsx
├── (onboarding)/
│   ├── _layout.tsx          # unauthenticated → login; onboarded → /(app)/(tabs)
│   ├── welcome.tsx
│   ├── country-origin.tsx
│   ├── country-current.tsx
│   ├── profile.tsx
│   ├── languages.tsx
│   ├── communities.tsx
│   └── active-community.tsx
└── (app)/
    ├── _layout.tsx          # unauthenticated → login; not onboarded → /(onboarding)/{step}
    ├── (tabs)/
    │   ├── _layout.tsx      # 5 bottom tabs
    │   ├── index.tsx        # Home
    │   ├── reels.tsx        # Reels placeholder
    │   ├── communities.tsx  # Community tab (functional)
    │   ├── explore.tsx      # Explore placeholder
    │   └── profile.tsx      # Profile (functional)
    └── profile/
        └── edit.tsx         # Edit profile
```

### Key design decisions

| Decision | Rationale |
|---|---|
| `SessionProvider` wraps `AuthProvider` | Session loading only makes sense when authenticated; keeps Phase 1 auth untouched |
| `resolveOnboardingStep()` as pure function | Single source of truth for routing; unit-testable without React |
| `apiClient` exposed via `SessionContext` | Avoids recreating API clients per hook call; token-fresh via `getCurrentTokens()` |
| `getCurrentTokens()` added to `AuthContextValue` | Fixes stale-token bug: `authState` snapshot could be old after refresh; `tokensRef` is always live |
| `welcomeSeen` in SessionProvider state | Prevents welcome screen re-showing on session refresh; resets on logout |
| Explicit step navigation in screens | `advance(step)` is unambiguous vs. reactive navigation from resolver changes |
| `loadingRef` concurrency guard in SessionProvider | Prevents duplicate parallel session loads on rapid re-renders |

---

## 5. Files Created

| Path | Purpose |
|---|---|
| `src/core/session/session-types.ts` | `OnboardingStep`, `SessionState`, `resolveOnboardingStep()` |
| `src/core/session/session-provider.tsx` | Session loading, state, API client, resolver |
| `src/features/onboarding/services/taxonomy-api.ts` | Countries, languages, communities catalogue |
| `src/features/onboarding/hooks/use-onboarding.ts` | Step navigation + session helpers |
| `src/features/profile/types/profile-types.ts` | `MeResponse`, `ProfileResponse`, `UpdateProfileRequest`, etc. |
| `src/features/profile/services/profile-api.ts` | Identity endpoints |
| `src/features/communities/types/community-types.ts` | `MembershipView`, `CommunityView`, `CountryView`, `LanguageView` |
| `src/features/communities/services/community-api.ts` | Community endpoints |
| `src/shared/components/primary-button.tsx` | Reusable branded button |
| `src/shared/components/onboarding-progress.tsx` | Step dot-bar indicator |
| `src/shared/components/error-state.tsx` | Error + retry layout |
| `src/shared/components/searchable-list.tsx` | Generic searchable picker |
| `src/shared/components/form-input.tsx` | Label + input + error field |
| `src/app/(onboarding)/*.tsx` | 7 onboarding screens + layout |
| `src/app/(app)/(tabs)/*.tsx` | 5 tab screens + tab layout |
| `src/app/(app)/profile/edit.tsx` | Edit profile screen |
| `src/__tests__/core/session/session-resolver.test.ts` | Resolver unit tests (10 cases) |

## 6. Files Modified

| Path | Change |
|---|---|
| `src/core/auth/auth-provider.tsx` | Added `getCurrentTokens()` to `AuthContextValue`; `getValidAccessToken()` now uses live ref |
| `src/core/api/api-client.ts` | `executeRequest` uses `getCurrentTokens()` instead of stale `authState.tokens` snapshot |
| `src/app/_layout.tsx` | Added `SessionProvider` wrapper |
| `src/app/index.tsx` | Now resolves onboarding step for authenticated users |
| `src/app/(app)/_layout.tsx` | Guards on `onboardingStep !== 'main-app'` |
| `src/app/(app)/home.tsx` | Deleted — replaced by `(tabs)/index.tsx` |
| `src/app/(app)/explore.tsx` | Deleted — replaced by `(tabs)/explore.tsx` |

---

## 7. Verification Results

| Check | Command | Result |
|---|---|---|
| TypeScript strict | `npx tsc --noEmit` | ✅ 0 errors |
| ESLint | `npx expo lint` | ✅ 0 errors, 0 warnings |
| Unit tests | `npx jest --no-coverage` | ✅ 63/63 pass |
| Expo Doctor | `npx expo-doctor` | ✅ 20/20 checks (unchanged) |
| Live backend `/api/v1/me` | Manual | ❌ NOT VERIFIED — no running backend |
| Android deep-link E2E | Manual | ❌ NOT VERIFIED — no dev build/device |
| Onboarding flow E2E | Manual | ❌ NOT VERIFIED — no device/backend |

### Bug fixed during Phase 2

**Stale access token in API client:** `executeRequest` read `authState.tokens` from the context snapshot. After a token refresh, the snapshot was stale and the old (expired) token was sent. Fixed by adding `getCurrentTokens()` to `AuthContextValue` (reads `tokensRef` — always live) and using it in `executeRequest` and `getValidAccessToken`.

---

## 8. Manual Android Test Checklist

**Prerequisites:** `npx expo run:android` dev build; backend on `:8080`; Keycloak on `:8081` (`10.0.2.2` for emulator).

| # | Test | Steps | Expected |
|---|---|---|---|
| M-1 | New user onboarding | Register Keycloak user → sign in → complete all steps | Welcome → origin → current → profile → languages → communities → active → main app |
| M-2 | Session restore | Kill app after onboarding → relaunch | Directly to main app tabs (no onboarding re-entry) |
| M-3 | Partial restart | Kill app after origin country → relaunch | Resumes at country-current (not from scratch) |
| M-4 | Profile completion | Enter name+username → check `/me/profile` | `profileCompleted=true` on backend |
| M-5 | Username availability | Type taken username | "taken" shown after ~500ms debounce |
| M-6 | Join community | Tap Join → check `/me/communities` | MembershipView with `status=ACTIVE` |
| M-7 | Set active community | Select → `PUT /me/active-community` → check | `communityId` persisted |
| M-8 | Switch community | Communities tab → Set active | Active pill moves; `GET /me/active-community` confirms |
| M-9 | Edit profile | Profile tab → Edit → save → back | Updated values shown; `GET /me/profile` confirms |
| M-10 | Logout → login → onboarded | Sign out → sign in | Skips onboarding → main app directly |
| M-11 | Second community | Join another → switch active | Both in list; only one active |
| M-12 | Skip communities | Skip join → reach active-community | Empty state + "go back" prompt |

---

## 9. Security Notes

- No `AsyncStorage` for tokens — `expo-secure-store` only (unchanged from Phase 1)
- `avatarMediaId` field exists in `ProfileResponse` but is read-only from mobile — no invented contract
- `username` normalized client-side (`toLowerCase().trim()`) before `PATCH` — mirrors backend `normalize()`
- `joinCommunity` is idempotent server-side — duplicate taps guarded client-side via `joiningId` ref
- `setActiveCommunity` 403 (`NOT_A_MEMBER`) surfaced as a user-safe message
- `preferredLanguageCode` saved via `PATCH /me/settings` — no invented endpoint
- No credentials, tokens, or secrets in any file

---

## 10. Known Issues and Limitations

| Issue | Severity | Notes |
|---|---|---|
| Profile photo upload | Deferred | `avatarMediaId` not patchable — backend gap; `AVATAR` media purpose exists and upload works but cannot be linked to profile |
| Multi-language selection | Deferred | `preferredLanguageCode` is single string — backend gap |
| `availableCommunities` no pagination | Low | Returns full list; fine for current catalogue size |
| Emoji tab icons | Low | Placeholder; replace with vector/SF Symbols in Phase 3 |
| `AnimatedSplashOverlay` Expo logo | Low | Cosmetic; replace with Diasporum assets |
| `app-tabs.tsx`/`app-tabs.web.tsx` unused | Low | Dead code from Phase 1 starter — remove in cleanup |
| Old `app/(app)/explore.tsx` moved to `(tabs)` | Resolved | Now placeholder-only, inside tab group |

---

## 11. Recommended Next Phase

**Phase 3 — Feed and Community Content**

1. Implement `GET /api/v1/me/feed` (or Feed API) in `src/features/home/`
2. Replace `(tabs)/index.tsx` placeholder with real feed
3. Add `CommunityView` detail screen (`/(app)/communities/[id].tsx`)
4. Wire `AVATAR` upload once `avatarMediaId` is added to `PATCHABLE` (backend)
5. Add `preferredLanguageCodes` multi-select once backend supports it
6. Replace emoji tab icons with vector icons
7. Tighten Keycloak redirect URI before production

---

## 12. Status Confirmation

- **No commits, pushes, or deployments were made**
- **No backend or Keycloak configuration was modified**
- **No Phase 2 out-of-scope features were implemented** (no feed, reels, messaging, notifications, marketplace, etc.)
- **Phase 1 authentication infrastructure is preserved unchanged**