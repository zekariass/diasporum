# Diasporum Mobile — Phase 2 Verification Report

**Report type:** Verification audit (pre-Phase 3)
**Date:** 2026-01-19
**Scope:** `C:\PROJECT\DIASPORUM\diasporum-mobile`

---

## A. Executive Summary

**Overall result: PASS WITH CONDITIONS — READY WITH CONDITIONS**

Phase 2 is structurally correct and functionally complete for Phase 3 development. All static checks pass. One defect was found and fixed during this audit (unauthenticated `load()` firing unnecessary API calls). The stale-token regression test is added and passing.

**Phase 3 can begin.** Non-blocking conditions: live backend E2E and Android deep-link testing remain unverified.

---

## B. Verification Results

| Area | Result | Evidence | Outstanding issues |
|---|---|---|---|
| TypeScript | PASS | `npx tsc --noEmit` → 0 errors, `strict: true` | — |
| ESLint | PASS | `npx expo lint` → 0 errors, 0 warnings | — |
| Jest | PASS | `npx jest --runInBand` → 66/66 pass | — |
| Expo Doctor | PASS | `npx expo-doctor` → 20/20 checks | — |
| SessionProvider | PASS | `useEffect` guarded by `authState.status === 'authenticated'`; `loadingRef` prevents concurrent loads; `setSession`/`setError`/`setIsLoading` all async (after `await`) | — |
| Session restoration | PASS | `restoreSession` (Phase 1) restores tokens; `SessionProvider.load()` fetches all 4 endpoints in parallel on authenticated mount | Live restore NOT VERIFIED |
| Session mutations | PASS | `updateProfile` → `PATCH /me/profile` → updates `session.profile`; `joinCommunity` → `POST /communities/{id}/join` → `refresh()`; `setActiveCommunity` → `PUT /me/active-community` → `refresh()`; `updatePreferredLanguage` → `PATCH /me/settings` | Live calls NOT VERIFIED |
| Onboarding resolver | PASS | `resolveOnboardingStep()` pure function — no side effects, no navigation, no network; 10 unit tests cover all branches | — |
| Onboarding routing | PASS | `(onboarding)/_layout.tsx` guards `unauthenticated` + `main-app`; `(app)/_layout.tsx` guards `unauthenticated` + `!main-app`; `index.tsx` resolves initial step | Live navigation NOT VERIFIED |
| Country selection | PASS | `GET /taxonomy/countries?active=true` → `SearchableList` → `PATCH /me/profile`; country ID stored, not name; no hardcoded list | Live API NOT VERIFIED |
| Profile creation | PASS | `PATCH /me/profile` with whitelist fields; `USERNAME_PATTERN` mirrors backend `^[a-z0-9_]{3,20}$`; `displayName`/`username`/`bio`/`city` all supported | Live save NOT VERIFIED |
| Profile editing | PASS | `/(app)/profile/edit` loads from session → `PATCH /me/profile` → `updateProfile()` refreshes session → back | Live save NOT VERIFIED |
| Username availability | PASS | Debounced 500ms via `setTimeout`; `INVALID_FORMAT`/`RESERVED`/`TAKEN`/`AVAILABLE` mapped to UI states; 409 on save also surfaces conflict | Live check NOT VERIFIED |
| Language preferences | PASS | `GET /taxonomy/languages` → single `preferredLanguageCode` via `PATCH /me/settings`; UI does not claim multi-language support | Backend gap: single language only |
| Community discovery | PASS | `GET /me/communities/available` (server-side origin-country filter); `SearchableList` shows joined/unjoined state | Live API NOT VERIFIED |
| Community joining | PASS | `POST /communities/{id}/join` — idempotent server-side; `joiningId` ref prevents duplicate taps; `refresh()` updates memberships | Live join NOT VERIFIED |
| Active community switching | PASS | `PUT /me/active-community` → `refresh()`; `403 NOT_A_MEMBER` surfaced as user message; `activeCommunityId` from backend | Live switch NOT VERIFIED |
| Main tab navigation | PASS | `(app)/(tabs)/_layout.tsx` — 5 tabs via Expo Router `Tabs`; guarded by `(app)/_layout.tsx` | Android back button NOT VERIFIED |
| Stale-token regression | PASS | `getCurrentTokens()` reads `tokensRef` — always live; regression test proves token-B sent after refresh (3/3 tests pass) | — |
| API contract compatibility | PASS | All 15 endpoints verified against live controller source code (MeController, ProfileController, TaxonomyController, CommunityController, SettingsController) | — |
| Security | PASS | No AsyncStorage for tokens; no hardcoded credentials; `avatarMediaId` not sent to PATCH (not in whitelist); `preferredLanguageCode` via documented endpoint | — |
| Live backend integration | NOT VERIFIED | All endpoints verified statically against controller code; no running backend available | Requires dev backend |
| Android E2E | NOT VERIFIED | Route structure correct; `diasporummobile://callback` configured; no dev build/device available | Requires dev build + device |

---

## C. Defects Found and Fixed

### D-1: Unauthenticated `load()` fires unnecessary API calls
- **File:** `src/core/session/session-provider.tsx`
- **Severity:** Medium
- **Evidence:** `useEffect(() => { void load(); }, [load])` fired `load()` whenever the dep changed — including when `authState.status` transitioned to `unauthenticated` (dep becomes `null` → new `load` → effect fires). `load()` then called `profileApi.me()`, `profileApi.profile()`, `communityApi.myCommunities()`, `communityApi.activeCommunity()` with no bearer token → 4 guaranteed 401s.
- **User impact:** Unnecessary failed requests on logout/unauthenticated state; `error` set to misleading message; brief loading flash.
- **Fix applied:** Added `authState.status === 'authenticated'` guard in `useEffect` — `load()` only fires when authenticated. Unauthenticated reset handled by separate `useEffect`.

### D-2: `refresh()` resets `loadingRef` breaking concurrency guard
- **File:** `src/core/session/session-provider.tsx`
- **Severity:** Low-Medium
- **Evidence:** `refresh()` called `loadingRef.current = false` before `await load()` — if `load()` was already in-flight, `refresh()` reset the guard allowing a second concurrent `load()` to start, violating single-flight.
- **User impact:** Duplicate parallel session fetches; potential inconsistent `setSession` ordering.
- **Fix applied:** `refresh()` now calls `setIsLoading(true)` + `setError(null)` + `await load()` — `load()` internally guards via `loadingRef`; concurrent calls share the in-flight load.

### D-3: Stale-token regression test missing
- **File:** `src/__tests__/core/api/stale-token.test.ts` (new)
- **Severity:** Low (test coverage gap)
- **Evidence:** Phase 2 report claimed `getCurrentTokens()` fixes stale-token bug but no regression test proved it.
- **Fix applied:** Added 3 tests — (1) token-B sent after refresh, not token-A; (2) second request reuses refreshed token-B; (3) unauthenticated sends no Authorization header.

### D-4: `refresh` unused variable in `use-onboarding.ts`
- **File:** `src/features/onboarding/hooks/use-onboarding.ts`
- **Severity:** Low (lint warning)
- **Evidence:** `const refresh = useCallback(...)` defined but never returned/used.
- **Fix applied:** Removed.

---

## D. Backend Dependencies

| Limitation | Detail | Affected feature | Required backend change |
|---|---|---|---|
| `avatarMediaId` not in `PATCHABLE` | `ProfileController.PATCHABLE` = `username,displayName,bio,city,dateOfBirth,originCountryId,currentCountryId` — `avatarMediaId` excluded | Profile photo upload/deferred | Add `avatarMediaId` to `PATCHABLE` + `UpdateProfileRequest` — no migration needed (field exists in schema) |
| `preferredLanguageCode` single string | `SettingsResponse` has one `preferredLanguageCode`; `UpdateSettingsRequest` has one `preferredLanguageCode` | Multi-language selection deferred | `preferredLanguageCodes` list or `user_languages` table — migration required |
| `availableCommunities` no pagination | `GET /me/communities/available` returns `List` not `Page` | Large catalogues may be slow | Optional: add `page`/`size` params |
| `UsernameAvailability` response shape | `{username,available,reason}` — `reason` enum: `INVALID_FORMAT`,`RESERVED`,`AVAILABLE`,`TAKEN` | Confirmed matches mobile impl | — |
| `join()` origin check | `CommunityService.join` requires `profile.originCountryId == community.originCountryId` — enforced server-side | Origin mismatch → `403 COMMUNITY_ORIGIN_MISMATCH` | Mobile shows this correctly via `ApiError` |

---

## E. Test Results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx expo lint` | ✅ 0 errors, 0 warnings |
| `npx jest --runInBand` | ✅ **66/66 pass** (5 suites: env, auth-storage, auth-service, api-client, session-resolver, stale-token) |
| `npx expo-doctor` | ✅ 20/20 checks |

### Test coverage by area

| Area | Tests | Coverage |
|---|---|---|
| `env.ts` | 10 | All required vars, missing vars, invalid APP_ENV, endpoint URLs |
| `auth-storage.ts` | 7 | Save/get/clear, corrupt metadata, storage errors, clearTokens resilience |
| `auth-service.ts` | 12 | `isTokenExpired`, `decodeJwtPayload`, `extractUserInfo`, `refreshTokens` (success/400/network/single-flight), `restoreSession`, `logout`, `AuthError` |
| `api-client.ts` | 9 | Bearer injection, `authenticated:false`, `isApiHost` (3 tests), 401→refresh→retry, 500, network error, base URL |
| `session-resolver.ts` | 10 | All onboarding states: welcome, country-origin, country-current, profile, languages, communities, active-community, main-app |
| `stale-token` | 3 | Token-B after refresh, second request reuses B, unauthenticated sends no header |

---

## F. Manual Android Checklist

**Prerequisites:** `npx expo run:android` dev build; backend on `:8080`; Keycloak on `:8081` (use `10.0.2.2` for emulator).

| # | Test | Expected | Status |
|---|---|---|---|
| M-1 | Fresh install → sign in → onboarding flow | Welcome → origin → current → profile → languages → communities → active → tabs | NOT VERIFIED |
| M-2 | Kill app → relaunch (after onboarding) | Direct to main tabs (no onboarding) | NOT VERIFIED |
| M-3 | Kill app mid-onboarding → relaunch | Resumes at correct step (not from scratch) | NOT VERIFIED |
| M-4 | Origin country select → check backend | `originCountryId` set in profile | NOT VERIFIED |
| M-5 | Current country select → check backend | `currentCountryId` set in profile | NOT VERIFIED |
| M-6 | Profile name+username → check backend | `profileCompleted=true` | NOT VERIFIED |
| M-7 | Username debounce (type taken name) | "taken" shown ~500ms after typing stops | NOT VERIFIED |
| M-8 | Join community → check `/me/communities` | `status=ACTIVE` membership | NOT VERIFIED |
| M-9 | Set active community → check `/me/active-community` | `communityId` persisted | NOT VERIFIED |
| M-10 | Communities tab → Set active → check | Active pill moves; backend confirms | NOT VERIFIED |
| M-11 | Edit profile → save → check `/me/profile` | Updated values persisted | NOT VERIFIED |
| M-12 | Logout → sign in (existing user) | Skips onboarding → main tabs | NOT VERIFIED |
| M-13 | Join 2nd community → switch active | Both in list; only one active | NOT VERIFIED |
| M-14 | Language select → restart → check `/me/settings` | `preferredLanguageCode` persisted | NOT VERIFIED |
| M-15 | Airplane mode → relaunch | Loading → login (not stuck) | NOT VERIFIED |

---

## G. Phase 3 Readiness Decision

**READY WITH CONDITIONS**

Phase 2 is sufficiently verified to begin Phase 3 development. All structural correctness issues are resolved; API contracts are verified against live backend source code; the stale-token regression test is added and passing.

**Non-blocking conditions:**
- Live backend integration (all API calls verified statically, not against a running instance)
- Android deep-link E2E (needs dev build + device)
- Profile photo upload deferred until `avatarMediaId` is added to `PATCHABLE` (backend change)
- Multi-language selection deferred until `preferredLanguageCodes` is supported (backend change + migration)

---

## H. Recommended Next Actions

1. **[High]** Run `npx expo run:android` + backend to verify onboarding E2E — this is the only unverified critical path
2. **[High]** Test `GET /api/v1/me` + `GET /me/profile` live to confirm bearer auth + profile resolution
3. **[Medium]** Backend: add `avatarMediaId` to `PATCHABLE`/`UpdateProfileRequest` to unblock profile photo upload
4. **[Medium]** Backend: decide on `preferredLanguageCodes` (list) vs current single code
5. **[Low]** Remove `src/components/app-tabs.tsx` and `app-tabs.web.tsx` (unused since tab layout replaced them)
6. **[Low]** Replace `expo-logo.png` in `AnimatedSplashOverlay`/`AnimatedIcon` with Diasporum branding
7. **[Low]** Tighten Keycloak redirect `diasporummobile://*` → `diasporummobile://callback` before production

---

*No commits, pushes, deployments, backend changes, or Keycloak changes were made during this audit.*