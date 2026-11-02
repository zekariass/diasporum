import type { PropertyItem, PublicLocation } from "../types/property-types";

export function formatPrice(item: PropertyItem): string {
  const property = item.property;
  const amount = Number(property.priceAmount).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
  const period =
    property.listingPurpose === "RENT"
      ? property.pricePeriod === "WEEK"
        ? " / week"
        : property.pricePeriod === "YEAR"
          ? " / year"
          : " / month"
      : "";
  return `${property.currencyCode} ${amount}${period}`;
}

export function locationLabel(location: PublicLocation | null): string {
  return [location?.city, location?.region].filter(Boolean).join(", ") ||
    "Location shared approximately";
}

export function propertyFacts(item: PropertyItem): string {
  const property = item.property;
  return [
    property.bedrooms !== null ? `${property.bedrooms} bed` : null,
    property.bathrooms !== null ? `${property.bathrooms} bath` : null,
    property.floorArea !== null
      ? `${property.floorArea} ${property.floorAreaUnit === "SQFT" ? "ft²" : "m²"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
