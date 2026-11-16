import { mergeProviders } from "@/features/services/screens/provider-collection-screen";
import { mergeRequests } from "@/features/services/screens/request-collection-screen";
import { mergeResponses } from "@/features/services/screens/response-collection-screen";
import { validateReview } from "@/features/services/screens/review-editor-screen";
import { buildCategorySections } from "@/features/services/screens/services-screen";
import {
  validateQuoteForm,
  type QuoteFormState,
} from "@/features/services/screens/quote-collection-screen";
import type { ServiceCategory } from "@/features/services/types/service-marketplace-types";

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(() => ({})),
  useRouter: jest.fn(() => ({ push: jest.fn(), back: jest.fn() })),
}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: jest.fn(() => ({ apiClient: {}, session: null })),
}));
jest.mock("@/global.css", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

describe("Service Marketplace client state", () => {
  it("deduplicates overlapping provider cursor pages without reordering existing items", () => {
    const current = [{ id: "provider-1" }, { id: "provider-2" }] as never[];
    const incoming = [{ id: "provider-2" }, { id: "provider-3" }] as never[];
    expect(mergeProviders(current, incoming).map((item) => item.id)).toEqual([
      "provider-1",
      "provider-2",
      "provider-3",
    ]);
    expect(current).toHaveLength(2);
  });

  it("deduplicates overlapping request cursor pages", () => {
    const current = [{ id: "request-1" }] as never[];
    const incoming = [{ id: "request-1" }, { id: "request-2" }] as never[];
    expect(mergeRequests(current, incoming).map((item) => item.id)).toEqual([
      "request-1",
      "request-2",
    ]);
  });

  it("deduplicates overlapping response cursor pages", () => {
    const current = [{ id: "response-1" }, { id: "response-2" }] as never[];
    const incoming = [{ id: "response-2" }, { id: "response-3" }] as never[];
    expect(mergeResponses(current, incoming).map((item) => item.id)).toEqual([
      "response-1",
      "response-2",
      "response-3",
    ]);
  });

  it("groups child services under their parent category and filters by service", () => {
    const categories = [
      {
        id: "parent-1",
        categoryKey: "HOME",
        parentId: null,
        displayName: "Home services",
        description: null,
        sortOrder: 1,
      },
      {
        id: "child-1",
        categoryKey: "PLUMBING",
        parentId: "parent-1",
        displayName: "Plumbing",
        description: null,
        sortOrder: 1,
      },
      {
        id: "child-2",
        categoryKey: "ELECTRICAL",
        parentId: "parent-1",
        displayName: "Electrical",
        description: null,
        sortOrder: 2,
      },
    ] satisfies ServiceCategory[];
    expect(
      buildCategorySections(categories)[0]?.services.map((item) => item.id),
    ).toEqual(["child-1", "child-2"]);
    const filtered = buildCategorySections(categories, "plumb");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.services.map((item) => item.id)).toEqual(["child-1"]);
    expect(buildCategorySections(categories, "cleaning")).toEqual([]);
  });

  it("validates structured quote totals and duration", () => {
    const form: QuoteFormState = {
      title: "Repair",
      scopeOfWork: "Parts and labour",
      amount: "150.00",
      currencyCode: "EUR",
      durationValue: "2",
      durationUnit: "DAY",
      validUntil: "",
      inclusions: "",
      exclusions: "",
      termsAndConditions: "",
      items: [{ description: "Labour", quantity: 2, unitAmount: 75 }],
    };
    expect(validateQuoteForm(form)).toBeNull();
    expect(validateQuoteForm({ ...form, amount: "140.00" })).toBe(
      "Line items must add up to the quote amount.",
    );
    expect(validateQuoteForm({ ...form, durationValue: "" })).toBe(
      "Add an estimated duration value.",
    );
  });

  it("validates completed-service review rating and text boundaries", () => {
    expect(validateReview(0, "")).toBe("Choose a rating from 1 to 5.");
    expect(validateReview(6, "")).toBe("Choose a rating from 1 to 5.");
    expect(validateReview(2.5, "")).toBe("Choose a rating from 1 to 5.");
    expect(validateReview(5, "x".repeat(4001))).toBe(
      "Review text cannot exceed 4000 characters.",
    );
    expect(validateReview(1, "x".repeat(4000))).toBeNull();
    expect(validateReview(5, "Clear communication")).toBeNull();
  });
});
