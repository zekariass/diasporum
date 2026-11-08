import type {
  ListingPurpose,
  PropertyDiscoveryFilters,
  PropertyType,
} from "../types/property-types";

export const emptyFilters = (listingPurpose: ListingPurpose = "SALE") => ({
  listingPurpose,
  propertyTypeId: "",
  city: "",
  currencyCode: "",
  pricePeriod: "",
  minPrice: "",
  maxPrice: "",
  bedrooms: "",
  bathrooms: "",
  minFloorArea: "",
  maxFloorArea: "",
  floorAreaUnit: "SQM",
  furnishedStatus: "",
  availableBy: "",
  maxDeposit: "",
  billsIncluded: "",
  maxTenancyMonths: "",
  tenure: "",
  conditionKey: "",
});
export type PropertyFilterState = ReturnType<typeof emptyFilters>;
export function normalizeFilters(
  value: PropertyFilterState,
  types: PropertyType[],
): PropertyFilterState {
  const result = { ...value };
  const key = types.find((type) => type.id === value.propertyTypeId)?.typeKey;
  if (key === "LAND" || key === "COMMERCIAL") result.bedrooms = "";
  if (key === "LAND") {
    result.bathrooms = "";
    result.furnishedStatus = "";
    result.conditionKey = "";
  }
  if (value.listingPurpose === "SALE") {
    result.pricePeriod = "";
    result.maxDeposit = "";
    result.billsIncluded = "";
    result.maxTenancyMonths = "";
  } else {
    result.tenure = "";
    result.conditionKey = "";
  }
  return result;
}
const numericFields = [
  "minPrice",
  "maxPrice",
  "minFloorArea",
  "maxFloorArea",
  "maxDeposit",
  "maxTenancyMonths",
] as const;
export function filterError(value: PropertyFilterState): string | null {
  for (const key of numericFields) {
    if (
      value[key].trim() &&
      (!/^\d+(\.\d{1,2})?$/.test(value[key].trim()) ||
        !Number.isFinite(Number(value[key])))
    )
      return "Enter valid non-negative amounts with at most two decimal places.";
  }
  if (
    value.minPrice &&
    value.maxPrice &&
    Number(value.minPrice) > Number(value.maxPrice)
  )
    return "Minimum price cannot exceed maximum price.";
  if (
    value.minFloorArea &&
    value.maxFloorArea &&
    Number(value.minFloorArea) > Number(value.maxFloorArea)
  )
    return "Minimum floor area cannot exceed maximum floor area.";
  if (
    value.maxTenancyMonths &&
    (!Number.isInteger(Number(value.maxTenancyMonths)) ||
      Number(value.maxTenancyMonths) < 1)
  )
    return "Minimum tenancy must be a positive whole number of months.";
  return null;
}
export function discoveryFilters(
  value: PropertyFilterState,
): PropertyDiscoveryFilters {
  const filters: PropertyDiscoveryFilters = {
    listingPurpose: value.listingPurpose,
  };
  for (const key of numericFields)
    if (value[key].trim()) filters[key] = Number(value[key]);
  if (value.propertyTypeId) filters.propertyTypeId = value.propertyTypeId;
  if (value.city.trim()) filters.city = value.city.trim();
  if (value.currencyCode) filters.currencyCode = value.currencyCode;
  if (value.pricePeriod)
    filters.pricePeriod =
      value.pricePeriod as PropertyDiscoveryFilters["pricePeriod"];
  if (value.bedrooms) {
    filters.minBedrooms = Number(value.bedrooms);
    if (value.bedrooms !== "4") filters.maxBedrooms = Number(value.bedrooms);
  }
  if (value.bathrooms) {
    filters.bathrooms = Number(value.bathrooms);
    if (value.bathrooms !== "4") filters.maxBathrooms = Number(value.bathrooms);
  }
  if (value.minFloorArea || value.maxFloorArea)
    filters.floorAreaUnit = value.floorAreaUnit as "SQM" | "SQFT";
  if (value.furnishedStatus)
    filters.furnishedStatus =
      value.furnishedStatus as PropertyDiscoveryFilters["furnishedStatus"];
  if (value.availableBy) filters.availableBy = value.availableBy;
  if (value.billsIncluded)
    filters.billsIncluded = value.billsIncluded === "YES";
  if (value.tenure.trim()) filters.tenure = value.tenure.trim();
  if (value.conditionKey) filters.conditionKey = value.conditionKey;
  return filters;
}
export function activeFilterCount(value: PropertyFilterState): number {
  return Object.entries(value).filter(
    ([key, entry]) =>
      !["listingPurpose", "floorAreaUnit"].includes(key) && Boolean(entry),
  ).length;
}
