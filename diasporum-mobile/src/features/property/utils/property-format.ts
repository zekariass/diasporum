import type {
  FurnishedStatus,
  PropertyItem,
  PropertyStatus,
  PublicLocation,
} from "../types/property-types";

/** Human-readable listing status, e.g. "Pending review" — never raw enum text. */
export function statusLabel(status: PropertyStatus): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "PENDING_REVIEW":
      return "Pending review";
    case "PUBLISHED":
      return "Published";
    case "PAUSED":
      return "Paused";
    case "SOLD":
      return "Sold";
    case "RENTED":
      return "Rented";
    case "EXPIRED":
      return "Expired";
    case "REJECTED":
      return "Rejected";
    case "REMOVED":
      return "Removed";
    case "CLOSED":
      return "Closed";
  }
}

export function pricePeriodLabel(item: PropertyItem): string | null {
  const property = item.property;
  if (property.listingPurpose !== "RENT") return null;
  switch (property.pricePeriod) {
    case "WEEK":
      return "per week";
    case "YEAR":
      return "per year";
    case "MONTH":
      return "per month";
    default:
      return null;
  }
}

export function formatPrice(item: PropertyItem): string {
  const property = item.property;
  const amount = formatMoney(property.priceAmount, property.currencyCode);
  const period =
    property.listingPurpose === "RENT"
      ? property.pricePeriod === "WEEK"
        ? " / week"
        : property.pricePeriod === "YEAR"
          ? " / year"
          : property.pricePeriod === "MONTH"
            ? " / month"
            : ""
      : "";
  return `${amount}${period}`;
}

export function furnishedLabel(status: FurnishedStatus | null): string | null {
  switch (status) {
    case "FURNISHED":
      return "Furnished";
    case "PART_FURNISHED":
      return "Part furnished";
    case "UNFURNISHED":
      return "Unfurnished";
    default:
      return null;
  }
}

/** Haversine distance between the search origin and the approximate discovery point. */
export function distanceKm(
  origin: { latitude: number; longitude: number },
  location: PublicLocation | null,
): number | null {
  if (
    location?.latitude == null ||
    location.longitude == null ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude)
  )
    return null;
  const rad = Math.PI / 180;
  const dLat = (location.latitude - origin.latitude) * rad;
  const dLng = (location.longitude - origin.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(origin.latitude * rad) *
      Math.cos(location.latitude * rad) *
      Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function formatDistanceValue(km: number): string {
  return `${km < 10 ? Math.round(km * 100) / 100 : Math.round(km)}`;
}

export function formatDistanceKm(km: number): string {
  return `${formatDistanceValue(km)} km`;
}

export function locationLabel(location: PublicLocation | null): string {
  return (
    [location?.city, location?.region, location?.countryName]
      .filter(Boolean)
      .join(", ") || "Location shared approximately"
  );
}

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${Number(value).toLocaleString()}`;
  }
}

export function publishedLabel(value: string | null): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  const days = Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
  return days === 0
    ? "Published today"
    : days === 1
      ? "Published yesterday"
      : days < 30
        ? `Published ${days} days ago`
        : `Published ${new Date(value).toLocaleDateString()}`;
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
