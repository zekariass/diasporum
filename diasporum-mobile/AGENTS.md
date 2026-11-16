# Diasporum Mobile

Expo ~58 / React Native 0.88 / React 19 — iOS and Android companion app for the
Diasporum platform. Communicates with the Spring Boot backend REST API.

## Project structure

```
src/
  app/                        ← Expo Router file-based routes
    (auth)/                   ← auth flow (login, register, onboarding)
    (app)/                    ← authenticated tab navigator
      (tabs)/                 ← main tab screens
      {feature}/              ← feature-specific screens/stacks
  features/{domain}/          ← feature modules (mirrors backend modules)
    components/               ← feature-specific UI components
    hooks/                    ← feature-specific React hooks
    screens/                  ← screen components (referenced by app/)
    services/                 ← API service functions (createXxxApi factory)
    types/                    ← TypeScript types/interfaces
    utils/                    ← feature-specific utilities
  core/
    api/                      ← HTTP client (auth injection, token refresh)
    auth/                     ← auth provider, session management
    config/                   ← env config
    navigation/               ← navigation utilities
    session/                  ← session state
  shared/                     ← shared UI components, theme, utilities
  hooks/                      ← global React hooks
  constants/                  ← app constants
  types/                      ← shared TypeScript types
  __tests__/                  ← test files (mirrors src/features/ structure)
  __mocks__/                  ← jest module mocks
```

**Feature services pattern:** each feature exports a `createXxxApi(client: ApiClient)`
factory that wraps the shared `core/api/api-client.ts` — this handles Bearer token
injection, proactive token refresh, and 401-retry-once.

**Types pattern:** `types/{feature}-types.ts` for shared interfaces; API response
types match backend `*Api` record structures.

## API conventions

- Backend: `POST/GET/PUT/PATCH/DELETE /api/v1/...` — always use `apiClient` from `core/api/`
- Error shape: `{status, code, message, path, timestamp, fieldErrors}` — map to `ApiError`
- IDs are UUID strings
- Timestamps are ISO-8601 strings

## Testing

- `jest-expo` preset; tests in `src/__tests__/{core|features}/...`
- `jest-expo` handles React Native mocks; `src/__mocks__/` for custom mocks
- `npm test` to run

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
