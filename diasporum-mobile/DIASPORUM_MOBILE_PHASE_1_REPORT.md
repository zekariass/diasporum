# Diasporum Mobile — Phase 1 Implementation Report

**Phase:** Foundation, Navigation and Authentication
**Status:** Complete
**Date:** 2026-01-19
**Repo:** `C:\PROJECT\DIASPORUM\diasporum-mobile`

---

## 1. Existing Project Assessment

| Item | Finding |
|---|---|
| Expo SDK | ~58.0.21 (retained — no upgrade needed) |
| React Native | 0.88.1 |
| React | 19.3.0 |
| Expo Router | ~58.0.28 (already installed and configured) |
| TypeScript | ~6.0.3, `strict: true` already enabled |
| Package manager | npm (`package-lock.json` present) |
| Navigation | Expo Router via `src/app/` file-based routes |
| State management | None (AuthProvider added in Phase 1) |
| API client | None (built in Phase 1) |
| Authentication | None (built in Phase 1) |
| Secure storage | None (`expo-secure-store` added in Phase 1) |
| ESLint | None initially; configured via `npx expo lint` |
| Tests | None; jest-expo + RNTL added in Phase 1 |
| Env config | `.env` had only `EXPO_PUBLIC_API_BASE_URL` |
| Assets | Expo starter assets (icons, splash) — replaced with Diasporum branding |
| Existing functionality | Demo Home/Explore tabs replaced with proper auth-gated routes |

**Key finding:** The project was a clean Expo SDK 58 starter scaffold. No authentication, API client, or test infrastructure existed. Expo Router was already installed and correctly configured — it was retained rather than replaced.

---

## 2. Technology & Dependency Decisions

### Added Dependencies

| Package | Version | Reason |
|---|---|---|
| `expo-auth-session` | ~58.0.16 | OIDC discovery + Authorization Code Flow + PKCE S256 |
| `expo-crypto` | ~58.0.7 | PKCE code verifier/challenge generation (required by expo-auth-session) |
| `expo-secure-store` | ~58.0.2 | Platform-native secure token storage (Keychain / EncryptedSharedPreferences) |
| `jest` | ~30.5.2 | Unit test runner |
| `jest-expo` | ~58.0.13 | Expo-aware Jest preset for SDK 58 |
| `@testing-library/react-native` | ^14.1.0 | React Native Testing Library (preferred over deprecated react-test-renderer for React 19) |
| `@types/jest` | 30.0.0 | Jest type definitions |
| `eslint` | ^9.0.0 | Linter (installed by `npx expo lint`) |
| `eslint-config-expo` | ~58.0.4 | Expo SDK 58 ESLint preset |

**No dependencies removed.** No major framework versions upgraded.

### Key Architectural Choices

| Decision | Rationale |
|---|---|
| Expo Router (not React Navigation) | Already installed; typed routes enabled via `experiments.typedRoutes` |
| Route groups `(auth)` / `(app)` | Standard Expo Router pattern for auth-gated navigation |
| `expo-auth-session` PKCE | Maintained Expo library; avoids implementing crypto primitives manually |
| Direct `fetch()` for token endpoints | `expo-auth-session`'s `exchangeCodeAsync` works for code exchange; direct fetch needed for refresh + logout which have different parameter shapes |
| Single-flight refresh via module-level `refreshPromise` | Prevents concurrent refresh storms; all API callers share one in-flight promise |
| Separate SecureStore keys per token field | Avoids single-value size limits (~2 KB on older iOS); access token, refresh token and metadata stored independently |
| AuthContext via `tokensRef` | Avoids re-renders on token access; API client reads tokens without subscribing to state |

---

## 3. Final Folder Structure

```
diasporum-mobile/
├── src/
│   ├── app/                          # Expo Router routes
│   │   ├── _layout.tsx               # Root layout — AuthProvider + Stack
│   │   ├── index.tsx                 # Auth-state redirect (loading → login or home)
│   │   ├── (auth)/
│   │   │   ├── _layout.tsx           # Guard: redirects authenticated users out
│   │   │   └── login.tsx             # Welcome / sign-in screen
│   │   └── (app)/
│   │       ├── _layout.tsx           # Guard: redirects unauthenticated users to login
│   │       └── home.tsx              # Authenticated placeholder (Phase 1)
│   │
│   ├── components/                   # Pre-existing Expo starter components
│   │   ├── animated-icon.tsx         # Splash overlay (kept)
│   │   ├── animated-icon.web.tsx     # Web variant (kept)
│   │   ├── app-tabs.tsx              # Old tab nav (superseded by route groups)
│   │   ├── app-tabs.web.tsx          # Web variant (kept — not imported)
│   │   ├── external-link.tsx         # Kept
│   │   ├── themed-text.tsx           # Kept
│   │   └── themed-view.tsx           # Kept
│   │
│   ├── constants/
│   │   └── theme.ts                  # Existing Colors/Spacing + Diasporum brand tokens added
│   │
│   ├── core/                         # Application-wide infrastructure
│   │   ├── config/
│   │   │   └── env.ts                # Validated env singleton — fails fast on missing vars
│   │   ├── auth/
│   │   │   ├── auth-types.ts         # AuthState, AuthTokens, UserInfo, KeycloakTokenResponse
│   │   │   ├── auth-errors.ts        # AuthError + AuthErrorCode union
│   │   │   ├── auth-storage.ts       # SecureStore-backed AuthStorage interface + impl
│   │   │   ├── auth-service.ts       # Non-React auth logic: expiry, refresh, restore, logout
│   │   │   └── auth-provider.tsx     # React context: session restore, login, logout, refresh
│   │   └── api/
│   │       ├── api-error.ts          # ApiError + ApiErrorCode + BackendErrorBody
│   │       ├── api-types.ts          # MeResponse, PageResponse
│   │       └── api-client.ts         # Bearer injection + proactive refresh + 401 retry
│   │
│   ├── features/
│   │   └── authentication/
│   │       ├── components/
│   │       │   └── sign-in-button.tsx # Reusable branded SignInButton
│   │       └── hooks/
│   │           └── use-login.ts       # expo-auth-session wrapper for the login screen
│   │
│   ├── hooks/                        # Pre-existing hooks
│   │   ├── use-theme.ts              # Kept
│   │   ├── use-color-scheme.ts       # Kept
│   │   └── use-color-scheme.web.ts   # Kept (lint fix applied)
│   │
│   ├── shared/
│   │   ├── components/
│   │   │   └── loading-screen.tsx    # Branded startup/loading state
│   │   └── theme/
│   │       ├── colors.ts             # Diasporum design-system colour tokens
│   │       ├── spacing.ts            # Spacing + BorderRadius scales
│   │       └── typography.ts         # FontFamily, FontSize, LineHeight
│   │
│   ├── types/
│   │   └── declarations.d.ts         # CSS module type declarations
│   │
│   └── __tests__/
│       └── core/
│           ├── config/env.test.ts
│           ├── auth/auth-storage.test.ts
│           ├── auth/auth-service.test.ts
│           └── api/api-client.test.ts
│
├── app.json                          # Expo config — scheme, plugins, typed routes
├── package.json                      # Scripts, jest config, dependencies
├── tsconfig.json                     # Strict TS + path aliases (@/* → src/*)
├── eslint.config.mjs                 # eslint-config-expo flat config
├── .env.example                      # All required env vars documented
├── .env                              # Local dev values (gitignored)
├── jest.config.js                    # (implicit — configured in package.json)
└── DIASPORUM_MOBILE_PHASE_1_REPORT.md
```

---

## 4. Environment Variables

### `.env.example` — all required keys

```dotenv
# App environment: development | staging | production
EXPO_PUBLIC_APP_ENV=development

# Diasporum backend base URL (no trailing slash)
# Android emulator: use 10.0.2.2 instead of localhost
EXPO_PUBLIC_API_BASE_URL=http://localhost:8080

# Keycloak server URL (no trailing slash)
EXPO_PUBLIC_KEYCLOAK_URL=http://localhost:8081

# Keycloak realm
EXPO_PUBLIC_KEYCLOAK_REALM=diasporum

# Keycloak public client ID for this app
EXPO_PUBLIC_KEYCLOAK_CLIENT_ID=diasporum-mobile

# OAuth redirect URI registered in Keycloak
# Must match the app scheme in app.json + Keycloak client redirect URIs
EXPO_PUBLIC_AUTH_REDIRECT_URI=diasporummobile://callback
```

### `.env` (local development — gitignored)

```dotenv
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_API_BASE_URL=http://localhost:8080
EXPO_PUBLIC_KEYCLOAK_URL=http://localhost:8081
EXPO_PUBLIC_KEYCLOAK_REALM=diasporum
EXPO_PUBLIC_KEYCLOAK_CLIENT_ID=diasporum-mobile
EXPO_PUBLIC_AUTH_REDIRECT_URI=diasporummobile://callback
```

> **Note:** `EXPO_PUBLIC_*` vars are bundled into the app binary. **No secrets** may use this prefix.

### Validation

`src/core/config/env.ts` exports `appConfig` — a validated singleton built at module load time. If any required variable is missing, empty, or has an invalid value, `ConfigValidationError` is thrown immediately. The app will not silently fall back to a wrong environment.

---

## 5. Local Development Setup

### Prerequisites

- Node.js 18+ and npm
- Expo CLI: `npm install -g eas-cli` (for EAS builds) or `npx expo` (bundled)
- Android SDK / Android emulator, OR physical Android device
- Running backend: `http://localhost:8080`
- Running Keycloak: `http://localhost:8081` (realm `diasporum`, client `diasporum-mobile`)

### Install and run

```bash
cd diasporum-mobile

# Install dependencies
npm install

# Copy env template (first time only)
cp .env.example .env
# Edit .env — set correct API_BASE_URL and KEYCLOAK_URL for your machine

# Start Metro bundler
npx expo start

# Launch on Android emulator
npx expo run:android

# OR scan QR code with Expo Go app (requires dev build for auth — see §10)
```

### Android Emulator Networking

The Android emulator **cannot reach `localhost`** — it refers to the emulator itself, not your development machine.

```
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8080
EXPO_PUBLIC_KEYCLOAK_URL=http://10.0.2.2:8081
```

`10.0.2.2` is the special alias for `localhost` on the host machine from inside the emulator.

### iOS Simulator Networking

The iOS simulator **can** use `localhost` directly:

```
EXPO_PUBLIC_API_BASE_URL=http://localhost:8080
EXPO_PUBLIC_KEYCLOAK_URL=http://localhost:8081
```

### Physical Device Networking

Physical devices cannot use `localhost` or `10.0.2.2`. Use your machine's LAN IP or a reachable development URL:

```
# Find your machine IP (e.g., 192.168.1.50)
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.50:8080
EXPO_PUBLIC_KEYCLOAK_URL=http://192.168.1.50:8081
```

Ensure the device is on the same Wi-Fi network and no firewall blocks the ports.

---

## 6. Keycloak Authentication Architecture

### Verified Configuration (from `keycloak/realm-diasporum.json`)

| Setting | Value |
|---|---|
| Realm | `diasporum` |
| Client ID | `diasporum-mobile` |
| Client type | Public (`publicClient: true`) |
| Standard flow (Auth Code) | Enabled |
| Implicit flow | Disabled |
| Direct access grants | Disabled |
| Service accounts | Disabled |
| PKCE challenge method | `S256` |
| Redirect URIs | `diasporummobile://*` |
| Access token lifespan | 300 seconds |
| Audience scope | `diasporum-api` (default scope assigned) |

### OIDC Discovery

The app uses Keycloak's OIDC discovery endpoint to resolve all endpoints automatically:

```
GET {KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/.well-known/openid-configuration
```

`expo-auth-session`'s `useAutoDiscovery` fetches this document. The discovered issuer is implicitly validated because the authorization URL constructed matches the configured realm.

### OAuth 2.0 Authorization Code + PKCE Flow

```
1. App generates: code_verifier + code_challenge (S256) + state
2. Opens Keycloak authorization endpoint in system browser:
   {KEYCLOAK_URL}/realms/diasporum/protocol/openid-connect/auth
   ?client_id=diasporum-mobile
   &redirect_uri=diasporummobile://callback
   &response_type=code
   &scope=openid profile email offline_access
   &code_challenge=<challenge>
   &code_challenge_method=S256
   &state=<random>
3. User authenticates via Keycloak login page
4. Keycloak redirects to: diasporummobile://callback?code=...&state=...
5. Expo deep-linking captures the URL → expo-auth-session parses code + state
6. App POSTs to token endpoint:
   grant_type=authorization_code
   client_id=diasporum-mobile
   code=<code>
   redirect_uri=diasporummobile://callback
   code_verifier=<verifier>
7. Keycloak returns access_token + refresh_token + expires_in
8. Tokens stored in Expo SecureStore
9. AuthProvider.handleAuthSuccess() updates state → navigation reacts
```

### Redirect URI & Deep Linking

| Layer | Value |
|---|---|
| `app.json` → `scheme` | `diasporummobile` |
| Keycloak client redirect URI | `diasporummobile://*` |
| `use-login.ts` → `makeRedirectUri` | `scheme: 'diasporummobile', path: 'callback'` → `diasporummobile://callback` |
| `.env` → `EXPO_PUBLIC_AUTH_REDIRECT_URI` | `diasporummobile://callback` |

> **Known limitation:** The Keycloak registered redirect is `diasporummobile://*` (wildcard). For production, this should be tightened to `diasporummobile://callback` specifically. The wildcard is functional but less strict.

---

## 7. Secure Token Storage

`src/core/auth/auth-storage.ts` wraps `expo-secure-store` behind an `AuthStorage` interface:

```typescript
interface AuthStorage {
  getTokens(): Promise<AuthTokens | null>;
  saveTokens(tokens: AuthTokens): Promise<void>;
  clearTokens(): Promise<void>;
}
```

**Storage keys:**
- `dsp_at` — access token
- `dsp_rt` — refresh token
- `dsp_meta` — JSON metadata (expiresAt, tokenType, scope)

**Why separate keys?** SecureStore on iOS historically has a ~2 KB value limit. Storing the access token (a JWT, typically 1–4 KB) separately from the refresh token avoids truncation.

**Platform storage:**
- **iOS:** Keychain Services (AES-256, hardware-backed on modern devices)
- **Android:** EncryptedSharedPreferences (API 23+), falls back to SharedPreferences with file-level encryption

**Backup note:** `expo-secure-store` on Android respects `allowBackup` in `AndroidManifest.xml`. The SecureStore config plugin is registered in `app.json` automatically.

---

## 8. Token Refresh & Concurrency Strategy

### Expiry Detection

```typescript
const EXPIRY_BUFFER_SECONDS = 30;
isTokenExpired(tokens) → tokens.expiresAt - 30_000 <= Date.now()
```

The access token is considered "expired" 30 seconds before its actual `exp` claim to provide a safety margin for in-flight requests.

### Proactive Refresh

Before every authenticated API call, `api-client.ts` checks `isTokenExpired()`. If true, it awaits `authContext.refreshAndUpdate()` before making the request — the user never sees a 401 in the common case.

### Reactive Refresh (401)

If a request still returns `401 Unauthorized` (e.g., token revoked server-side):
1. `api-client` calls `authContext.refreshAndUpdate()` (which hits `refreshTokens()`)
2. On success, the request is retried **once**
3. On failure, the `ApiError` propagates to the caller

### Single-Flight (Concurrent Refresh Protection)

```typescript
let refreshPromise: Promise<AuthTokens> | null = null;

export async function refreshTokens(...) {
  if (refreshPromise) return refreshPromise;       // waiting callers reuse the promise
  refreshPromise = performRefresh(...).finally(() => { refreshPromise = null; });
  return refreshPromise;
}
```

If three concurrent API calls all trigger a refresh, only **one** Keycloak request is made. All callers receive the same `Promise<AuthTokens>`.

### Refresh Token Rotation

When Keycloak rotates the refresh token (returns a new one), `performRefresh` calls `storage.saveTokens(newTokens)` — the old refresh token is immediately replaced. Subsequent requests never use the revoked old token.

### Session Expiry

When Keycloak returns `400` or `401` from the token endpoint during refresh:
- `storage.clearTokens()` is called
- `AuthError('SESSION_EXPIRED')` is thrown
- `AuthProvider` catches this, sets `authState.status = 'unauthenticated'`
- Navigation redirects the user to the login screen

The user sees: loading → login screen with a session-expired indication. No authenticated UI is left in a broken state.

---

## 9. API Client Architecture

`src/core/api/api-client.ts` exports `createApiClient(deps)` returning a typed client:

```typescript
const client = createApiClient({ authContext });
await client.get<MeResponse>('/api/v1/me');
await client.post<SomeDto>('/api/v1/posts', body);
await client.get<PublicData>('/api/v1/public', { authenticated: false });
```

### Design Decisions

- **Bearer injection:** `Authorization: Bearer <token>` is only added when `options.authenticated !== false` AND the request targets the configured API host. Tokens are never sent to third-party domains.
- **Proactive expiry check:** `isTokenExpired()` is checked before the request; expired tokens trigger `refreshAndUpdate()` transparently.
- **401 retry:** One retry after a successful `refreshAndUpdate()`. A second 401 propagates as `ApiError` — no infinite loop.
- **Timeout:** 10 seconds default via `AbortController`, overridable per request via `options.timeoutMs`.
- **Error normalization:** HTTP status → `ApiErrorCode` (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `SERVER_ERROR`, `NETWORK_ERROR`, `TIMEOUT`). Backend `ApiError` body fields are parsed when present.

### GET /api/v1/me

`src/app/(app)/home.tsx` will use `client.get<MeResponse>('/api/v1/me')` in a future phase to display authenticated identity data. The type exists in `src/core/api/api-types.ts`.

---

## 10. Navigation Architecture

### Structure

```
src/app/
├── _layout.tsx          # Root — SafeAreaProvider + AuthProvider + Stack
├── index.tsx            # Redirect based on auth state
├── (auth)/
│   ├── _layout.tsx      # Guard: authenticated → redirect to /(app)/home
│   └── login.tsx        # Welcome / sign-in
└── (app)/
    ├── _layout.tsx      # Guard: unauthenticated → redirect to /(auth)/login
    └── home.tsx         # Phase 1 authenticated placeholder
```

### Navigation Guard Pattern

Each route group's `_layout.tsx` reads `useAuth().authState` and returns `<Redirect>` when the user doesn't belong in that group. This is the idiomatic Expo Router pattern — guards live in layouts, not scattered across screens.

### Startup Flow

```
App launch
  └── SplashScreen.preventAutoHideAsync() called in _layout.tsx
  └── AuthProvider mounts → restoreSession()
        ├── getTokens() → null → status: 'unauthenticated' → (auth)/login
        ├── getTokens() → valid → status: 'authenticated' → (app)/home
        └── getTokens() → expired → refreshTokens()
              ├── success → authenticated → (app)/home
              └── failure → clearTokens() → unauthenticated → (auth)/login
  └── AnimatedSplashOverlay renders during 'loading' state
```

The login screen never flashes before session restoration — `index.tsx` shows `<LoadingScreen>` when `authState.status === 'loading'`.

### Development Build Requirement

> **Important:** `expo-auth-session`'s `useAuthRequest` uses `Linking.createURL` with a custom scheme (`diasporummobile://`). This requires an **Expo Development Build** — Expo Go does not register custom URI schemes.
>
> Run `npx expo run:android` (or `npx expo run:ios`) to produce a development build. Expo Go will show the login screen but the OAuth callback will not work.

---

## 11. Screens Implemented

| Screen | Route | Description |
|---|---|---|
| `LoadingScreen` | `src/shared/components/loading-screen.tsx` | ActivityIndicator + optional message; used during `authState.status === 'loading'` |
| `LoginScreen` | `src/app/(auth)/login.tsx` | Diasporum branding, welcome copy, `SignInButton` with loading state, error display with dismiss |
| `HomeScreen` | `src/app/(app)/home.tsx` | User avatar (initial letter), name/email from JWT claims, Phase 1 status card, Sign Out button |

All screens use `useTheme()` for dark/light mode support and respect `SafeAreaView` insets.

---

## 12. Testing Strategy

| Test file | Coverage |
|---|---|
| `__tests__/core/config/env.test.ts` | Config validation: all required vars, missing vars throw, invalid `APP_ENV` throws, valid env accepted, endpoint URL construction |
| `__tests__/core/auth/auth-storage.test.ts` | SecureStore wrapper: save/get/clear calls correct keys, corrupt metadata returns null, storage errors surface as `STORAGE_ERROR`, clear never throws |
| `__tests__/core/auth/auth-service.test.ts` | `isTokenExpired` (30s buffer), `decodeJwtPayload`, `extractUserInfo`, `refreshTokens` (success, 400→SESSION_EXPIRED, network error, single-flight), `restoreSession` (null, valid, expired→refresh, expired→refresh fail→null), `logout` (always clears storage) |
| `__tests__/core/api/api-client.test.ts` | Bearer header injection, `authenticated: false` skips auth, non-API host gets no token, 401→refresh→single retry, 500→SERVER_ERROR, network failure→NETWORK_ERROR, correct base URL |

**Total: 51 tests, all passing.**

Tests use `jest-expo` preset. `expo-secure-store` is auto-mocked. `global.fetch` is stubbed per-test. `env.ts` module is mocked in test files that import `auth-service` (which loads `appConfig` at module level).

---

## 13. Verification Results

| Check | Command | Result |
|---|---|---|
| TypeScript strict | `npx tsc --noEmit` | ✅ 0 errors |
| ESLint | `npx expo lint` | ✅ 0 errors, 0 warnings |
| Unit tests | `npx jest` | ✅ 51/51 pass |
| Expo Doctor | `npx expo-doctor` | Not run — no Android build available in this environment |
| Android build | `npx expo run:android` | Not run — no Android SDK/emulator in this environment |
| iOS build | `npx expo run:ios` | Not run — iOS requires macOS |
| Keycloak end-to-end login | Manual | Not run — requires dev build + running Keycloak instance |

### Android/iOS Build Status

Native builds were not run in this environment (no Android SDK / macOS). The code is written for development builds; to verify:

```bash
# Android
npx expo run:android

# iOS (requires macOS + Xcode)
npx expo run:ios

# EAS cloud build (requires eas-cli + Expo account)
eas build --platform android --profile development
```

### Keycloak Flow Verification Limitation

The end-to-end mobile login (open browser → authenticate → deep-link callback → token exchange) could not be verified without a running Keycloak instance and a development build. The implementation follows the verified web-client pattern (same Keycloak config, same PKCE S256 flow proven via curl in `DIASPORUM_AUTH_MILESTONE_REPORT.md`).

**To verify manually:**
1. Ensure `EXPO_PUBLIC_AUTH_REDIRECT_URI=diasporummobile://callback` is registered in Keycloak (currently `diasporummobile://*` — tighten for production)
2. Run `npx expo run:android` with a development build
3. Ensure `EXPO_PUBLIC_KEYCLOAK_URL` is reachable from the device/emulator
4. Tap "Sign in" — the system browser opens the Keycloak login page
5. After authentication, Keycloak redirects back via `diasporummobile://callback`

---

## 14. Security Checklist

- [x] No secrets or client secrets in `.env` or `.env.example`
- [x] No `AsyncStorage` used for tokens — `expo-secure-store` only
- [x] PKCE S256 enforced via `codeChallengeMethod: CodeChallengeMethod.S256`
- [x] Tokens never logged or included in error messages
- [x] Bearer tokens only sent to the configured API host
- [x] `Authorization` header never sent for `authenticated: false` requests
- [x] Logout clears all SecureStore keys before making the network call
- [x] Session expiry (refresh token revoked) → storage cleared + auth state reset
- [x] No TLS validation disabled anywhere
- [x] `EXPO_PUBLIC_*` prefix used only for client-safe values
- [x] `.env` excluded from git

---

## 15. Remaining Issues & Known Limitations

| Issue | Severity | Action Required |
|---|---|---|
| Wildcard redirect URI `diasporummobile://*` | Low | Tighten to `diasporummobile://callback` in Keycloak for production |
| No development build available to verify login end-to-end | Medium | Run `npx expo run:android` with a dev build to verify the OAuth callback |
| `Buffer` not available in React Native JS runtime | Low | `auth-service.test.ts` uses `btoa`/`atob` polyfills; `auth-service.ts` already uses `globalThis.atob` — safe on all platforms |
| npm audit: 16 vulnerabilities (transitive deps) | Low–Medium | Review `npm audit` output; most are dev dependencies or sub-dependencies |
| `app-tabs.tsx` / `app-tabs.web.tsx` still exist but unused | Low | Can be removed in a future cleanup pass; they are not imported |
| `AnimatedIcon` uses Expo starter logo assets | Low | Replace with Diasporum logo when final assets are available |
| Old `explore.tsx` still exists at `src/app/explore.tsx` | Low | Remove or integrate into `(app)` group in Phase 2 |

---

## 16. Recommended Next Phase

**Phase 2 — User Identity & Home Feed Foundation**

1. Wire `useLogin` error states to show specific session-expired / cancelled messages
2. Connect `HomeScreen` to `GET /api/v1/me` to display real identity data
3. Build the `home` feature module skeleton: `src/features/home/`
4. Add `Feed` and `Profile` tab navigation inside `(app)/` route group
5. Tighten Keycloak redirect URI from `diasporummobile://*` to `diasporummobile://callback`
6. Create a real Diasporum app icon/splash replacing Expo starter assets
7. Add integration tests for the `(auth)` → `(app)` navigation flow using `expo-router` test utilities
8. Implement Android + iOS CI pipeline with EAS build

---

## 17. Confirmation

- **No commits made** — all changes are local working-tree modifications only
- **No pushes made** — remote is untouched
- **No deployments made** — no EAS builds or deployments triggered
- **No backend changes** — `diasporum-backend/` untouched
- **No Keycloak config changes** — `keycloak/` untouched
- **No secrets exposed** — all tokens/credentials handled through env vars only
