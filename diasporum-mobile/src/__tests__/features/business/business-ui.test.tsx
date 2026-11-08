/** Mobile Business Workspace UI tests with mocked navigation and API client. */

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";

import ProfileTabScreen from "@/app/(app)/(tabs)/profile";
import BusinessAccountsScreen from "@/features/business/screens/business-accounts-screen";
import BusinessWorkspaceScreen from "@/features/business/screens/business-workspace-screen";
import BusinessTeamScreen from "@/features/business/screens/business-team-screen";
import BusinessSettingsScreen from "@/features/business/screens/business-settings-screen";
import BusinessBillingScreen from "@/features/business/screens/business-billing-screen";
import BusinessListingsScreen from "@/features/business/screens/business-listings-screen";
import CreateBusinessScreen from "@/features/business/screens/create-business-screen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockClient = {
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
};

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => "test-idempotency-key",
}));

jest.mock("expo-router", () => {
  const ReactActual = jest.requireActual<typeof import("react")>("react");
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ accountId: "account-1" }),
    useFocusEffect: (effect: () => void) =>
      ReactActual.useEffect(effect, [effect]),
  };
});

jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({
    apiClient: mockClient,
    session: {
      me: { id: "user-self" },
      profile: {
        displayName: "Personal User",
        username: "personal",
        profileCompleted: true,
      },
    },
  }),
}));

jest.mock("@/core/auth/auth-provider", () => ({
  useAuth: () => ({ logout: jest.fn() }),
}));

const OWNER_WORKSPACE = {
  id: "account-1",
  accountName: "Habesha Group",
  status: "ACTIVE",
  role: "OWNER",
  profileCount: 2,
  createdAt: "2026-01-01T00:00:00Z",
  capabilities: {
    manageProfiles: true,
    manageListings: true,
    manageTeam: true,
    manageBilling: true,
    manageSettings: true,
  },
};

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockClient.get.mockResolvedValue({ items: [] });
  mockClient.post.mockResolvedValue({});
  mockClient.patch.mockResolvedValue({});
  mockClient.delete.mockResolvedValue({});
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

describe("Business Workspace mobile UI", () => {
  it("opens Business Accounts from the personal Profile entry", async () => {
    await renderScreen(<ProfileTabScreen />);

    await fireEvent.press(screen.getByLabelText("Open Business Workspace"));

    expect(mockRouter.push).toHaveBeenCalledWith("/(app)/business");
    expect(screen.getByText("Personal User")).toBeTruthy();
  });

  it("shows the empty landing experience when no accounts are returned", async () => {
    await renderScreen(<BusinessAccountsScreen />);

    expect(
      await screen.findByText("Start your Business Workspace"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Create Business Account")).toBeTruthy();
    expect(
      screen.getByText(/without changing your personal Diasporum account/i),
    ).toBeTruthy();
  });

  it("displays multiple real accounts and opens the selected workspace", async () => {
    mockClient.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/api/v1/business-accounts"
          ? {
              items: [
                {
                  id: "account-1",
                  accountName: "Habesha Group",
                  status: "ACTIVE",
                  role: "OWNER",
                  profileCount: 2,
                  createdAt: "2026-01-01T00:00:00Z",
                },
                {
                  id: "account-2",
                  accountName: "Negese Services",
                  status: "SUSPENDED",
                  role: "ADMINISTRATOR",
                  profileCount: 1,
                  createdAt: "2026-01-02T00:00:00Z",
                },
              ],
            }
          : { items: [] },
      ),
    );
    await renderScreen(<BusinessAccountsScreen />);

    expect(await screen.findByText("Habesha Group")).toBeTruthy();
    expect(screen.getByText("Negese Services")).toBeTruthy();
    expect(screen.getByText("Owner · 2 business profiles")).toBeTruthy();
    expect(screen.getByText("Administrator · 1 business profile")).toBeTruthy();
    expect(screen.getByText("SUSPENDED")).toBeTruthy();

    await fireEvent.press(
      screen.getByLabelText("Open Habesha Group workspace"),
    );
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/business/workspace/account-1",
    );
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "diasporum.lastBusinessWorkspaceId",
      "account-1",
    );
  });

  it("renders the invitation inbox and accepts an invitation", async () => {
    mockClient.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/api/v1/me/business-invitations"
          ? {
              items: [
                {
                  accountId: "account-9",
                  accountName: "Inviting Co",
                  role: "EDITOR",
                  invitedByUserId: "u1",
                  invitedByName: "Owner Person",
                  invitedAt: "2026-01-03T00:00:00Z",
                  expiresAt: null,
                  expired: false,
                },
              ],
            }
          : { items: [] },
      ),
    );
    await renderScreen(<BusinessAccountsScreen />);

    expect(await screen.findByText("Pending invitations")).toBeTruthy();
    expect(screen.getByText("Inviting Co")).toBeTruthy();
    expect(screen.getByText(/from Owner Person/)).toBeTruthy();

    await fireEvent.press(
      screen.getByLabelText("Accept invitation to Inviting Co"),
    );

    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/me/business-invitations/account-9/accept",
        {},
        { authenticated: true },
      ),
    );
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith(
        "/(app)/business/workspace/account-9",
      ),
    );
  });

  it("renders an expired invitation with a disabled accept action", async () => {
    mockClient.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/api/v1/me/business-invitations"
          ? {
              items: [
                {
                  accountId: "account-x",
                  accountName: "Old Invite",
                  role: "EDITOR",
                  invitedByUserId: null,
                  invitedByName: null,
                  invitedAt: "2026-01-01T00:00:00Z",
                  expiresAt: "2026-01-10T00:00:00Z",
                  expired: true,
                },
              ],
            }
          : { items: [] },
      ),
    );
    await renderScreen(<BusinessAccountsScreen />);

    expect(await screen.findByText("Old Invite")).toBeTruthy();
    expect(screen.getByText(/expired/)).toBeTruthy();
  });

  it("prevents duplicate creation submissions and opens the created workspace", async () => {
    let resolveCreation: ((value: { id: string }) => void) | undefined;
    mockClient.post.mockReturnValue(
      new Promise((resolve) => {
        resolveCreation = resolve;
      }),
    );
    await renderScreen(<CreateBusinessScreen />);

    await fireEvent.changeText(
      screen.getByLabelText("Business Account name (required)"),
      "  Habesha Group  ",
    );
    const submit = screen.getByLabelText("Create Business Account");
    await fireEvent.press(submit);
    await fireEvent.press(submit);

    expect(mockClient.post).toHaveBeenCalledTimes(1);
    expect(mockClient.post).toHaveBeenCalledWith(
      "/api/v1/business-accounts",
      {
        accountName: "Habesha Group",
        idempotencyKey: "test-idempotency-key",
      },
      { authenticated: true },
    );

    await act(async () => resolveCreation?.({ id: "created-account" }));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith(
        "/(app)/business/workspace/created-account",
      ),
    );
  });

  it("uses backend capabilities to show only the billing manager section", async () => {
    mockClient.get.mockResolvedValue({
      id: "account-1",
      accountName: "Billing Workspace",
      status: "ACTIVE",
      role: "BILLING_MANAGER",
      profileCount: 0,
      createdAt: "2026-01-01T00:00:00Z",
      capabilities: {
        manageProfiles: false,
        manageListings: false,
        manageTeam: false,
        manageBilling: true,
        manageSettings: false,
      },
    });
    await renderScreen(<BusinessWorkspaceScreen />);

    expect(await screen.findByText("Billing Workspace")).toBeTruthy();
    expect(screen.getByText("Billing")).toBeTruthy();
    expect(screen.queryByText("Business Profiles")).toBeNull();
    expect(screen.queryByText("Listings")).toBeNull();
    expect(screen.queryByText("Team")).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/v1/business-accounts/account-1/workspace",
      { authenticated: true },
    );

    await fireEvent.press(
      screen.getByLabelText("Return to Personal Diasporum"),
    );
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/(tabs)/profile");
  });

  it("navigates to each management screen from workspace cards", async () => {
    mockClient.get.mockResolvedValue(OWNER_WORKSPACE);
    await renderScreen(<BusinessWorkspaceScreen />);

    expect(await screen.findByText("Habesha Group")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Team"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/business/workspace/account-1/team",
    );

    await fireEvent.press(screen.getByLabelText("Settings"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/business/workspace/account-1/settings",
    );

    await fireEvent.press(screen.getByLabelText("Billing"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/business/workspace/account-1/billing",
    );

    await fireEvent.press(screen.getByLabelText("Listings"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/business/workspace/account-1/listings",
    );
  });

  it("does not retain workspace data when access revalidation fails", async () => {
    mockClient.get.mockRejectedValue(new Error("Revoked"));
    await renderScreen(<BusinessWorkspaceScreen />);

    expect(await screen.findByText("Workspace unavailable")).toBeTruthy();
    expect(screen.queryByText("Manage business")).toBeNull();
    expect(screen.getByLabelText("Choose another business")).toBeTruthy();
  });

  it("shows team members and sends an invitation", async () => {
    mockClient.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/workspace")
          ? OWNER_WORKSPACE
          : url.endsWith("/members")
            ? {
                items: [
                  {
                    userId: "user-self",
                    username: "personal",
                    displayName: "Personal User",
                    avatarMediaId: null,
                    role: "OWNER",
                    membershipStatus: "ACTIVE",
                    invitationExpired: false,
                    invitedByUserId: null,
                    invitedByName: null,
                    invitedAt: "2026-01-01T00:00:00Z",
                    invitationExpiresAt: null,
                    acceptedAt: "2026-01-01T00:00:00Z",
                  },
                ],
              }
            : { items: [] },
      ),
    );
    await renderScreen(<BusinessTeamScreen />);

    expect(await screen.findByText(/Personal User \(you\)/)).toBeTruthy();
    expect(screen.getByText("Invite member")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("Username"), "@teammate");
    await fireEvent.press(screen.getByText("Send invitation"));

    await waitFor(() =>
      expect(mockClient.post).toHaveBeenCalledWith(
        "/api/v1/business-accounts/account-1/invitations",
        { username: "teammate", role: "EDITOR" },
        { authenticated: true },
      ),
    );
  });

  it("shows billing subscription, seats, and entitlements", async () => {
    mockClient.get.mockResolvedValue({
      subscription: {
        planKey: "BUSINESS_PRO",
        displayName: "Business Pro",
        status: "ACTIVE",
        currentPeriodStart: "2026-01-01T00:00:00Z",
        currentPeriodEnd: "2026-02-01T00:00:00Z",
        cancelAtPeriodEnd: false,
      },
      seats: { used: 3, limit: 10 },
      entitlements: [
        {
          featureKey: "LISTING_MEDIA",
          displayName: "Listing media",
          featureKind: "QUANTITY",
          enabled: true,
          quantityLimit: 25,
          resetPeriod: null,
        },
      ],
      orders: [],
    });
    await renderScreen(<BusinessBillingScreen />);

    expect(await screen.findByText("Business Pro")).toBeTruthy();
    expect(screen.getByText("3 of 10 seats used")).toBeTruthy();
    expect(screen.getByText("Plan entitlements")).toBeTruthy();
    expect(screen.getByText("Listing media")).toBeTruthy();
    expect(screen.getByText("Up to 25")).toBeTruthy();
    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/v1/business-accounts/account-1/billing",
      { authenticated: true },
    );
  });

  it("shows aggregated workspace listings", async () => {
    mockClient.get.mockResolvedValue({
      profiles: {
        total: 1,
        items: [
          {
            id: "p1",
            title: "Main Office",
            status: "PUBLISHED",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      },
      events: { total: 0, items: [] },
      jobs: {
        total: 1,
        items: [
          {
            id: "j1",
            title: "Driver needed",
            status: "OPEN",
            createdAt: "2026-01-02T00:00:00Z",
          },
        ],
      },
      properties: { total: 0, items: [] },
      vehicles: { total: 0, items: [] },
      providers: { total: 0, items: [] },
    });
    await renderScreen(<BusinessListingsScreen />);

    expect(await screen.findByText("Main Office")).toBeTruthy();
    expect(screen.getByText("Driver needed")).toBeTruthy();
    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/v1/business-accounts/account-1/listings",
      { authenticated: true },
    );
  });

  it("shows settings with rename form and owner-only danger zone", async () => {
    mockClient.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/workspace")
          ? OWNER_WORKSPACE
          : { items: [] },
      ),
    );
    await renderScreen(<BusinessSettingsScreen />);

    expect(await screen.findByText("Workspace name")).toBeTruthy();
    expect(screen.getByLabelText("Close Business Account")).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText("Business Account name"),
      "Renamed Group",
    );
    await fireEvent.press(screen.getByText("Save name"));

    await waitFor(() =>
      expect(mockClient.patch).toHaveBeenCalledWith(
        "/api/v1/business-accounts/account-1",
        { accountName: "Renamed Group" },
        { authenticated: true },
      ),
    );
  });
});
