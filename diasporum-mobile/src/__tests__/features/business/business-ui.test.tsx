/** Mobile Business Workspace UI tests with mocked navigation and API client. */

import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import ProfileTabScreen from "@/app/(app)/(tabs)/profile";
import BusinessAccountsScreen from "@/features/business/screens/business-accounts-screen";
import BusinessWorkspaceScreen from "@/features/business/screens/business-workspace-screen";
import CreateBusinessScreen from "@/features/business/screens/create-business-screen";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockClient = { get: jest.fn(), post: jest.fn() };

jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

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

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.get.mockResolvedValue({ items: [] });
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

describe("Business Workspace mobile UI", () => {
  it("opens Business Accounts from the personal Profile entry", async () => {
    await renderScreen(<ProfileTabScreen />);

    fireEvent.press(screen.getByLabelText("Manage Business Accounts"));

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
      screen.getByText(/invitation acceptance will be added/i),
    ).toBeTruthy();
  });

  it("displays multiple real accounts and opens the selected workspace", async () => {
    mockClient.get.mockResolvedValue({
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
    });
    await renderScreen(<BusinessAccountsScreen />);

    expect(await screen.findByText("Habesha Group")).toBeTruthy();
    expect(screen.getByText("Negese Services")).toBeTruthy();
    expect(screen.getByText("Owner · 2 business profiles")).toBeTruthy();
    expect(screen.getByText("Administrator · 1 business profile")).toBeTruthy();
    expect(screen.getByText("SUSPENDED")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Open Habesha Group workspace"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(app)/business/workspace/account-1",
    );
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
      { accountName: "Habesha Group" },
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

    fireEvent.press(screen.getByLabelText("Return to Personal Diasporum"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/(tabs)/profile");
  });

  it("does not retain workspace data when access revalidation fails", async () => {
    mockClient.get.mockRejectedValue(new Error("Revoked"));
    await renderScreen(<BusinessWorkspaceScreen />);

    expect(await screen.findByText("Workspace unavailable")).toBeTruthy();
    expect(screen.queryByText("Manage business")).toBeNull();
    expect(screen.getByLabelText("Choose another business")).toBeTruthy();
  });
});
