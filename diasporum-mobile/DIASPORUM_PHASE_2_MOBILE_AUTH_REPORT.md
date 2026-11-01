# Diasporum Mobile — Phase 2 Authentication Integration Report

**Date:** 2026-10-31
**Scope:** Replace Keycloak-based auth with the first-party `/api/v1/auth/**` backend (Phase 1/1.2).
**Status:** IMPLEMENTED — typecheck clean, 76/76 jest tests passing

---

## 1. Initial Assessment

- **Expo SDK 58**, React Native 0.88.1, TypeScript 6, expo-router (typed routes), expo-secure-store, jest-expo.
- Existing auth was **Keycloak OAuth Authorization Code + PKCE** via `expo-auth-session` + system browser: `use-login.ts` (discovery, code exchange), `auth-service.ts` (Keycloak token endpoint refresh/logout), `env.ts` (`KEYCLOAK_*` config).
- Reusable and preserved: `auth-storage.ts` (SecureStore, untouched), single-flight refresh, `api-client.ts` (token injection + proactive refresh + single retry), `AuthProvider`, `SessionProvider`, route guards in `(auth)`/`(app)`/`(onboarding)` layouts, onboarding step routing.
- Backend contract source: `AuthController` + `docs/auth-api-v1.yaml` — no invented endpoints.

## 2. Changes

### Removed / replaced

- `env.ts` — `keycloakUrl/Realm/ClientId` + `getKeycloak*/getTokenEndpoint/getEndSessionEndpoint` removed → `googleAndroid/Ios/WebClientId`, `appleClientId`, `authRedirectUri`.
- `use-login.ts` (Keycloak PKCE) and `sign-in-button.tsx` deleted → `use-auth-flow.ts` + `provider-signin.ts`.
- `auth-service.ts` rewritten — refresh via `POST /api/v1/auth/refresh` (opaque rotating token, JSON contract), logout/logout-all via backend session endpoints, `extractUserInfo` now reads `sub`/`sid` claims (UX only).
- `session-provider.tsx` — account identity from `GET /api/v1/auth/me`; `/api/v1/me/profile` 404 → `profile: null` → onboarding (never treated as auth failure).
- `session-types.ts` — `SessionState.me: AccountMe`; `profile` nullable; `resolveOnboardingStep` handles null profile.

### Created

- `features/authentication/services/auth-api.ts` — all `/api/v1/auth/**` calls (public fetch + authenticated ApiClient paths).
- `features/authentication/services/provider-signin.ts` — native Google (`@react-native-google-signin/google-signin`, webClientId-scoped idToken) and Apple (`expo-apple-authentication`, FULL_NAME+EMAIL scopes, generated nonce).
- `features/authentication/hooks/use-auth-flow.ts` — shared login/register/provider flow state.
- Screens: `(auth)/register`, `verify-email`, `forgot-password`, `reset-password`; login rewritten (email+password, Google, native Apple button).
- `(app)/settings/security.tsx` — change password, link Google/Apple, unlink identity, active-session list + revoke, logout-all; linked from profile tab.
- `app.json` — `expo-apple-authentication` + google-signin plugins, `ios.usesAppleSignIn`, `ios.bundleIdentifier`.

## 3. Security Behaviour

- Tokens only in SecureStore; never in AsyncStorage/logs/nav params.
- Refresh is single-flight; rotated refresh token persisted atomically; replay/expiry → clear credentials → unauthenticated. API client retries once after refresh — no loops.
- Provider ID tokens are sent to the backend; client-side sign-in is never treated as authentication.
- Reset/verify tokens arrive via deep-link `?token=` params, used once, never logged.
- Backend remains authoritative for verification, account status, session validity.

## 4. Tests — Actual Results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx jest src/__tests__` | **76/76 passing, 7 suites** |

Updated for the new contracts: auth-service (refresh 200 + AuthResponse shape, SESSION_EXPIRED on 400/401, NETWORK_ERROR, single-flight), env config, UserInfo fields, session-resolver (AccountMe).

## 5. Not Verified / Remaining

- **No device testing** — Android/iOS native Google and Apple sign-in NOT exercised (needs dev build + real provider client IDs). Expo Go cannot run the native modules.
- **Deep links** — `diasporummobile://verify-email?token=` and `…/reset-password?token=` screens implemented; requires backend `DIASPORUM_APP_BASE_URL=diasporummobile://` for mobile-targeted emails, or universal-link setup.
- **Backend gaps:** `GET /api/v1/auth/me` has no `emailVerified` boolean (emailVerifiedAt timestamp used); external-identity list endpoint for displaying linked accounts is absent — the security screen offers link/unlink but cannot list current identities (`GET /api/v1/auth/identities` would be a minimal backend addition).
- **Lint** not run; manual `npx expo lint` recommended before release.
- `.env` needs `EXPO_PUBLIC_GOOGLE_*`/`EXPO_PUBLIC_APPLE_CLIENT_ID` for real provider testing.

*All test claims reflect executed runs. No real-provider verification was performed.*
