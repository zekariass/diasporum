/**
 * Events mobile UI tests — discovery list, empty/error states, detail RSVP
 * interaction and create-screen validation against a mocked API client.
 */

import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import EventsScreen from "@/features/events/screens/events-screen";
import { EventsBottomNav } from "@/features/events/components/events-bottom-nav";
import EventDetailScreen from "@/features/events/screens/event-detail-screen";
import CreateEventScreen from "@/features/events/screens/create-event-screen";
import EventParticipantsScreen from "@/features/events/screens/event-participants-screen";
import { deviceTimezone, zonedToUtc } from "@/features/events/utils/event-time";
import type {
  EventDetail,
  EventItem,
  EventRow,
} from "@/features/events/types/event-types";

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
};
const mockClient = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};
let mockParams: Record<string, string> = {};
/** Value reported by the mocked native date/time picker (null = dismissed). */
let mockPickerDate: Date | null = null;

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: async () => ({ canceled: true }),
}));

// Native picker mock: renders a "Confirm picker" button that reports
// mockPickerDate through the component's onChange callback.
jest.mock("@react-native-community/datetimepicker", () => {
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  const { Pressable } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: ({
      onChange,
    }: {
      onChange: (event: { type: string }, date?: Date) => void;
    }) =>
      ReactActual.createElement(Pressable, {
        accessibilityLabel: "Confirm picker",
        onPress: () => onChange({ type: "set" }, mockPickerDate ?? undefined),
      }),
  };
});

jest.mock("expo-router", () => {
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  return {
    useRouter: () => mockRouter,
    router: mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (effect: () => void) =>
      ReactActual.useEffect(effect, [effect]),
  };
});

jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({
    apiClient: mockClient,
    session: {
      activeCommunityId: "community-1",
      memberships: [
        {
          communityId: "community-1",
          userId: "user-1",
          role: "MEMBER",
          status: "ACTIVE",
          joinedAt: "2026-10-01T00:00:00Z",
        },
      ],
      profile: {
        displayName: "Sara T.",
        username: "sara",
        profileCompleted: true,
      },
    },
  }),
}));

const CATEGORY = {
  id: "category-1",
  countryId: null,
  categoryKey: "social",
  displayName: "Social",
  sortOrder: 1,
};

function makeItem(
  overrides: {
    event?: Partial<EventRow>;
    item?: Partial<Omit<EventItem, "event">>;
  } = {},
): EventItem {
  const event: EventRow = {
    id: "event-1",
    countryId: null,
    communityId: "community-1",
    visibilityScope: "COMMUNITY",
    organizerId: "profile-1",
    ownerUserId: "user-1",
    businessAccountId: null,
    createdByUserId: "user-1",
    categoryId: "category-1",
    countryTopicCategoryId: null,
    title: "Coffee night",
    description: "An evening together",
    eventMode: "IN_PERSON",
    startsAt: "2027-11-20T17:30:00Z",
    endsAt: null,
    timezone: "Europe/Berlin",
    locationName: "Community hall",
    externalUrl: null,
    capacity: 30,
    status: "PUBLISHED",
    publishedAt: "2026-10-01T00:00:00Z",
    cancelledAt: null,
    cancelReason: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    coverMediaId: null,
    voiceRoomId: null,
    ...overrides.event,
  };
  return {
    event,
    category: CATEGORY,
    counts: { going: 3, interested: 5, waitlisted: 0 },
    myRsvp: null,
    saved: false,
    canManage: false,
    ...overrides.item,
  };
}

const DETAIL: EventDetail = {
  ...makeItem(),
  organizer: {
    id: "profile-1",
    username: "sara",
    displayName: "Sara T.",
    avatarMediaId: null,
  },
  businessAccountName: null,
};

const PARTICIPANTS = {
  items: [
    {
      profile: {
        id: "p2",
        username: "abe",
        displayName: "Abe B.",
        avatarMediaId: null,
      },
      rsvpStatus: "GOING",
    },
  ],
  counts: { going: 3, interested: 5, waitlisted: 0 },
  page: 0,
  size: 6,
};

let currentDetail: EventDetail = { ...DETAIL };

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockPickerDate = null;
  currentDetail = { ...DETAIL };
  mockClient.get.mockImplementation((url: string) => {
    if (url === "/api/v1/events/categories") {
      return Promise.resolve({ items: [CATEGORY] });
    }
    if (url === "/api/v1/communities/community-1") {
      return Promise.resolve({
        id: "community-1",
        name: "Ethiopians in Berlin",
        slug: "ethiopians-berlin",
        originCountryId: "country-et",
        destinationCountryId: "country-de",
        description: null,
        active: true,
      });
    }
    if (url === "/api/v1/business-accounts") {
      return Promise.resolve({ items: [] });
    }
    if (url.startsWith("/api/v1/events?")) {
      return Promise.resolve({ items: [makeItem()], nextCursor: null });
    }
    if (url === "/api/v1/events/event-1") {
      return Promise.resolve(currentDetail);
    }
    if (url.startsWith("/api/v1/events/event-1/participants")) {
      return Promise.resolve(PARTICIPANTS);
    }
    return Promise.resolve({ items: [] });
  });
  mockClient.put.mockImplementation(
    (url: string, body: { status?: string }) => {
      if (url === "/api/v1/events/event-1/rsvp" && body?.status) {
        currentDetail = { ...currentDetail, myRsvp: body.status as never };
        return Promise.resolve({
          status: body.status,
          counts: { going: 4, interested: 5, waitlisted: 0 },
          capacity: 30,
          promotedUserId: null,
        });
      }
      return Promise.resolve({});
    },
  );
  mockClient.post.mockResolvedValue({});
});

function renderScreen(component: React.ReactElement) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {component}
    </SafeAreaProvider>,
  );
}

describe("Events discovery screen", () => {
  it("renders the discovery list from the API", async () => {
    await renderScreen(<EventsScreen />);

    expect(await screen.findByText("Coffee night")).toBeTruthy();
    expect(screen.getAllByText("Social").length).toBeGreaterThan(0);
    expect(screen.getByText("3 going · 5 interested · 30 spots")).toBeTruthy();
  });

  it("opens the event detail when a card is pressed", async () => {
    await renderScreen(<EventsScreen />);

    fireEvent.press(await screen.findByText("Coffee night"));

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith("/(app)/events/event-1");
    });
  });

  it("shows the empty state when discovery returns no events", async () => {
    mockClient.get.mockImplementation((url: string) =>
      url.startsWith("/api/v1/events?")
        ? Promise.resolve({ items: [], nextCursor: null })
        : Promise.resolve({ items: [] }),
    );

    await renderScreen(<EventsScreen />);

    expect(await screen.findByText("No events yet")).toBeTruthy();
    expect(screen.getByLabelText("Create an event")).toBeTruthy();
  });

  it("shows the error state with a retry action when loading fails", async () => {
    mockClient.get.mockImplementation((url: string) =>
      url.startsWith("/api/v1/events?")
        ? Promise.reject(new Error("network down"))
        : Promise.resolve({ items: [] }),
    );

    await renderScreen(<EventsScreen />);

    expect(await screen.findByText("Failed to load events.")).toBeTruthy();
    expect(screen.getByLabelText("Retry loading events")).toBeTruthy();
  });
});

describe("Event detail screen", () => {
  beforeEach(() => {
    mockParams = { id: "event-1" };
  });

  it("renders event details, participants and organizer", async () => {
    await renderScreen(<EventDetailScreen />);

    expect(await screen.findByText("Coffee night")).toBeTruthy();
    expect(screen.getByText("Sat, Nov 20 · 18:30")).toBeTruthy();
    expect(screen.getByText("Community hall")).toBeTruthy();
    expect(screen.getByText("3 going of 30 · 5 interested")).toBeTruthy();
    expect(screen.getByText("Sara T.")).toBeTruthy();
    expect(screen.getByText("Abe B.")).toBeTruthy();
    expect(screen.getByLabelText("View all participants")).toBeTruthy();
  });

  it("opens the participant browser from the detail screen", async () => {
    await renderScreen(<EventDetailScreen />);

    await fireEvent.press(
      await screen.findByLabelText("View all participants"),
    );

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith(
        "/(app)/events/participants/event-1",
      );
    });
  });

  it("sends the RSVP request when Going is pressed", async () => {
    await renderScreen(<EventDetailScreen />);

    fireEvent.press(await screen.findByLabelText("Going"));

    await waitFor(() => {
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/events/event-1/rsvp",
        { status: "GOING" },
        { authenticated: true },
      );
    });
    await waitFor(() => {
      expect(screen.getByText("Going ✓")).toBeTruthy();
    });
  });

  it("saves and unsaves the event through the header toggle", async () => {
    await renderScreen(<EventDetailScreen />);

    fireEvent.press(await screen.findByLabelText("Save event"));

    await waitFor(() => {
      expect(mockClient.put).toHaveBeenCalledWith(
        "/api/v1/events/event-1/save",
        {},
        { authenticated: true },
      );
    });
    expect(
      await screen.findByLabelText("Remove from saved events"),
    ).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Remove from saved events"));
    await waitFor(() => {
      expect(mockClient.delete).toHaveBeenCalledWith(
        "/api/v1/events/event-1/save",
        { authenticated: true },
      );
    });
  });

  it("shows the error state when the detail request fails", async () => {
    mockClient.get.mockRejectedValue(new Error("network down"));

    await renderScreen(<EventDetailScreen />);

    expect(await screen.findByText("Failed to load event.")).toBeTruthy();
  });
});

describe("Create event screen", () => {
  // The wizard: Audience → Details → Review. Community is preselected from
  // activeCommunityId, so Continue advances straight to the form.
  async function advanceToDetails() {
    await waitFor(() =>
      expect(screen.getByLabelText("Ethiopians in Berlin")).toBeTruthy(),
    );
    fireEvent.press(screen.getByLabelText("Continue"));
    await screen.findByPlaceholderText("Ethiopian coffee night");
  }

  it("validates the form and blocks submission without a title", async () => {
    await renderScreen(<CreateEventScreen />);
    await advanceToDetails();

    fireEvent.press(screen.getByLabelText("Continue"));

    expect(await screen.findByText("Enter a title.")).toBeTruthy();
    expect(mockClient.post).not.toHaveBeenCalled();
  });

  it("requires an online link for online events", async () => {
    await renderScreen(<CreateEventScreen />);
    await advanceToDetails();

    await fireEvent.changeText(
      screen.getByPlaceholderText("Ethiopian coffee night"),
      "Movie night",
    );
    await fireEvent.changeText(
      screen.getByPlaceholderText("What is happening, and who is it for?"),
      "A cozy evening",
    );
    await fireEvent.press(screen.getByLabelText("Social"));
    // native pickers: open the field, confirm the mocked picker value
    mockPickerDate =
      zonedToUtc("2027-11-20", "18:30", deviceTimezone()) ?? new Date();
    await fireEvent.press(screen.getByLabelText("Start date"));
    await fireEvent.press(screen.getByLabelText("Confirm picker"));
    await fireEvent.press(screen.getByLabelText("Start time"));
    await fireEvent.press(screen.getByLabelText("Confirm picker"));
    await fireEvent.press(screen.getByLabelText("Online (external)"));

    await fireEvent.press(screen.getByLabelText("Continue"));

    expect(
      await screen.findByText("Enter the online event link."),
    ).toBeTruthy();
    expect(mockClient.post).not.toHaveBeenCalled();
  });

  it("submits picker-selected date/time interpreted in the event timezone", async () => {
    mockClient.post.mockImplementation((url: string) =>
      url === "/api/v1/events" ? Promise.resolve(DETAIL) : Promise.resolve({}),
    );

    await renderScreen(<CreateEventScreen />);
    await advanceToDetails();

    await fireEvent.changeText(
      screen.getByPlaceholderText("Ethiopian coffee night"),
      "Coffee night",
    );
    await fireEvent.changeText(
      screen.getByPlaceholderText("What is happening, and who is it for?"),
      "An evening together",
    );
    await fireEvent.press(screen.getByLabelText("Social"));
    mockPickerDate =
      zonedToUtc("2027-11-20", "18:30", deviceTimezone()) ?? new Date();
    await fireEvent.press(screen.getByLabelText("Start date"));
    await fireEvent.press(screen.getByLabelText("Confirm picker"));
    await fireEvent.press(screen.getByLabelText("Start time"));
    await fireEvent.press(screen.getByLabelText("Confirm picker"));
    await fireEvent.changeText(
      screen.getByPlaceholderText("Europe/Berlin"),
      "Europe/Berlin",
    );
    await fireEvent.changeText(
      screen.getByPlaceholderText("Community hall, Berlin"),
      "Community hall",
    );

    // Details valid → advance to the Review step, then submit.
    await fireEvent.press(screen.getByLabelText("Continue"));
    await fireEvent.press(
      await screen.findByLabelText("Create event"),
    );

    // 18:30 wall-clock in Europe/Berlin (CET, UTC+1) = 17:30Z
    await waitFor(() => {
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/events",
        expect.objectContaining({ startsAt: "2027-11-20T17:30:00.000Z" }),
        { authenticated: true },
      );
    });
    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/events/event-1");
    });
  });
});

describe("Event participants screen", () => {
  beforeEach(() => {
    mockParams = { id: "event-1" };
  });

  it("browses participants page by page and filters by RSVP status", async () => {
    const page0 = {
      items: Array.from({ length: 20 }, (_, i) => ({
        profile: {
          id: `p${i}`,
          username: `member${i}`,
          displayName: `Member ${i}`,
          avatarMediaId: null,
        },
        rsvpStatus: "GOING",
      })),
      counts: { going: 21, interested: 5, waitlisted: 0 },
      page: 0,
      size: 20,
    };
    const page1 = {
      items: [
        {
          profile: {
            id: "p20",
            username: "kebede",
            displayName: "Kebede T.",
            avatarMediaId: null,
          },
          rsvpStatus: "WAITLISTED",
        },
      ],
      counts: { going: 21, interested: 5, waitlisted: 1 },
      page: 1,
      size: 20,
    };
    mockClient.get.mockImplementation((url: string) => {
      if (url === "/api/v1/events/categories") {
        return Promise.resolve({ items: [CATEGORY] });
      }
      if (url === "/api/v1/events/event-1") {
        return Promise.resolve(currentDetail);
      }
      if (url.startsWith("/api/v1/events/event-1/participants")) {
        const page = url.endsWith("page=0&size=20") ? 0 : 1;
        return Promise.resolve(page === 0 ? page0 : page1);
      }
      return Promise.resolve({ items: [] });
    });

    await renderScreen(<EventParticipantsScreen />);

    expect(await screen.findByText("Member 0")).toBeTruthy();
    expect(screen.getByText("Coffee night")).toBeTruthy(); // event title header

    await fireEvent.press(screen.getByLabelText("Load more participants"));
    expect(await screen.findByText("Kebede T.")).toBeTruthy();
    // "Waitlisted" appears both as a filter chip and as the row's status badge
    expect(screen.getAllByText("Waitlisted").length).toBeGreaterThan(1);

    // status filter restarts browsing at page 0 with status=GOING
    await fireEvent.press(screen.getByLabelText("Going"));
    await waitFor(() => {
      expect(mockClient.get).toHaveBeenCalledWith(
        "/api/v1/events/event-1/participants?status=GOING&page=0&size=20",
        { authenticated: true },
      );
    });
  });
});

describe("Events bottom nav", () => {
  it("navigates to Posts feed, Saved, My events and Account", async () => {
    await renderScreen(<EventsBottomNav active="discover" />);

    fireEvent.press(screen.getByLabelText("Posts"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/(tabs)");

    fireEvent.press(screen.getByLabelText("Saved"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/events/saved");

    fireEvent.press(screen.getByLabelText("Tickets"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/events/my");

    fireEvent.press(screen.getByLabelText("Account"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/(tabs)/profile");
  });
});
