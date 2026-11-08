import React from "react";
import { Alert } from "react-native";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as Location from "expo-location";
import {
  profileRequestFrom,
  useSharedProfileForm,
} from "@/features/matchmaking/components/profile-form";
import {
  ACTIVITY_LEVELS,
  EDUCATION,
  HABITS,
  INTENTIONS,
  MARITAL_STATUSES,
  MARRIAGE_TIMELINES,
  RELIGION_IMPORTANCE,
  VISIBILITIES,
  WANTS_CHILDREN,
} from "@/features/matchmaking/types/matchmaking-options";

import MatchmakingEntryScreen from "@/features/matchmaking/screens/matchmaking-entry-screen";
import DiscoveryScreen from "@/features/matchmaking/screens/discovery-screen";
import MatchDetailScreen from "@/features/matchmaking/screens/match-detail-screen";
import SetupScreen from "@/features/matchmaking/screens/setup-screen";
import PreferencesScreen from "@/features/matchmaking/screens/preferences-screen";
import CandidateProfileScreen from "@/features/matchmaking/screens/candidate-profile-screen";
import { usePagedMatchmaking } from "@/features/matchmaking/hooks/use-paged-matchmaking";
import { pickAndUploadMatchmakingPhoto } from "@/features/matchmaking/services/matchmaking-media-api";
import { loadWizardDraft } from "@/features/matchmaking/utils/wizard-progress";
import { saveDiscoveryMode } from "@/features/matchmaking/utils/discovery-mode";
import { ApiError } from "@/core/api/api-error";
import type {
  MatchmakingEligibility,
  MatchmakingProfile,
  MatchView,
  PublicMatchmakingProfile,
  SwipeResult,
} from "@/features/matchmaking/types/matchmaking-types";

const mockClient = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};
const mockUpdateProfile = jest.fn();
let mockDateOfBirth = "1990-01-01";
let mockRouteParams: Record<string, string> = {
  matchId: "match-1",
  userId: "u2",
};

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockRouteParams,
  useFocusEffect: (callback: () => void) =>
    jest.requireActual("react").useEffect(callback, [callback]),
  usePreventRemove: jest.fn(),
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({
    apiClient: mockClient,
    updateProfile: mockUpdateProfile,
    session: {
      me: { id: "u1", email: "u1@test.com" },
      profile: {
        dateOfBirth: mockDateOfBirth,
        bio: "Existing story",
        city: "Lisbon",
        currentCountryId: "c1",
      },
    },
  }),
}));
jest.mock("@/features/matchmaking/hooks/use-matchmaking-realtime", () => ({
  useMatchmakingRealtime: () => {},
}));
jest.mock("@/features/matchmaking/services/matchmaking-media-api", () => ({
  pickAndUploadMatchmakingPhoto: jest.fn(),
}));
jest.mock("@/features/matchmaking/utils/wizard-progress", () => ({
  loadWizardDraft: jest.fn(async () => null),
  saveWizardDraft: jest.fn(async () => {}),
  clearWizardDraft: jest.fn(async () => {}),
}));

const candidate: PublicMatchmakingProfile = {
  userId: "u2",
  displayName: "Ada",
  photoUrl: null,
  genderKey: "WOMAN",
  age: 36,
  nationalityCountryId: null,
  religionId: null,
  educationLevel: null,
  occupation: "Engineer",
  relationshipIntention: "MARRIAGE",
  maritalStatus: null,
  hasChildren: false,
  wantsChildren: "UNSURE",
  smoking: "NO",
  drinking: "NO",
  activityLevel: "MODERATE",
  heightCm: 170,
  marriageTimeline: null,
  longDistanceRelationship: false,
  religionImportance: null,
  willingToRelocate: false,
  verificationStatus: "VERIFIED",
};

const ownProfile: MatchmakingProfile = {
  userId: "u1",
  genderKey: "WOMAN",
  addressId: null,
  nationalityCountryId: "c1",
  religionId: null,
  educationLevel: null,
  occupation: "Engineer",
  relationshipIntention: "MARRIAGE",
  maritalStatus: "NEVER_MARRIED",
  hasChildren: false,
  wantsChildren: "UNSURE",
  smoking: "NO",
  drinking: "NO",
  activityLevel: "MODERATE",
  heightCm: 170,
  marriageTimeline: null,
  longDistanceRelationship: false,
  religionImportance: null,
  willingToRelocate: false,
  photoMediaId: null,
  blurredPhotoMediaId: null,
  nameVisibility: "VISIBLE",
  photoVisibility: "HIDDEN",
  anonymousAlias: "Moon",
  verificationStatus: "NOT_VERIFIED",
  status: "DRAFT",
  activatedAt: null,
  lastActiveAt: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
};

const match: MatchView = {
  id: "match-1",
  status: "MATCHED",
  other: candidate,
  matchedAt: "2026-11-01T10:00:00Z",
  closedAt: null,
  conversationId: "conv-1",
};

const references = {
  genders: [],
  religions: [],
  countries: [],
  languages: [],
  addresses: [],
};
const compatibility = {
  interestIds: [],
  languageIds: [],
  interests: [{ id: "i1", label: "Travel" }],
  languages: [{ id: "l1", label: "English" }],
  hasDiscoveryLocation: false,
};

const wizardReferences = {
  genders: [
    { id: "WOMAN", label: "Woman" },
    { id: "MAN", label: "Man" },
  ],
  religions: [{ id: "r1", label: "Orthodox" }],
  countries: [
    { id: "c1", label: "Ethiopia" },
    { id: "c2", label: "Eritrea" },
  ],
  languages: [],
  addresses: [],
  profileOptions: Object.fromEntries(
    Object.entries({
      visibility: VISIBILITIES,
      education: EDUCATION,
      intentions: INTENTIONS,
      marital: MARITAL_STATUSES,
      wantsChildren: WANTS_CHILDREN,
      habits: HABITS,
      activity: ACTIVITY_LEVELS,
      timeline: MARRIAGE_TIMELINES,
      religionImportance: RELIGION_IMPORTANCE,
    }).map(([key, options]) => [
      key,
      options.map((option) => ({ id: option.value, label: option.label })),
    ]),
  ),
};

const eligibility = (
  overrides: Partial<MatchmakingEligibility>,
): MatchmakingEligibility => ({
  eligible: false,
  reason: "NO_PROFILE",
  profileStatus: null,
  verificationStatus: null,
  adult: true,
  hasDateOfBirth: true,
  discoveryOptIn: false,
  hasPreferences: false,
  ...overrides,
});
const ELIGIBLE = eligibility({
  eligible: true,
  reason: "ELIGIBLE",
  profileStatus: "ACTIVE",
  verificationStatus: "NOT_VERIFIED",
  discoveryOptIn: true,
  hasPreferences: true,
});

/** Routes GETs: eligibility for entry tests, discovery feeds, reference data. */
function mockGets(
  override: MatchmakingEligibility,
  discoverItems = [candidate],
) {
  mockClient.get.mockImplementation((path: string) => {
    if (path.endsWith("/api/v1/matchmaking/eligibility"))
      return Promise.resolve(override);
    if (path.startsWith("/api/v1/matchmaking/discover")) {
      return Promise.resolve({ items: discoverItems, nextCursor: null });
    }
    if (path.endsWith("/reference-data")) return Promise.resolve(references);
    return Promise.resolve({ items: [], nextCursor: null });
  });
}

async function mount(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {ui}
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDateOfBirth = "1990-01-01";
  mockRouteParams = { matchId: "match-1", userId: "u2" };
  mockUpdateProfile.mockResolvedValue(undefined);
  jest.mocked(loadWizardDraft).mockResolvedValue(null);
  saveDiscoveryMode("swipe");
});

afterEach(() => jest.restoreAllMocks());

describe("Dating entry — server-driven eligibility", () => {
  it("shows the intro screen when the user has no Dating profile", async () => {
    mockGets(eligibility({ reason: "NO_PROFILE" }));
    await mount(<MatchmakingEntryScreen />);
    expect(await screen.findByText("Find meaningful connections")).toBeTruthy();
    expect(screen.queryByText("Ada, 36")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Create Dating Profile"));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith(
      "/(app)/matchmaking/setup",
    );
  });

  it('offers "Complete your profile" when an onboarding draft exists', async () => {
    mockGets(eligibility({ reason: "NO_PROFILE" }));
    jest
      .mocked(loadWizardDraft)
      .mockResolvedValue({ step: 12, request: {} as never });
    await mount(<MatchmakingEntryScreen />);
    expect(await screen.findByLabelText("Complete your profile")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Complete your profile"));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith(
      "/(app)/matchmaking/setup",
    );
  });

  it("redirects an incomplete profile to setup", async () => {
    mockGets(
      eligibility({ reason: "PROFILE_INCOMPLETE", profileStatus: "DRAFT" }),
    );
    await mount(<MatchmakingEntryScreen />);
    await waitFor(() =>
      expect(jest.mocked(router.replace)).toHaveBeenCalledWith(
        "/(app)/matchmaking/setup",
      ),
    );
  });

  it("goes straight to Swipe Mode when the profile is eligible", async () => {
    mockGets(ELIGIBLE);
    await mount(<MatchmakingEntryScreen />);
    expect(await screen.findByText("Ada, 36")).toBeTruthy();
    const swipeTab = screen.getByLabelText("Swipe mode");
    expect(swipeTab.props.accessibilityState?.selected).toBe(true);
    expect(jest.mocked(router.replace)).not.toHaveBeenCalled();
  });

  it("shows a paused state with a resume action", async () => {
    mockGets(
      eligibility({ reason: "PROFILE_PAUSED", profileStatus: "PAUSED" }),
    );
    await mount(<MatchmakingEntryScreen />);
    expect(await screen.findByText("Dating is paused")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Resume Dating"));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith(
      "/(app)/matchmaking/profile",
    );
  });

  it("explains a suspended restriction without showing profiles", async () => {
    mockGets(
      eligibility({ reason: "PROFILE_SUSPENDED", profileStatus: "SUSPENDED" }),
    );
    await mount(<MatchmakingEntryScreen />);
    expect(await screen.findByText("Dating is unavailable")).toBeTruthy();
    expect(screen.queryByText("Ada, 36")).toBeNull();
    expect(
      mockClient.get.mock.calls.some((call) =>
        String(call[0]).startsWith("/api/v1/matchmaking/discover"),
      ),
    ).toBe(false);
  });

  it("blocks underage users at the entry gate", async () => {
    mockGets(eligibility({ reason: "NOT_ADULT", adult: false }));
    await mount(<MatchmakingEntryScreen />);
    expect(
      await screen.findByText("Matchmaking is for adults (18+)"),
    ).toBeTruthy();
  });

  it("shows the date-of-birth form instead of a restriction when DOB is missing", async () => {
    mockGets(
      eligibility({
        reason: "DOB_REQUIRED",
        adult: false,
        hasDateOfBirth: false,
      }),
    );
    await mount(<MatchmakingEntryScreen />);
    expect(await screen.findByText("When is your birthday?")).toBeTruthy();
    expect(screen.queryByText("Matchmaking is for adults (18+)")).toBeNull();
    expect(screen.queryByText("Find meaningful connections")).toBeNull();
    expect(screen.getByLabelText("Date")).toBeTruthy();
    expect(screen.getByLabelText("Month")).toBeTruthy();
    expect(screen.getByLabelText("Year")).toBeTruthy();

    // The year list tops out at current year − 18 — underage years aren't offered.
    const maxYear = new Date().getFullYear() - 18;
    await fireEvent.press(screen.getByLabelText("Year"));
    expect(await screen.findByLabelText(`Year: ${maxYear}`)).toBeTruthy();
    expect(screen.queryByLabelText(`Year: ${maxYear + 1}`)).toBeNull();
    await fireEvent.press(screen.getByLabelText(`Year: ${maxYear}`));
  });

  /** Selects 1 January 1990 through the three DOB dropdowns. */
  async function pickBirthDate() {
    await fireEvent.press(screen.getByLabelText("Month"));
    await fireEvent.press(await screen.findByLabelText("Month: January"));
    await fireEvent.press(screen.getByLabelText("Date"));
    await fireEvent.press(await screen.findByLabelText("Date: 1"));
    await fireEvent.press(screen.getByLabelText("Year"));
    await fireEvent.press(await screen.findByLabelText("Year: 1990"));
  }

  it("saves the submitted DOB once and re-resolves eligibility", async () => {
    let dobSaved = false;
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith("/api/v1/matchmaking/eligibility")) {
        return Promise.resolve(
          dobSaved
            ? eligibility({ reason: "NO_PROFILE" })
            : eligibility({
                reason: "DOB_REQUIRED",
                adult: false,
                hasDateOfBirth: false,
              }),
        );
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
    mockUpdateProfile.mockImplementation(() => {
      dobSaved = true;
      return Promise.resolve();
    });

    await mount(<MatchmakingEntryScreen />);
    await pickBirthDate();
    await fireEvent.press(screen.getByLabelText("Continue"));

    expect(mockUpdateProfile).toHaveBeenCalledWith({
      dateOfBirth: "1990-01-01",
    });
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Find meaningful connections")).toBeTruthy();
  });

  it("re-resolves eligibility instead of erroring when DOB was already stored", async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith("/api/v1/matchmaking/eligibility")) {
        return Promise.resolve(
          eligibility({
            reason: "DOB_REQUIRED",
            adult: false,
            hasDateOfBirth: false,
          }),
        );
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
    mockUpdateProfile.mockRejectedValue(
      new ApiError({
        code: "UNKNOWN",
        httpStatus: 409,
        message: "DATE_OF_BIRTH_ALREADY_SET",
      }),
    );

    await mount(<MatchmakingEntryScreen />);
    await pickBirthDate();
    await fireEvent.press(screen.getByLabelText("Continue"));

    // Conflict → treated as "already stored" → eligibility re-read, no error shown.
    await waitFor(() =>
      expect(
        mockClient.get.mock.calls.filter((call) =>
          String(call[0]).endsWith("/api/v1/matchmaking/eligibility"),
        ).length,
      ).toBeGreaterThan(1),
    );
    expect(
      screen.queryByText("Your date of birth could not be saved."),
    ).toBeNull();
    expect(await screen.findByText("When is your birthday?")).toBeTruthy();
  });

  it("re-enables discovery opt-in without leaving the flow", async () => {
    let optIn = false;
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith("/api/v1/matchmaking/eligibility")) {
        return Promise.resolve(
          optIn
            ? ELIGIBLE
            : eligibility({
                reason: "DISCOVERY_OPT_IN_REQUIRED",
                profileStatus: "ACTIVE",
                discoveryOptIn: false,
              }),
        );
      }
      if (path.startsWith("/api/v1/matchmaking/discover")) {
        return Promise.resolve({ items: [candidate], nextCursor: null });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
    mockClient.patch.mockImplementation(() => {
      optIn = true;
      return Promise.resolve({});
    });
    await mount(<MatchmakingEntryScreen />);
    expect(await screen.findByText("Discovery is turned off")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Turn on discovery"));
    expect(mockClient.patch).toHaveBeenCalledWith(
      "/api/v1/me/privacy-settings",
      { allowMatchmakingDiscovery: true },
      { authenticated: true },
    );
    expect(await screen.findByText("Ada, 36")).toBeTruthy();
  });

  it("shows a retry state when the eligibility read fails", async () => {
    mockClient.get.mockRejectedValue(ApiError.networkError(new Error("down")));
    await mount(<MatchmakingEntryScreen />);
    expect(await screen.findByText("Something went wrong")).toBeTruthy();
    mockGets(ELIGIBLE);
    await fireEvent.press(screen.getByLabelText("Try again"));
    expect(await screen.findByText("Ada, 36")).toBeTruthy();
  });
});

describe("Discovery — swipe and browse modes", () => {
  it("uses the compact header, persistent actions, and Dating bottom navigation", async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/matchmaking/discover")) {
        return Promise.resolve({ items: [candidate], nextCursor: null });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });

    await mount(<DiscoveryScreen />);
    expect(await screen.findByText("Ada, 36")).toBeTruthy();

    expect(screen.queryByText("Dating")).toBeNull();
    expect(
      screen.queryByText("Meet people who share your direction"),
    ).toBeNull();
    expect(screen.queryByText("Swipe")).toBeNull();
    expect(screen.queryByText("Browse")).toBeNull();
    expect(screen.getByLabelText("Discovery preferences")).toBeTruthy();
    expect(screen.getByLabelText("Rewind latest swipe")).toBeTruthy();
    expect(screen.getByLabelText("Pass on Ada")).toBeTruthy();
    expect(screen.getByLabelText("Like Ada")).toBeTruthy();
    expect(screen.getByText("Discover")).toBeTruthy();
    expect(screen.getByText("Matches")).toBeTruthy();
    expect(screen.getByLabelText("Dating messages")).toBeTruthy();
    expect(screen.getByText("Likes")).toBeTruthy();
    expect(screen.getByText("Profile")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Dating matches"));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith(
      "/(app)/matchmaking/matches",
    );
    await fireEvent.press(screen.getByLabelText("Dating messages"));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith(
      "/(app)/(tabs)/messages",
    );
    await fireEvent.press(screen.getByLabelText("Dating profile"));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith(
      "/(app)/matchmaking/profile",
    );
  });

  it("prevents duplicate likes and opens the mutual match conversation", async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/matchmaking/discover")) {
        return Promise.resolve({ items: [candidate], nextCursor: null });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
    const result: SwipeResult = {
      action: "LIKE",
      status: "ACTIVE",
      matched: true,
      matchId: "match-1",
      conversationId: "conv-1",
    };
    let resolveSwipe!: (value: SwipeResult) => void;
    const pending = new Promise<SwipeResult>((resolve) => {
      resolveSwipe = resolve;
    });
    mockClient.post.mockReturnValue(pending);

    await mount(<DiscoveryScreen />);
    await fireEvent.press(await screen.findByLabelText("Browse mode"));
    const like = await screen.findByLabelText("Like Ada");
    await fireEvent.press(like, { stopPropagation: jest.fn() });
    await fireEvent.press(like, { stopPropagation: jest.fn() });
    expect(
      mockClient.post.mock.calls.filter(
        (call) => call[0] === "/api/v1/matchmaking/swipes",
      ),
    ).toHaveLength(1);

    await act(async () => {
      resolveSwipe(result);
      await pending;
    });
    expect(await screen.findByText("You have a new mutual match")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Open chat"));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith(
      "/(app)/messages/conv-1",
    );
  });

  it("remembers the selected discovery mode across remounts", async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/matchmaking/discover")) {
        return Promise.resolve({ items: [candidate], nextCursor: null });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
    const first = await mount(<DiscoveryScreen />);
    await fireEvent.press(await screen.findByLabelText("Browse mode"));
    await act(async () => {
      first.unmount();
    });

    await mount(<DiscoveryScreen />);
    expect(
      (await screen.findByLabelText("Browse mode")).props.accessibilityState
        ?.selected,
    ).toBe(true);
    expect(
      screen.getByLabelText("Swipe mode").props.accessibilityState?.selected,
    ).toBe(false);
  });

  it("defaults to swipe mode, switches to browse and back without refetching", async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/matchmaking/discover")) {
        return Promise.resolve({ items: [candidate], nextCursor: null });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
    await mount(<DiscoveryScreen />);
    expect(
      (await screen.findByLabelText("Swipe mode")).props.accessibilityState
        ?.selected,
    ).toBe(true);
    expect(await screen.findByText("Ada, 36")).toBeTruthy();
    const discoverCalls = () =>
      mockClient.get.mock.calls.filter((call) =>
        String(call[0]).startsWith("/api/v1/matchmaking/discover"),
      ).length;
    const initialCalls = discoverCalls();

    await fireEvent.press(screen.getByLabelText("Browse mode"));
    expect(
      screen.getByLabelText("Browse mode").props.accessibilityState?.selected,
    ).toBe(true);
    expect(await screen.findByLabelText("Like Ada")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Swipe mode"));
    expect(
      screen.getByLabelText("Swipe mode").props.accessibilityState?.selected,
    ).toBe(true);
    expect(discoverCalls()).toBe(initialCalls);
  });

  it("records a pass in browse mode", async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/matchmaking/discover")) {
        return Promise.resolve({ items: [candidate], nextCursor: null });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
    mockClient.post.mockResolvedValue({
      action: "PASS",
      status: "ACTIVE",
      matched: false,
      matchId: null,
      conversationId: null,
    });
    await mount(<DiscoveryScreen />);
    await fireEvent.press(await screen.findByLabelText("Browse mode"));
    await fireEvent.press(await screen.findByLabelText("Pass on Ada"), {
      stopPropagation: jest.fn(),
    });
    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/matchmaking/swipes",
        { targetUserId: "u2", action: "PASS" },
        { authenticated: true },
      ),
    );
    await waitFor(() => expect(screen.queryByText("Ada, 36")).toBeNull());
  });

  it("retains a failed swipe and retries the same decision", async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/matchmaking/discover")) {
        return Promise.resolve({ items: [candidate], nextCursor: null });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
    mockClient.post
      .mockRejectedValueOnce(ApiError.networkError(new Error("offline")))
      .mockResolvedValue({
        action: "LIKE",
        status: "ACTIVE",
        matched: false,
        matchId: null,
        conversationId: null,
      });
    await mount(<DiscoveryScreen />);
    await fireEvent.press(await screen.findByLabelText("Browse mode"));
    await fireEvent.press(await screen.findByLabelText("Like Ada"), {
      stopPropagation: jest.fn(),
    });
    const retry = await screen.findByLabelText("Retry like for Ada");
    expect(screen.getByText("Ada, 36")).toBeTruthy();
    await fireEvent.press(retry);
    await waitFor(() => expect(screen.queryByText("Ada, 36")).toBeNull());
    expect(
      mockClient.post.mock.calls.filter(
        (call) => call[0] === "/api/v1/matchmaking/swipes",
      ),
    ).toHaveLength(2);
  });

  it("shows the active profile details below the swipe card and opens the full profile", async () => {
    const detailedCandidate = {
      ...candidate,
      bio: "Building a meaningful life with someone kind.",
      interests: ["Travel", "Food"],
      publicLocation: "Lisbon",
    };
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/matchmaking/discover")) {
        return Promise.resolve({
          items: [detailedCandidate],
          nextCursor: null,
        });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });

    await mount(<DiscoveryScreen />);

    expect(await screen.findByText("About Ada")).toBeTruthy();
    expect(screen.getByText("At a glance")).toBeTruthy();
    expect(screen.getAllByText("Travel").length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByLabelText("View Ada's profile"));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith(
      "/(app)/matchmaking/profile/u2",
    );
  });

  it("keeps browse cards compact — only photo, name, age and address", async () => {
    const detailedCandidate = {
      ...candidate,
      bio: "Sunday markets, long walks and honest conversation.",
      interests: ["Travel"],
      publicLocation: "Lisbon",
    };
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/matchmaking/discover")) {
        return Promise.resolve({
          items: [detailedCandidate],
          nextCursor: null,
        });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });

    await mount(<DiscoveryScreen />);
    await fireEvent.press(await screen.findByLabelText("Browse mode"));

    expect(await screen.findByText("Ada, 36")).toBeTruthy();
    expect(screen.getByText("Lisbon")).toBeTruthy();
    expect(
      screen.queryByText("Sunday markets, long walks and honest conversation."),
    ).toBeNull();
    expect(screen.queryByText("Travel")).toBeNull();
    expect(screen.queryByLabelText("More about Ada")).toBeNull();

    await fireEvent.press(screen.getByLabelText("View Ada's profile"));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith(
      "/(app)/matchmaking/profile/u2",
    );
  });

  it("cancels an outgoing like and removes it from the sent list", async () => {
    let cancelled = false;
    mockClient.get.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/matchmaking/likes/sent")) {
        return Promise.resolve({
          items: cancelled ? [] : [candidate],
          nextCursor: null,
        });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
    mockClient.delete.mockImplementation(() => {
      cancelled = true;
      return Promise.resolve({});
    });
    await mount(<DiscoveryScreen />);
    await fireEvent.press(screen.getByLabelText("Dating likes"));
    await fireEvent.press(screen.getByText("Sent"));
    await fireEvent.press(await screen.findByLabelText("Cancel like to Ada"));
    await waitFor(() =>
      expect(mockClient.delete).toHaveBeenCalledWith(
        "/api/v1/matchmaking/likes/u2",
        { authenticated: true },
      ),
    );
    expect(await screen.findByText("No outgoing likes")).toBeTruthy();
  });

  it("reloads from the received-likes endpoint when the tab changes", async () => {
    mockClient.get.mockResolvedValue({ items: [], nextCursor: null });
    await mount(<DiscoveryScreen />);
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        "/api/v1/matchmaking/discover?limit=20",
        { authenticated: true },
      ),
    );

    await fireEvent.press(screen.getByLabelText("Dating likes"));
    await waitFor(() =>
      expect(mockClient.get).toHaveBeenCalledWith(
        "/api/v1/matchmaking/likes/received?limit=20",
        { authenticated: true },
      ),
    );
  });
});

describe("Candidate profile deep-link gate", () => {
  function mockCandidateProfile() {
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith("/api/v1/matchmaking/profiles/u2")) {
        return Promise.resolve({
          ...candidate,
          bio: "Building a meaningful life with someone kind.",
          interests: ["Travel"],
          publicLocation: "Lisbon",
        });
      }
      if (path.endsWith("/reference-data")) return Promise.resolve(references);
      return Promise.resolve({ items: [], nextCursor: null });
    });
  }

  it("shows rich profile details and supports like cancellation", async () => {
    mockCandidateProfile();
    mockClient.post.mockResolvedValue({
      action: "LIKE",
      status: "ACTIVE",
      matched: false,
      matchId: null,
      conversationId: null,
    });
    mockClient.delete.mockResolvedValue({});

    await mount(<CandidateProfileScreen />);

    expect(await screen.findByText("About Ada")).toBeTruthy();
    expect(screen.getByText("Travel")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Like"));
    expect(await screen.findByText("Like sent")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Cancel like"));
    await waitFor(() =>
      expect(mockClient.delete).toHaveBeenCalledWith(
        "/api/v1/matchmaking/likes/u2",
        { authenticated: true },
      ),
    );
  });

  it("opens report and block actions from the floating safety menu", async () => {
    mockCandidateProfile();
    await mount(<CandidateProfileScreen />);

    await fireEvent.press(
      await screen.findByLabelText("Profile safety options"),
    );

    expect(await screen.findByLabelText("Report member")).toBeTruthy();
    expect(screen.getByLabelText("Block member")).toBeTruthy();
  });

  it("routes an ineligible viewer through the Dating entry screen", async () => {
    mockClient.get.mockRejectedValue(
      new ApiError({ code: "FORBIDDEN", httpStatus: 403 }),
    );
    await mount(<CandidateProfileScreen />);
    await waitFor(() =>
      expect(jest.mocked(router.replace)).toHaveBeenCalledWith(
        "/(app)/matchmaking",
      ),
    );
  });
});

describe("Setup adult gate", () => {
  it("blocks setup for an underage profile", async () => {
    mockDateOfBirth = "2015-01-01";
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith("/eligibility"))
        return Promise.resolve(
          eligibility({ reason: "NOT_ADULT", adult: false }),
        );
      if (path.endsWith("/reference-data")) return Promise.resolve(references);
      if (path.endsWith("/privacy-settings")) {
        return Promise.resolve({ allowMatchmakingDiscovery: false });
      }
      return Promise.reject(
        new ApiError({ code: "NOT_FOUND", httpStatus: 404 }),
      );
    });
    await mount(<SetupScreen />);
    expect(
      await screen.findByText("Matchmaking is for adults (18+)"),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Save and set preferences")).toBeNull();
  });
});

describe("Setup wizard — step-by-step profile creation", () => {
  function mockSetupGets() {
    let profileExists = false;
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith("/eligibility"))
        return Promise.resolve(eligibility({}));
      if (path.endsWith("/reference-data"))
        return Promise.resolve(wizardReferences);
      if (path.endsWith("/matchmaking/profile")) {
        return profileExists
          ? Promise.resolve(ownProfile)
          : Promise.reject(
              new ApiError({ code: "NOT_FOUND", httpStatus: 404 }),
            );
      }
      if (path.endsWith("/compatibility"))
        return Promise.resolve(compatibility);
      if (path.endsWith("/privacy-settings")) {
        return Promise.resolve({ allowMatchmakingDiscovery: false });
      }
      return Promise.reject(
        new ApiError({ code: "NOT_FOUND", httpStatus: 404 }),
      );
    });
    mockClient.put.mockImplementation((path: string) => {
      if (path.endsWith("/matchmaking/profile")) profileExists = true;
      return Promise.resolve({});
    });
  }

  const continueWizard = async () => {
    await fireEvent.press(screen.getByLabelText("Continue"));
  };

  it("walks the guided steps, validates required answers, then saves the draft", async () => {
    mockSetupGets();
    await mount(<SetupScreen />);

    // Step 1 — gender cards. Continue stays disabled until a card is picked.
    expect(
      await screen.findByLabelText("Profile question 1 of 14"),
    ).toBeTruthy();
    expect(screen.getByText("Which gender do you identify with?")).toBeTruthy();
    expect(
      screen.getByLabelText("Continue").props.accessibilityState.disabled,
    ).toBe(true);
    await fireEvent.press(screen.getByLabelText("Woman"));
    expect(
      screen.getByLabelText("Continue").props.accessibilityState.disabled,
    ).toBe(false);
    await continueWizard();

    // Step 2 — alias is required.
    expect(
      await screen.findByLabelText("Profile question 2 of 14"),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Continue").props.accessibilityState.disabled,
    ).toBe(true);
    await fireEvent.changeText(
      screen.getByLabelText("Nickname (required)"),
      "Moon",
    );
    expect(
      screen.getByLabelText("Continue").props.accessibilityState.disabled,
    ).toBe(false);
    await continueWizard();

    // Step 3 — intention cards.
    expect(
      await screen.findByLabelText("Profile question 3 of 14"),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Marriage"));
    await continueWizard();

    // Step 4 — marital status rows.
    expect(
      await screen.findByLabelText("Profile question 4 of 14"),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText("Marital status: Never married"),
    );
    await continueWizard();

    // Step 5 — children.
    expect(
      await screen.findByLabelText("Profile question 5 of 14"),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Have children: No"));
    await fireEvent.press(
      screen.getByLabelText("Would you like children?: Unsure"),
    );
    await continueWizard();

    // Steps 6–8 — timeline, distance toggles, origin pickers.
    await continueWizard();
    await continueWizard();

    // Step 8 — nationality is a searchable dropdown.
    expect(
      await screen.findByLabelText("Profile question 8 of 14"),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Nationality: choose"));
    await fireEvent.press(
      await screen.findByLabelText("Nationality: Ethiopia"),
    );
    await continueWizard();

    // Back navigation preserves earlier answers.
    expect(
      await screen.findByLabelText("Profile question 9 of 14"),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Back"));
    expect(
      await screen.findByLabelText("Profile question 8 of 14"),
    ).toBeTruthy();
    // The closed picker still shows the selected nationality.
    expect(screen.getByLabelText("Nationality: Ethiopia")).toBeTruthy();
    await continueWizard();

    // Faith, work, body and habits lead into the shared-profile questions.
    for (let i = 0; i < 4; i++) await continueWizard();
    expect(
      await screen.findByLabelText("Profile question 13 of 14"),
    ).toBeTruthy();
    expect(screen.getByLabelText("About me").props.value).toBe(
      "Existing story",
    );
    await fireEvent.changeText(
      screen.getByLabelText("About me"),
      "A new story",
    );
    await continueWizard();
    await fireEvent.press(screen.getByLabelText("Your interests: Travel"));
    await fireEvent.press(screen.getByLabelText("Your languages: English"));
    await continueWizard();
    await fireEvent.changeText(screen.getByLabelText("City"), "Porto");
    await continueWizard();
    expect(await screen.findByLabelText("Step 3 of 5")).toBeTruthy();
    await continueWizard();
    await continueWizard();
    expect(await screen.findByLabelText("Step 4 of 5")).toBeTruthy();
    expect(screen.getByText("Ready for your next chapter?")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Save and set preferences"));
    await waitFor(() =>
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/matchmaking/profile",
        expect.objectContaining({
          status: "DRAFT",
          anonymousAlias: "Moon",
          genderKey: "WOMAN",
          nationalityCountryId: "c1",
          hasChildren: false,
          wantsChildren: "UNSURE",
          maritalStatus: "NEVER_MARRIED",
          relationshipIntention: "MARRIAGE",
        }),
        { authenticated: true },
      ),
    );
    expect(mockUpdateProfile).toHaveBeenCalledWith({
      bio: "A new story",
      city: "Porto",
      currentCountryId: "c1",
    });
    expect(mockClient.put).toHaveBeenCalledWith(
      "/api/v1/me/profile/compatibility",
      { interestIds: ["i1"], languageIds: ["l1"] },
      { authenticated: true },
    );
    expect(await screen.findByLabelText("Step 5 of 5")).toBeTruthy();
    expect(screen.getByText("Who would you like to meet?")).toBeTruthy();
  }, 20000);

  it("finishes photo onboarding with a single original upload — no blurred slot", async () => {
    mockSetupGets();
    jest
      .mocked(pickAndUploadMatchmakingPhoto)
      .mockResolvedValue({ assetId: "photo-1", localUri: "file://p.jpg" });
    await mount(<SetupScreen />);

    await screen.findByLabelText("Profile question 1 of 14");
    await fireEvent.press(screen.getByLabelText("Woman"));
    await continueWizard();
    await fireEvent.changeText(
      screen.getByLabelText("Nickname (required)"),
      "Moon",
    );
    for (let i = 0; i < 14; i++) await continueWizard();

    // The photo stage has one original upload and no separate blurred slot.
    expect(await screen.findByLabelText("Step 3 of 5")).toBeTruthy();
    expect(screen.queryByText("Blurred photo")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Add photo"));
    await waitFor(() =>
      expect(jest.mocked(pickAndUploadMatchmakingPhoto)).toHaveBeenCalled(),
    );
    expect(await screen.findByText("Blurred — protected")).toBeTruthy();
    expect(screen.getByText("Visible — original")).toBeTruthy();

    for (let i = 0; i < 2; i++) await continueWizard();
    await fireEvent.press(screen.getByLabelText("Save and set preferences"));
    await waitFor(() =>
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/matchmaking/profile",
        expect.objectContaining({ photoMediaId: "photo-1" }),
        { authenticated: true },
      ),
    );
    const body = mockClient.put.mock.calls.find(
      (call) => call[0] === "/api/v1/matchmaking/profile",
    )?.[1];
    expect(body).not.toHaveProperty("blurredPhotoMediaId");
  });

  it("validates the optional height input in place", async () => {
    mockSetupGets();
    await mount(<SetupScreen />);
    await screen.findByLabelText("Profile question 1 of 14");
    await fireEvent.press(screen.getByLabelText("Man"));
    await continueWizard();
    await fireEvent.changeText(
      screen.getByLabelText("Nickname (required)"),
      "Sun",
    );
    for (let i = 0; i < 9; i++) await continueWizard();

    // Step 11 — invalid height blocks Continue with an inline message.
    expect(
      await screen.findByLabelText("Profile question 11 of 14"),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Height"), "999");
    expect(
      await screen.findByText(
        "Height must be a whole number between 80 and 250 cm.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Continue").props.accessibilityState.disabled,
    ).toBe(true);

    await fireEvent.changeText(screen.getByLabelText("Height"), "172");
    await continueWizard();
    expect(
      await screen.findByLabelText("Profile question 12 of 14"),
    ).toBeTruthy();
  });

  it("resumes at preferences after the profile stage and can navigate back", async () => {
    mockSetupGets();
    const setupGet = mockClient.get.getMockImplementation();
    mockClient.get.mockImplementation((path: string) =>
      path.endsWith("/matchmaking/profile")
        ? Promise.resolve(ownProfile)
        : setupGet?.(path),
    );
    jest.mocked(loadWizardDraft).mockResolvedValue({
      step: 17,
      stepKey: "participation",
      request: profileRequestFrom(ownProfile, wizardReferences),
      profileSaved: true,
    });

    await mount(<SetupScreen />);
    expect(await screen.findByLabelText("Step 5 of 5")).toBeTruthy();
    expect(screen.queryByText("Which gender do you identify with?")).toBeNull();

    await fireEvent.press(screen.getByLabelText("Back"));
    expect(
      await screen.findByText("Ready for your next chapter?"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Step 4 of 5")).toBeTruthy();
  });
});

describe("Profile preview and activation", () => {
  it("shows the server preview before explicitly opting in and activating", async () => {
    mockRouteParams = { activate: "true" };
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith("/matchmaking/profile"))
        return Promise.resolve(ownProfile);
      if (path.endsWith("/matchmaking/preferences")) {
        return Promise.resolve({
          userId: "u1",
          minAge: 18,
          maxAge: 110,
          maxDistanceKm: null,
          showVerifiedOnly: false,
          hasChildrenPreference: "ANY",
          wantsChildrenPreference: "ANY",
          genderKeys: [],
          religionIds: [],
          languageIds: [],
        });
      }
      if (path.endsWith("/reference-data"))
        return Promise.resolve(wizardReferences);
      if (path.endsWith("/matchmaking/profile/preview"))
        return Promise.resolve(candidate);
      return Promise.reject(new Error("unexpected " + path));
    });
    mockClient.put.mockResolvedValue({});
    mockClient.patch.mockResolvedValue({ allowMatchmakingDiscovery: true });
    await mount(<PreferencesScreen />);
    fireEvent(await screen.findByLabelText("Minimum age"), "valueChange", 26);
    await fireEvent.press(
      await screen.findByLabelText("Save and preview profile"),
    );
    expect(mockClient.put).toHaveBeenCalledWith(
      "/api/v1/matchmaking/preferences",
      expect.objectContaining({ minAge: 26 }),
      { authenticated: true },
    );
    expect(await screen.findByLabelText("Activate my profile")).toBeTruthy();
    expect(mockClient.patch).not.toHaveBeenCalled();
    expect(mockClient.put).not.toHaveBeenCalledWith(
      "/api/v1/matchmaking/profile",
      expect.anything(),
      expect.anything(),
    );
    await fireEvent.press(screen.getByLabelText("Activate my profile"));
    await waitFor(() =>
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/matchmaking/profile",
        expect.objectContaining({ status: "ACTIVE" }),
        { authenticated: true },
      ),
    );
    expect(mockClient.patch).toHaveBeenCalledWith(
      "/api/v1/me/privacy-settings",
      { allowMatchmakingDiscovery: true },
      { authenticated: true },
    );
    expect(jest.mocked(router.replace)).toHaveBeenCalledWith(
      "/(app)/matchmaking",
    );
  });
});

describe("Discovery preferences sheet", () => {
  function mockPreferenceGets() {
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith("/matchmaking/profile"))
        return Promise.resolve(ownProfile);
      if (path.endsWith("/matchmaking/preferences"))
        return Promise.resolve({
          userId: "u1",
          minAge: 24,
          maxAge: 40,
          maxDistanceKm: 75,
          showVerifiedOnly: true,
          hasChildrenPreference: "ANY",
          wantsChildrenPreference: "YES",
          genderKeys: ["MAN"],
          religionIds: [],
          languageIds: [],
        });
      if (path.endsWith("/reference-data"))
        return Promise.resolve(wizardReferences);
      if (path.endsWith("/compatibility"))
        return Promise.resolve(compatibility);
      return Promise.reject(
        new ApiError({ code: "NOT_FOUND", httpStatus: 404 }),
      );
    });
    mockClient.put.mockResolvedValue({});
  }

  it("renders the accent sections and saves the local draft on Save", async () => {
    mockPreferenceGets();
    await mount(<PreferencesScreen />);

    expect(await screen.findByText("Show me")).toBeTruthy();
    expect(screen.getByText("Age range")).toBeTruthy();
    expect(screen.getByText("Location & distance")).toBeTruthy();
    expect(screen.getByText("Quality filters")).toBeTruthy();
    expect(screen.getByText("Family & children")).toBeTruthy();
    expect(screen.getByText("Religion")).toBeTruthy();
    expect(screen.getByText("Languages")).toBeTruthy();
    expect(screen.getByLabelText("Save")).toBeTruthy();

    // Edits are local until Save is pressed.
    await fireEvent.press(screen.getByLabelText("Genders: Woman"));
    expect(mockClient.put).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Save preferences"));
    await waitFor(() =>
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/matchmaking/preferences",
        expect.objectContaining({
          genderKeys: ["MAN", "WOMAN"],
          showVerifiedOnly: true,
        }),
        { authenticated: true },
      ),
    );
    expect(jest.mocked(router.back)).toHaveBeenCalled();
  });

  it("confirms, then resets and saves the defaults immediately", async () => {
    mockPreferenceGets();
    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation(() => {});
    await mount(<PreferencesScreen />);
    await screen.findByText("Age range");

    await fireEvent.press(screen.getByLabelText("Reset to defaults"));
    expect(alertSpy).toHaveBeenCalledWith(
      "Reset preferences?",
      expect.any(String),
      expect.any(Array),
    );
    expect(mockClient.put).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] ?? [];
    await act(async () => {
      buttons
        .find((button) => button.style === "destructive")
        ?.onPress?.();
    });
    await waitFor(() =>
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/matchmaking/preferences",
        expect.objectContaining({
          minAge: 18,
          maxAge: 110,
          maxDistanceKm: null,
          showVerifiedOnly: false,
        }),
        { authenticated: true },
      ),
    );
  });
});

describe("Matchmaking pagination", () => {
  type ItemPage = { items: { id: string }[]; nextCursor: string | null };
  type ItemFetcher = (cursor?: string) => Promise<ItemPage>;

  it("uses the opaque cursor and deduplicates overlapping items", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({
        items: [{ id: "one" }],
        nextCursor: "next-cursor",
      })
      .mockResolvedValueOnce({
        items: [{ id: "one" }, { id: "two" }],
        nextCursor: null,
      });
    const hook = await renderHook(() =>
      usePagedMatchmaking(
        fetcher,
        (item: { id: string }) => item.id,
        "Could not load.",
      ),
    );
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));

    await act(async () => {
      hook.result.current.loadMore();
    });
    await waitFor(() =>
      expect(hook.result.current.items.map((item) => item.id)).toEqual([
        "one",
        "two",
      ]),
    );
    expect(fetcher).toHaveBeenNthCalledWith(2, "next-cursor");
  });

  it("ignores a stale response after the fetcher changes", async () => {
    let resolveOld!: (page: {
      items: { id: string }[];
      nextCursor: null;
    }) => void;
    const oldFetch: ItemFetcher = jest.fn(
      () =>
        new Promise<ItemPage>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const newFetch: ItemFetcher = jest.fn(async () => ({
      items: [{ id: "new" }],
      nextCursor: null,
    }));
    const hook = await renderHook(
      ({ fetcher }: { fetcher: ItemFetcher }) =>
        usePagedMatchmaking(
          fetcher,
          (item: { id: string }) => item.id,
          "Could not load.",
        ),
      { initialProps: { fetcher: oldFetch } },
    );
    await act(async () => {
      hook.rerender({ fetcher: newFetch });
    });
    await act(async () => {
      resolveOld({ items: [{ id: "old" }], nextCursor: null });
    });
    await waitFor(() =>
      expect(hook.result.current.items.map((item) => item.id)).toEqual(["new"]),
    );
    expect(newFetch).toHaveBeenCalled();
  });

  it("reconciles instead of restoring a candidate removed during pagination", async () => {
    let resolvePage!: (page: {
      items: { id: string }[];
      nextCursor: null;
    }) => void;
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "one" }], nextCursor: "next" })
      .mockImplementationOnce(
        () =>
          new Promise<{ items: { id: string }[]; nextCursor: null }>(
            (resolve) => {
              resolvePage = resolve;
            },
          ),
      )
      .mockResolvedValueOnce({ items: [{ id: "two" }], nextCursor: null });
    const hook = await renderHook(() =>
      usePagedMatchmaking(
        fetcher,
        (item: { id: string }) => item.id,
        "Could not load.",
      ),
    );
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    await act(async () => {
      hook.result.current.loadMore();
    });
    await waitFor(() => expect(hook.result.current.loadingMore).toBe(true));
    await act(async () => {
      hook.result.current.remove("one");
    });
    await act(async () => {
      resolvePage({ items: [{ id: "one" }, { id: "two" }], nextCursor: null });
    });
    await waitFor(() =>
      expect(hook.result.current.items.map((item) => item.id)).toEqual(["two"]),
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("retains loaded items and retries a failed next page", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "one" }], nextCursor: "next" })
      .mockRejectedValueOnce(ApiError.networkError(new Error("offline")))
      .mockResolvedValueOnce({ items: [{ id: "two" }], nextCursor: null });
    const hook = await renderHook(() =>
      usePagedMatchmaking(
        fetcher,
        (item: { id: string }) => item.id,
        "Could not load.",
      ),
    );
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    await act(async () => {
      hook.result.current.loadMore();
    });
    await waitFor(() => expect(hook.result.current.error).toBeTruthy());
    expect(hook.result.current.items.map((item) => item.id)).toEqual(["one"]);
    await act(async () => {
      hook.result.current.retry();
    });
    await waitFor(() =>
      expect(hook.result.current.items.map((item) => item.id)).toEqual([
        "one",
        "two",
      ]),
    );
    expect(fetcher).toHaveBeenNthCalledWith(3, "next");
  });
});

describe("Shared profile and recovery", () => {
  it("confirms saved adulthood explicitly and rechecks entry", async () => {
    let confirmed = false;
    mockClient.get.mockImplementation(() =>
      Promise.resolve(
        eligibility({
          reason: confirmed ? "NO_PROFILE" : "AGE_CONFIRMATION_REQUIRED",
          adult: confirmed,
        }),
      ),
    );
    mockClient.post.mockImplementation(() => {
      confirmed = true;
      return Promise.resolve({ confirmed: true });
    });
    await mount(<MatchmakingEntryScreen />);
    await fireEvent.press(
      await screen.findByLabelText("I confirm I am 18 or older"),
    );
    expect(mockClient.post).toHaveBeenCalledWith(
      "/api/v1/me/profile/age-confirmation",
      { confirmed: true },
      { authenticated: true },
    );
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(await screen.findByText("Find meaningful connections")).toBeTruthy();
  });

  it("retains changes after partial shared-profile save failure and retries", async () => {
    mockClient.get.mockResolvedValue(compatibility);
    mockClient.put
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(compatibility);
    const hook = await renderHook(useSharedProfileForm);
    await waitFor(() =>
      expect(hook.result.current.catalog).toEqual(compatibility),
    );
    await act(async () => hook.result.current.change({ bio: "Updated" }));
    await act(async () => {
      expect(await hook.result.current.save()).toBe(false);
    });
    expect(hook.result.current.dirty).toBe(true);
    expect(hook.result.current.form.bio).toBe("Updated");
    await act(async () => {
      expect(await hook.result.current.save()).toBe(true);
    });
    expect(hook.result.current.dirty).toBe(false);
  });

  it("does not submit coordinates without foreground permission", async () => {
    mockClient.get.mockResolvedValue(compatibility);
    jest
      .mocked(Location.requestForegroundPermissionsAsync)
      .mockResolvedValue({ granted: false } as never);
    const hook = await renderHook(useSharedProfileForm);
    await waitFor(() =>
      expect(hook.result.current.catalog).toEqual(compatibility),
    );
    await act(async () => {
      await hook.result.current.locate();
    });
    expect(mockClient.put).not.toHaveBeenCalled();
    expect(hook.result.current.error).toContain("permission was declined");
  });

  it("migrates valid legacy drafts and strips protected fields", async () => {
    const storage = jest.requireActual(
      "@/features/matchmaking/utils/wizard-progress",
    ) as typeof import("@/features/matchmaking/utils/wizard-progress");
    jest.spyOn(SecureStore, "getItemAsync").mockResolvedValue(
      JSON.stringify({
        step: 13,
        request: {
          status: "DRAFT",
          genderKey: "WOMAN",
          anonymousAlias: "Moon",
          nameVisibility: "HIDDEN",
          photoVisibility: "HIDDEN",
          verificationStatus: "VERIFIED",
          userId: "someone-else",
        },
      }),
    );
    const draft = await storage.loadWizardDraft("legacy-user");
    expect(draft?.stepKey).toBe("privacy");
    expect(draft?.request).not.toHaveProperty("verificationStatus");
    expect(draft?.request).not.toHaveProperty("userId");
  });

  it("serializes a pending save before clearing the same user draft", async () => {
    const storage = jest.requireActual(
      "@/features/matchmaking/utils/wizard-progress",
    ) as typeof import("@/features/matchmaking/utils/wizard-progress");
    let release!: () => void;
    const writing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = jest
      .spyOn(SecureStore, "setItemAsync")
      .mockReturnValue(writing);
    const clear = jest
      .spyOn(SecureStore, "deleteItemAsync")
      .mockResolvedValue();
    const save = storage.saveWizardDraft("queue-user", {
      step: 0,
      request: {} as never,
    });
    const clearing = storage.clearWizardDraft("queue-user");
    await Promise.resolve();
    expect(write).toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    release();
    await Promise.all([save, clearing]);
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

describe("Match detail continuity", () => {
  it("confirms unmatch, closes chat entry, and removes the active badge", async () => {
    mockClient.get.mockImplementation((path: string) => {
      if (path.endsWith("/reference-data")) return Promise.resolve(references);
      if (path.endsWith("/matches/match-1")) return Promise.resolve(match);
      return Promise.reject(new Error("unexpected " + path));
    });
    mockClient.post.mockResolvedValue({
      ...match,
      status: "UNMATCHED",
      conversationId: null,
      closedAt: "2026-11-02T10:00:00Z",
    });

    await mount(<MatchDetailScreen />);
    expect(await screen.findByTestId("matched-badge")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Unmatch"));
    expect(mockClient.post).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Confirm unmatch"));

    await waitFor(() =>
      expect(screen.queryByTestId("matched-badge")).toBeNull(),
    );
    expect(mockClient.post).toHaveBeenCalledWith(
      "/api/v1/matchmaking/matches/match-1/unmatch",
      {},
      { authenticated: true },
    );
    expect(screen.queryByLabelText("Open chat")).toBeNull();
  });
});
