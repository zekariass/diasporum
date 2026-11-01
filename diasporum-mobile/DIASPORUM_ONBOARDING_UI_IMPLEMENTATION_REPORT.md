# Diasporum — Mobile Onboarding UI/UX Implementation Report

Date: 2026-10-31
Scope: Redesign of the mobile onboarding experience to match the approved
reference (`screen-designs/onboarding-screen-design.png`) and supplied
background artwork (`screen-designs/onboarding_backgrounds/`).

## 1. Reference files inspected

| File | Role | Dimensions |
|---|---|---|
| `screen-designs/onboarding-screen-design.png` | 7-screen contact sheet (visual source of truth) | 1536×1024 |
| `onboarding_backgrounds/01_welcome_diaspora.png` | Welcome illustration | 1024×1280 (4:5) |
| `onboarding_backgrounds/02_global_connection.png` | Create-account illustration | 1024×1280 |
| `onboarding_backgrounds/03_origin_heritage.png` | Country-of-origin illustration | 1024×1280 |
| `onboarding_backgrounds/04_current_country.png` | Current-country illustration | 1024×1280 |
| `onboarding_backgrounds/05_community_belonging.png` | Community-preview illustration | 1024×1280 |
| `onboarding_backgrounds/06_profile_setup.png` | Profile illustration | 1024×1280 |
| `onboarding_backgrounds/07_onboarding_complete.png` | Completion illustration | 1024×1280 |

The contact sheet was used only as the layout reference — each screen uses its
own individual 4:5 asset, per spec.

## 2. Asset mapping

> **Update:** after visual review the supplied background artwork was removed
> from the screens (user feedback). Screens now use clean themed surfaces with
> emoji/brand emblem accents; the artwork remains in
> `assets/images/backgrounds/` unused, should it be reintroduced later.

| Screen | Asset |
|---|---|
| `(auth)/welcome` | `01_welcome_diaspora.png` |
| `(auth)/sign-up` | `02_global_connection.png` |
| `(onboarding)/country-origin` | `03_origin_heritage.png` |
| `(onboarding)/country-current` | `04_current_country.png` |
| `(onboarding)/community-preview` | `05_community_belonging.png` |
| `(onboarding)/profile` | `06_profile_setup.png` |
| `(onboarding)/complete` | `07_onboarding_complete.png` |

Presentation strategy (per spec — full-screen 9:16 assets):
- Each screen renders its artwork as a full-bleed background (`contentFit:
  cover`, centre-anchored so the subject survives different aspect ratios).
- A translucent scrim (`rgba(255,255,255,0.28)` light / `rgba(10,8,20,0.45)`
  dark, overridable) keeps text, inputs and list rows readable.
- No UI text/flags/buttons are embedded in images; flags + names render
  dynamically from backend `CountryView`/`CommunityView` data.

## 3. Screens implemented

| # | Screen | Route | Notes |
|---|---|---|---|
| 1 | Welcome | `(auth)/welcome` | Pre-auth intro: brand row, hero art, headline, "Get Started" → sign-up, "Log in" → login |
| 2 | Create account | `(auth)/sign-up` | Provider chooser: native Apple button, Google, "Sign up with Email" → register; legal copy |
| 3 | Country of origin | `(onboarding)/country-origin` | Art banner + searchable catalog list (taxonomy API) |
| 4 | Current country | `(onboarding)/country-current` | Same pattern; same country selectable |
| 5 | Community preview | `(onboarding)/community-preview` | Informational preview card: origin→dest flags, dynamic community name, "👑 Your default community" badge, ✓ explanation list |
| 6 | Complete profile | `(onboarding)/profile` | Photo picker (optional, real upload), display name, username w/ debounced availability, bio w/ 160-char counter, legal copy |
| 7 | You're in | `(onboarding)/complete` | Celebration art, "You've joined {community}" (live backend name), next-steps list, "Go to Home" |

`app/index.tsx` now routes unauthenticated users to `(auth)/welcome`
(previously straight to login).

## 4. Reusable components created / changed

- **`OnboardingArt`** (`src/shared/components/onboarding-art.tsx`) — banner/hero
  illustration container, aspect-preserved, rounded, theme-tinted.
- **`OnboardingIllustrations`** (`src/features/onboarding/illustrations.ts`) —
  typed asset registry.
- **`OnboardingProgress`** — added "N of 5" counter alongside the segmented bar
  (5 authenticated steps; welcome + create-account are pre-auth and show no
  progress, per spec).
- Reused unchanged: `SearchableList`, `FormInput`, `PrimaryButton`,
  `OnboardingHeader`, `ErrorState`, `LoadingScreen`, `safeBack`.

## 5. Navigation flow

```
unauthenticated → (auth)/welcome → (auth)/sign-up ─┬─ Apple/Google (Phase 2 flow)
                                                 └─ Email → (auth)/register → login
authenticated   → (onboarding): country-origin → country-current
                → community-preview → profile → complete → (app)/(tabs)
```

Resolver (`resolveOnboardingStep`) now orders preview **before** profile and
routes profile-complete-but-unjoined users to `complete`. Membership is only
created on the completion screen (`POST /me/onboarding/complete`,
backend-authoritative, idempotent) — never on the preview.

### Removed steps (per spec — not in the approved design)
- `(onboarding)/welcome` + the `welcomeSeen`/SecureStore machinery — welcome is
  now the pre-auth screen; authenticated onboarding starts at country-origin.
- `(onboarding)/languages` — not part of the 5 approved stages.
  `updatePreferredLanguage` remains in `SessionProvider` for a future settings
  surface; `taxonomy-api.languages()` is unused but retained.

## 6. Backend integration

- Country catalog: `GET /api/v1/taxonomy/countries` (existing).
- Community preview: `GET /api/v1/me/community-preview` (existing; dynamic
  flags + name — nothing hardcoded).
- Profile save: `PATCH /api/v1/me/profile` (existing).
- Completion: `POST /api/v1/me/onboarding/complete` → returns
  `{membership, community}` used for the "You've joined …" line; `refresh()`
  runs on "Go to Home" so the app lands on the new active community.

### Minimal backend change (documented, required)

Profile photo upload had no persistence path — `profile_media` was only read.
Added `avatarMediaId` (UUID) to `UpdateProfileRequest` +
`ProfileService.applyAvatar()`: validates the asset exists, belongs to the
caller, `purpose='AVATAR'`, `status='READY'`, then upserts
`profile_media(user_id,'AVATAR')`. Rejects invalid references with 400
`INVALID_AVATAR_MEDIA`. Mobile uploads via the existing 3-step
`/api/v1/media/uploads` flow (`purpose: 'AVATAR'`).

## 7. Responsive & accessibility

- `SafeAreaView` + `KeyboardAvoidingView` on all screens; scrollable where
  content can overflow; sticky footers keep CTAs reachable.
- Art scales via `contentFit` (contain/cover) — no distortion; banner height
  is capped so fields stay visible on small screens.
- Accessibility labels on art, back buttons, provider buttons, avatar picker;
  progressbar role + value on the step indicator.
- Light/dark: all chrome uses theme tokens; artwork is self-tinted inside a
  `primarySurface` card so it reads intentionally in both schemes.

## 8. Tests executed

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx expo lint` | 0 errors (10 pre-existing warnings in unrelated files) |
| `npx jest src/__tests__` | 76/76, 7 suites |
| `./mvnw -q compile` (backend) | clean |

`session-resolver.test.ts` rewritten for the new step order/resolver
signature (10 cases incl. profile-incomplete-with-membership edge).

## 9. Known limitations / remaining work

- **Terms/privacy links are styled but not linked** — no document URLs exist
  yet; wire to real destinations when available.
- **Country-specific artwork caveat** — `03`/`04` are Ethiopia/UK-themed but
  render for all country selections (per the supplied asset set). They are
  shown at banner prominence while the real country identity is carried by
  dynamic flags/names. If per-country art is wanted later, it needs new assets.
- **Avatar on resume** — if the user quits between upload and PATCH, the
  orphan asset is cleaned by the media TTL job (same as reels).
- **Not verified on-device** — screens were implemented to the reference but
  no emulator screenshots were captured in this pass; recommend a visual pass
  on Android/iOS before release.
