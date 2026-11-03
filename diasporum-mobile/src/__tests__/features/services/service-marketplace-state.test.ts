import { mergeProviders } from "@/features/services/screens/provider-collection-screen";
import { mergeRequests } from "@/features/services/screens/request-collection-screen";
import { mergeResponses } from "@/features/services/screens/response-collection-screen";
import { validateReview } from "@/features/services/screens/review-editor-screen";

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(() => ({})),
  useRouter: jest.fn(() => ({ push: jest.fn(), back: jest.fn() })),
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: jest.fn(() => ({ apiClient: {}, session: null })),
}));
jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

describe("Service Marketplace client state", () => {
  it("deduplicates overlapping provider cursor pages without reordering existing items", () => {
    const current = [{ id: "provider-1" }, { id: "provider-2" }] as never[];
    const incoming = [{ id: "provider-2" }, { id: "provider-3" }] as never[];
    expect(mergeProviders(current, incoming).map((item) => item.id)).toEqual([
      "provider-1", "provider-2", "provider-3",
    ]);
    expect(current).toHaveLength(2);
  });

  it("deduplicates overlapping request cursor pages", () => {
    const current = [{ id: "request-1" }] as never[];
    const incoming = [{ id: "request-1" }, { id: "request-2" }] as never[];
    expect(mergeRequests(current, incoming).map((item) => item.id)).toEqual(["request-1", "request-2"]);
  });

  it("deduplicates overlapping response cursor pages", () => {
    const current = [{ id: "response-1" }, { id: "response-2" }] as never[];
    const incoming = [{ id: "response-2" }, { id: "response-3" }] as never[];
    expect(mergeResponses(current, incoming).map((item) => item.id)).toEqual([
      "response-1", "response-2", "response-3",
    ]);
  });

  it("validates interaction review rating and text boundaries", () => {
    expect(validateReview(0, "")).toBe("Choose a rating from 1 to 5.");
    expect(validateReview(6, "")).toBe("Choose a rating from 1 to 5.");
    expect(validateReview(2.5, "")).toBe("Choose a rating from 1 to 5.");
    expect(validateReview(5, "x".repeat(4001))).toBe("Review text cannot exceed 4000 characters.");
    expect(validateReview(1, "x".repeat(4000))).toBeNull();
    expect(validateReview(5, "Clear communication")).toBeNull();
  });
});
