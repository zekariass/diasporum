import type { VehicleListing, VehicleLocation } from "../types/vehicle-types";

export function vehicleLabel(value: string | null | undefined): string {
  if (!value) return "Not specified";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatVehiclePrice(vehicle: VehicleListing): string {
  if (vehicle.priceAmount === null) return "Price not provided";
  const amount = Number(vehicle.priceAmount);
  let formatted = String(vehicle.priceAmount);
  if (Number.isFinite(amount)) {
    try {
      formatted = new Intl.NumberFormat(undefined, {
        style: vehicle.currencyCode ? "currency" : "decimal",
        currency: vehicle.currencyCode ?? undefined,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      formatted =
        `${vehicle.currencyCode ?? ""} ${amount.toLocaleString()}`.trim();
    }
  }
  const period =
    vehicle.listingPurpose === "RENT" &&
    vehicle.pricePeriod &&
    vehicle.pricePeriod !== "TOTAL"
      ? ` / ${vehicleLabel(vehicle.pricePeriod).toLowerCase()}`
      : "";
  return `${formatted}${period}`;
}

export function formatVehicleLocation(
  location: VehicleLocation | null,
): string {
  if (!location) return "General area not provided";
  return (
    [location.city, location.region]
      .filter(
        (value, index, values) =>
          Boolean(value) && values.indexOf(value) === index,
      )
      .join(", ") || "General area not provided"
  );
}

export function formatVehicleMileage(vehicle: VehicleListing): string | null {
  if (vehicle.mileage == null) return null;
  const unit =
    vehicle.mileageUnit === "KM"
      ? "km"
      : vehicle.mileageUnit === "MILES"
        ? "mi"
        : null;
  return unit ? `${vehicle.mileage.toLocaleString()} ${unit}` : null;
}

export function formatVehiclePublished(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const days = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 86400000),
  );
  if (days === 0) return "Advertised today";
  if (days === 1) return "Advertised 1 day ago";
  if (days < 30) return `Advertised ${days} days ago`;
  return `Advertised ${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

export function formatVehicleSummary(vehicle: VehicleListing): string {
  return [
    vehicle.makeName,
    vehicle.modelName,
    vehicle.modelYear,
    vehicle.mileage !== null
      ? `${vehicle.mileage.toLocaleString()} ${vehicle.mileageUnit === "KM" ? "km" : "miles"}`
      : null,
    vehicle.categoryName,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatVehicleDistance(
  distanceMeters: number | null,
): string | null {
  if (distanceMeters === null) return null;
  return distanceMeters < 1000
    ? `${Math.round(distanceMeters)} m away`
    : `${(distanceMeters / 1000).toFixed(1)} km away`;
}

/** Compact mileage like "139k+ miles" for spec chips. */
export function formatVehicleMileageCompact(
  vehicle: VehicleListing,
): string | null {
  if (vehicle.mileage == null) return null;
  const unit =
    vehicle.mileageUnit === "KM"
      ? "km"
      : vehicle.mileageUnit === "MILES"
        ? "miles"
        : null;
  if (!unit) return null;
  return vehicle.mileage >= 1000
    ? `${Math.floor(vehicle.mileage / 1000)}k+ ${unit}`
    : `${vehicle.mileage.toLocaleString()} ${unit}`;
}

/** "1.8L" style engine label from cc. */
export function formatVehicleEngine(vehicle: VehicleListing): string | null {
  if (vehicle.engineSizeCc == null) return null;
  const litres = vehicle.engineSizeCc / 1000;
  return `${litres.toFixed(1)}L`;
}

/** Subtitle line like "2007 (07) - 1.8 LX 5dr". */
export function vehicleSubtitle(vehicle: VehicleListing): string {
  const year =
    vehicle.modelYear != null
      ? vehicle.registrationYear != null &&
        vehicle.registrationYear !== vehicle.modelYear
        ? `${vehicle.modelYear} (${String(vehicle.registrationYear).slice(-2)})`
        : String(vehicle.modelYear)
      : null;
  const spec = [
    formatVehicleEngine(vehicle),
    vehicle.variantName,
    vehicle.doors != null ? `${vehicle.doors}dr` : null,
    vehicle.bodyType && !vehicle.variantName && vehicle.engineSizeCc == null
      ? vehicleLabel(vehicle.bodyType)
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  return [year, spec || null].filter(Boolean).join(" - ");
}

/** First non-empty line of the listing description, used as highlight text. */
export function firstDescriptionLine(
  description: string | null | undefined,
): string | null {
  const line = (description ?? "")
    .split(/\r?\n/)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .find((value) => value.length > 0);
  if (!line) return null;
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}
