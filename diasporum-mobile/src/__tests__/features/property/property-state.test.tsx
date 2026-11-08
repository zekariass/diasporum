import { act, renderHook, waitFor } from "@testing-library/react-native";
import { usePropertyPage } from "@/features/property/hooks/use-property-page";
import {
  discoveryFilters,
  emptyFilters,
  filterError,
  normalizeFilters,
} from "@/features/property/utils/property-filters";
import { propertySaveStore } from "@/features/property/utils/property-save-store";
import { createPropertyApi } from "@/features/property/services/property-api";
import type {
  PropertyItem,
  PropertyPage,
} from "@/features/property/types/property-types";

jest.mock("expo-router", () => {
  const react = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (effect: () => void) => react.useEffect(effect, [effect]),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const item = (id: string) =>
  ({ property: { id }, saved: false }) as PropertyItem;
const page = (...ids: string[]): PropertyPage => ({
  items: ids.map(item),
  nextCursor: null,
  totalCount: ids.length,
});

describe("Property pagination", () => {
  it("ignores an older filter request that completes after the current query", async () => {
    const old = deferred<PropertyPage>();
    const first = jest.fn(() => old.promise);
    const second = jest.fn(async () => page("new"));
    const hook = await renderHook<
      ReturnType<typeof usePropertyPage>,
      { fetcher: (cursor?: string) => Promise<PropertyPage> }
    >(({ fetcher }) => usePropertyPage(fetcher), {
      initialProps: { fetcher: first },
    });
    await hook.rerender({ fetcher: second });
    await waitFor(() =>
      expect(hook.result.current.page.items[0]?.property.id).toBe("new"),
    );
    await act(async () => old.resolve(page("old")));
    expect(
      hook.result.current.page.items.map((value) => value.property.id),
    ).toEqual(["new"]);
  });

  it("locks duplicate page triggers and deduplicates overlapping results", async () => {
    const next = deferred<PropertyPage>();
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({ ...page("one"), nextCursor: "next" })
      .mockReturnValueOnce(next.promise);
    const hook = await renderHook(() => usePropertyPage(fetcher));
    await waitFor(() =>
      expect(hook.result.current.page.nextCursor).toBe("next"),
    );
    await act(async () => {
      hook.result.current.more();
      hook.result.current.more();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith("next");
    await act(async () => next.resolve(page("one", "two")));
    expect(
      hook.result.current.page.items.map((value) => value.property.id),
    ).toEqual(["one", "two"]);
  });

  it("refresh supersedes an in-flight page and clears stale data after failure", async () => {
    const next = deferred<PropertyPage>();
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({ ...page("one"), nextCursor: "next" })
      .mockReturnValueOnce(next.promise)
      .mockResolvedValueOnce(page("fresh"))
      .mockRejectedValueOnce(new Error("denied"));
    const hook = await renderHook(() => usePropertyPage(fetcher));
    await waitFor(() =>
      expect(hook.result.current.page.nextCursor).toBe("next"),
    );
    await act(async () => hook.result.current.more());
    await act(async () => hook.result.current.refresh());
    await act(async () => next.resolve(page("stale")));
    expect(
      hook.result.current.page.items.map((value) => value.property.id),
    ).toEqual(["fresh"]);
    await act(async () => hook.result.current.refresh());
    expect(hook.result.current.page.items).toHaveLength(0);
    expect(hook.result.current.error).toBeTruthy();
  });
});

describe("Property filter mapping", () => {
  it("uses exact room counts below 4 and minimum-only bounds for 4+", () => {
    expect(
      discoveryFilters({ ...emptyFilters(), bedrooms: "2", bathrooms: "4" }),
    ).toMatchObject({ minBedrooms: 2, maxBedrooms: 2, bathrooms: 4 });
    expect(
      discoveryFilters({ ...emptyFilters(), bedrooms: "4", bathrooms: "4" })
        .maxBedrooms,
    ).toBeUndefined();
    expect(
      discoveryFilters({ ...emptyFilters(), bathrooms: "4" }).maxBathrooms,
    ).toBeUndefined();
  });

  it("clears incompatible purpose/type fields without assuming a currency", () => {
    const draft = {
      ...emptyFilters(),
      propertyTypeId: "land",
      bedrooms: "2",
      bathrooms: "1",
      furnishedStatus: "FURNISHED",
      maxDeposit: "500",
      pricePeriod: "MONTH",
    };
    const normalized = normalizeFilters(draft, [
      { id: "land", typeKey: "LAND", displayName: "Land" },
    ]);
    expect(discoveryFilters(normalized)).toEqual({
      listingPurpose: "SALE",
      propertyTypeId: "land",
    });
    expect(
      normalizeFilters(
        { ...emptyFilters("RENT"), tenure: "FREEHOLD", conditionKey: "GOOD" },
        [],
      ),
    ).toMatchObject({ tenure: "", conditionKey: "" });
  });

  it("rejects invalid ranges and preserves zero amounts and false flags", () => {
    expect(
      filterError({ ...emptyFilters(), minPrice: "200", maxPrice: "100" }),
    ).toBeTruthy();
    expect(filterError({ ...emptyFilters(), maxDeposit: "-1" })).toBeTruthy();
    expect(
      filterError({ ...emptyFilters(), minFloorArea: "2", maxFloorArea: "1" }),
    ).toBeTruthy();
    expect(
      filterError({ ...emptyFilters(), maxTenancyMonths: "1.5" }),
    ).toBeTruthy();
    expect(
      discoveryFilters({
        ...emptyFilters("RENT"),
        minPrice: "0",
        maxDeposit: "0",
        billsIncluded: "NO",
      }),
    ).toMatchObject({ minPrice: 0, maxDeposit: 0, billsIncluded: false });
  });
});

describe("Property saved-state reconciliation", () => {
  it("does not let stale reads undo a save, but accepts a later server snapshot", async () => {
    const pendingRead = deferred<PropertyPage>();
    const client = {
      get: jest
        .fn()
        .mockReturnValueOnce(pendingRead.promise)
        .mockResolvedValueOnce(page("one")),
    };
    const store = propertySaveStore(client as never);
    const api = createPropertyApi(client as never);
    const read = api.discover();
    store.set("one", { saved: true, pending: true, error: null });
    store.set("one", { saved: true, pending: false, error: null });
    pendingRead.resolve(page("one"));
    await read;
    expect(store.values.get("one")?.saved).toBe(true);
    await api.discover();
    expect(store.values.get("one")?.saved).toBe(false);
  });

  it("keeps account clients isolated", () => {
    const first = propertySaveStore({} as never);
    const second = propertySaveStore({} as never);
    first.set("one", { saved: true, pending: false, error: null });
    expect(second.values.has("one")).toBe(false);
  });
});
