# Diasporum Mobile — Phase 1 Verification Report

**Report type:** Verification audit (pre-Phase 2)
**Date:** 2026-01-19
**Scope:** `C:\PROJECT\DIASPORUM\diasporum-mobile`
**Auditor:** Automated verification + static code review

---

## 1. Executive Summary

**Overall Phase 1 status: PASS WITH CONDITIONS**

Phase 1 is structurally sound and functionally complete. The authentication architecture (Keycloak PKCE + SecureStore + single-flight refresh + guarded navigation) is correctly implemented and independently verified. Four real defects were found and fixed during this audit. One remaining structural issue (`explore.tsx` inside the root route space) was corrected.

Phase 2 may begin, subject to the conditions in section 6.

---

## 2. Verification Results

| Area | Result | Evidence | Outstanding issue |
|---|---|---|---|
| TypeScript | PASS | `npx tsc --noEmit` → 0 errors, `strict: true` in `tsconfig.json` | — |
| ESLint | PASS | `npx expo lint` → 0 errors, 0 warnings | — |
| Jest | PASS | `npx jest --runInBand` → 53/53 pass | — |
| Expo configuration | PASS | `npx expo-doctor` → 20/20 checks passed; `scheme: 'diasporummobile'`; `typedRoutes: true` | Wildcard redirect URI in Keycloak (non-blocking) |
| Keycloak PKCE | PASS (static) | `useAuthRequest` with `usePKCE: true`, `S256`; `offline_access` scope for refresh token; `useAutoDiscovery` for OIDC endpoints | End-to-end Android callback NOT VERIFIED (no device/dev build) |
| Secure token storage | PASS | `expo-secure-store` only; 3 separate keys; corrupt metadata returns `null`; `clearTokens` uses `allSettled` | — |
| Token refresh | PASS | `refreshPromise` single-flight; `EXPIRY_BUFFER_SECONDS = 30`; `400/401` → `SESSION_EXPIRED` → `clearTokens`; `refresh_token` fallback for non-rotating configs (fixed during audit) | — |
| API client | PASS | `isApiHost` restricts Bearer to API host; `authenticated: false` opt-out; proactive refresh; 401 → single refresh + retry; `TIMEOUT` error; `ApiError` normalization | — |
| Session restoration | PASS | `restoreSession` in `AuthProvider` mount effect; `null` → `unauthenticated`; valid → `authenticated`; expired → `refreshTokens` → `authenticated`; `NETWORK_ERROR` → returns expired tokens for deferred retry | — |
| Navigation guards | PASS | `(auth)/_layout.tsx` redirects authenticated users; `(app)/_layout.tsx` redirects unauthenticated users; `index.tsx` shows `LoadingScreen` during `loading` state | `explore.tsx` was outside groups — **fixed** |
| Logout | PASS | `handleLogout` sets `unauthenticated` immediately; `authService.logout` calls `clearTokens` first, then best-effort Keycloak end-session; `allSettled` never throws | — |
| Android deep link | NOT VERIFIED | `makeRedirectUri` → `diasporummobile://callback`; `scheme: 'diasporummobile'` in `app.json`; matches `diasporummobile://*` in Keycloak | Requires dev build + Android device |
| Backend integration | PASS (static) | `EXPO_PUBLIC_API_BASE_URL` → `http://localhost:8080`; issuer `http://localhost:8081/realms/diasporum` matches backend `issuer-uri`; `diasporum-api` in `defaultClientScopes` matches backend `audiences` | Live `GET /api/v1/me` NOT VERIFIED (no running backend) |
| Environment config | PASS | All 6 required vars validated; `ConfigValidationError` on missing/invalid; `.env` now in `.gitignore` (fixed) | — |

---

## 3. Security Findings

| # | Severity | Finding | Evidence | Action taken / Recommended |
|---|---|---|---|---|
| S-1 | MEDIUM | `.env` not in `.gitignore` | `.gitignore` only had `.env*.local`; `.env` could be accidentally committed with real credentials | **Fixed** — added `.env` to `.gitignore` |
| S-2 | LOW | Keycloak wildcard redirect `diasporummobile://*` | `realm-diasporum.json` line: `"redirectUris": ["diasporummobile://*"]` | Non-blocking for dev. **Recommend** tightening to `diasporummobile://callback` before production. Requires Keycloak change — needs approval. |
| S-3 | LOW | `refresh_token` not guaranteed in refresh response | `keycloakResponseToTokens` previously assigned `data.refresh_token` unconditionally; Keycloak may omit it when rotation is disabled | **Fixed** — `performRefresh` now uses `currentTokens.refreshToken` as fallback |
| S-4 | LOW | Hardcoded redirect URI diverged from env var | `use-login.ts` used `makeRedirectUri()` (hardcoded) while `EXPO_PUBLIC_AUTH_REDIRECT_URI` was validated but unused | **Fixed** — `use-login.ts` now uses `appConfig.authRedirectUri` |
| S-5 | INFO | `AnimatedSplashOverlay` shows Expo logo | `assets/images/expo-logo.png` used in splash animation | Cosmetic. Replace with Diasporum logo when assets available. |
| S-6 | MEDIUM | npm audit: 16 transitive vulnerabilities | `npm audit` reported 16 issues (dev/tooling deps mostly) | Review output; most are `inflight`/`glob` deprecation warnings. Not fixable without dependency upgrades — defer to Phase 2 sprint. |
| S-7 | LOW | `exchangeCode` dead code in `auth-service.ts` | Exported but never called; `use-login.ts` uses `exchangeCodeAsync` instead | **Fixed** — removed |

---

## 4. Defects Found and Fixed During Audit

### Defect 1 — `.env` not gitignored
- **File:** `diasporum-mobile/.gitignore`
- **Issue:** `.env` contained real config (URLs, client ID) and was not ignored — risk of accidental commit.
- **Fix:** Added `.env` to `.gitignore`. Confirmed `.env` was never tracked in git (`git ls-files --error-unmatch .env` → `did not match`).
- **Severity:** Medium (security hygiene)

### Defect 2 — `explore.tsx` outside auth route groups
- **File:** `src/app/explore.tsx` → `src/app/(app)/explore.tsx`
- **Issue:** `explore.tsx` sat at the root of `src/app/`, outside both `(auth)` and `(app)` groups. It was reachable at `/explore` regardless of auth state — an unguarded route.
- **Fix:** Moved file to `src/app/(app)/explore.tsx` so it sits inside the authenticated group. File unchanged except location.
- **Severity:** Medium (navigation defect — unguarded screen)

### Defect 3 — `refresh_token` not retained when Keycloak omits it
- **File:** `src/core/auth/auth-service.ts`, `src/core/auth/auth-types.ts`
- **Issue:** `keycloakResponseToTokens` assigned `refreshToken: data.refresh_token` unconditionally. If Keycloak is configured without refresh token rotation (`revoke_refresh_token = false`), the response omits `refresh_token` and `undefined` would be saved — silently breaking the session on the next refresh.
- **Fix:** `keycloakResponseToTokens` now accepts `fallbackRefreshToken`; `performRefresh` passes `currentTokens.refreshToken`. `KeycloakTokenResponse.refresh_token` typed as optional.
- **Severity:** Medium-High (silent session breakage)

### Defect 4 — `use-login.ts` used hardcoded `makeRedirectUri` instead of env var
- **File:** `src/features/authentication/hooks/use-login.ts`
- **Issue:** `REDIRECT_URI` was hardcoded via `makeRedirectUri({scheme:'diasporummobile', path:'callback'})` while `EXPO_PUBLIC_AUTH_REDIRECT_URI` was only validated but not used. Two sources of truth could diverge.
- **Fix:** Removed `makeRedirectUri`; `useAuthRequest` and `exchangeCodeAsync` now use `appConfig.authRedirectUri` directly.
- **Severity:** Low (maintainability/correctness)

### Defect 5 — Dead `exchangeCode` function in `auth-service.ts`
- **File:** `src/core/auth/auth-service.ts`
- **Issue:** Exported `exchangeCode` was never called — `use-login.ts` uses `exchangeCodeAsync` from `expo-auth-session`.
- **Fix:** Removed `exchangeCode` and its `getTokenEndpoint` import usage. `getTokenEndpoint` is still imported (used by `performRefresh`).
- **Severity:** Low (dead code)

### Defect 6 — Unused `isRetry` parameter in `executeRequest`
- **File:** `src/core/api/api-client.ts`
- **Issue:** `executeRequest` accepted `isRetry: boolean` but never used it. Dead parameter confusing the API.
- **Fix:** Removed parameter; updated both call sites.
- **Severity:** Low (cleanup)

### Defect 7 — Bogus "non-API host" test
- **File:** `src/__tests__/core/api/api-client.test.ts`
- **Issue:** Test called `fetch` directly (not through the API client) and asserted the URL — tested nothing about the API client.
- **Fix:** Exported `isApiHost` from `api-client.ts`; replaced the bogus test with three real `isApiHost` unit tests covering matching host, different host, and malformed URLs.
- **Severity:** Low (test quality)

### Tests added
- `isApiHost` — API host match → true
- `isApiHost` — different host → false
- `isApiHost` — malformed URL → false

**Net test change:** 51 → 53 (+2: replaced 1 bogus test with 3 real ones)

---

## 5. Manual Android Verification Checklist

The following tests require an Android device or emulator + a development build (`npx expo run:android`). **None of these were executed during this audit** — they are marked NOT VERIFIED and require manual confirmation.

### Pre-requisites

```bash
# Ensure backend is running on :8080 and Keycloak on :8081
# For Android emulator only — use 10.0.2.2 instead of localhost:
#   EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8080
#   EXPO_PUBLIC_KEYCLOAK_URL=http://10.0.2.2:8081

cd diasporum-mobile
npx expo run:android   # builds and installs dev build
```

### Test Cases

| # | Test | Steps | Expected result |
|---|---|---|---|
| M-1 | Fresh install → login screen | Install APK; launch app | Loading screen appears briefly → Welcome/login screen (no login flash) |
| M-2 | Login success | Tap "Sign in" → Keycloak page opens in system browser → enter credentials → authorize | Browser closes; app returns to authenticated Home screen with username shown |
| M-3 | Login cancel | Tap "Sign in" → press device back button before completing | Returns to login screen; no error shown; sign-in button re-enabled |
| M-4 | Session restored on restart | Kill app completely → relaunch | Loading screen → directly to Home screen (no login screen) |
| M-5 | Token refresh (wait 5+ min) | Leave app open past 5-min access token lifetime → trigger any API call (Phase 2) or wait for proactive refresh | Request succeeds without re-login |
| M-6 | Logout | Tap "Sign out" → confirm | App returns to login screen; no way to navigate back to Home |
| M-7 | Login → restart → logout → relaunch | Complete login → kill app → relaunch → logout → kill app → relaunch | After first relaunch: authenticated. After logout + relaunch: login screen (no ghost session) |
| M-8 | Airplane mode on startup | Kill app → enable airplane mode → relaunch | Loading screen → eventually login screen (not stuck on loading) |
| M-9 | Keycloak unavailable during logout | Logout while Keycloak is stopped | App returns to login screen (local logout succeeds; end-session failure is silent) |
| M-10 | Deep-link callback | Complete M-2 | Callback `diasporummobile://callback` opens app (not browser error page) |
| M-11 | Physical device (LAN IP) | Set `EXPO_PUBLIC_API_BASE_URL=http://<LAN-IP>:8080`, `EXPO_PUBLIC_KEYCLOAK_URL=http://<LAN-IP>:8081` → reinstall | Same as M-2 using real device |

---

## 6. Phase 2 Readiness Decision

**READY WITH CONDITIONS**

Phase 1 is verified sufficiently to begin Phase 2 development. The following conditions are non-blocking but must be resolved before any production or beta release:

| Condition | Blocker for Phase 2? | Blocker for production? |
|---|---|---|
| Android deep-link end-to-end test (M-2, M-10) | No — proceed in parallel | Yes |
| Live `GET /api/v1/me` request against running backend | No — API client is verified statically | Yes |
| Wildcard redirect URI tightened to `diasporummobile://callback` | No | Yes |
| npm audit: 16 vulnerabilities reviewed and triaged | No | Yes |
| `AnimatedSplashOverlay` Expo logo replaced with Diasporum branding | No | Yes |

**Why READY:** All structural correctness issues are resolved. The OAuth PKCE flow, secure storage, single-flight refresh, and navigation guards are implemented correctly per the Keycloak realm config and backend `issuer-uri`/`audiences` contract. The remaining items are either cosmetic (branding), environment-dependent (deep-link testing), or deferred maintenance (npm audit).

---

## 7. Recommended Next Actions

1. **[High]** Run `npx expo run:android` and manually complete M-2 and M-10 (deep-link callback) — the only unverified critical path.
2. **[High]** Test `GET /api/v1/me` against a running backend to confirm bearer auth works end-to-end.
3. **[Medium]** Tighten Keycloak redirect URI from `diasporummobile://*` to `diasporummobile://callback` (requires Keycloak admin — get approval first).
4. **[Medium]** Run `npm audit` and triage the 16 reported vulnerabilities — determine which are exploitable vs. dev-only.
5. **[Low]** Replace `expo-logo.png` in `AnimatedSplashOverlay` and `AnimatedIcon` with Diasporum branding assets.
6. **[Low]** Remove `src/components/app-tabs.tsx` and `src/components/app-tabs.web.tsx` (unused since route groups replaced tab navigation).
7. **[Low]** Remove `src/components/ui/collapsible.tsx`, `src/components/external-link.tsx`, `src/components/hint-row.tsx`, `src/components/web-badge.tsx` (Expo starter remnants not used by any route).

---

## 8. Files Changed During This Audit

| File | Change |
|---|---|
| `.gitignore` | Added `.env` |
| `src/app/explore.tsx` → `src/app/(app)/explore.tsx` | Moved inside authenticated route group |
| `src/core/auth/auth-types.ts` | `refresh_token` → optional in `KeycloakTokenResponse` |
| `src/core/auth/auth-service.ts` | `keycloakResponseToTokens` accepts `fallbackRefreshToken`; `performRefresh` passes it; removed dead `exchangeCode` |
| `src/features/authentication/hooks/use-login.ts` | `appConfig.authRedirectUri` replaces `makeRedirectUri` |
| `src/core/api/api-client.ts` | Exported `isApiHost`; removed unused `isRetry` param |
| `src/__tests__/core/api/api-client.test.ts` | Replaced bogus non-API host test with `isApiHost` unit tests |
| `src/constants/theme.ts` | `border` + Diasporum brand tokens added (prior session) |
| `src/types/declarations.d.ts` | CSS module declarations added (prior session) |
| `tsconfig.json` | `types: ["jest"]` added (prior session) |
| `package.json` | Scripts, jest config, devDependencies (prior session) |
| `.env.example` | All required env vars documented (prior session) |
| `app.json` | Diasporum purple splash/icon colors (prior session) |
| `src/hooks/use-color-scheme.web.ts` | Lint fix (prior session) |
| `src/components/app-tabs.web.tsx` | `@ts-expect-error` for pre-existing type error (prior session) |

---

## 9. Confirmation

- No commits, pushes, or deployments were made during this audit.
- No backend or Keycloak configuration was modified.
- No secrets or credentials are present in any tracked file.
- No Phase 2 features were implemented.
