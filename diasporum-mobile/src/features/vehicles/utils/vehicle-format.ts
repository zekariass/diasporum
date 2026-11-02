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
  const formatted = Number.isFinite(amount)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount)
    : String(vehicle.priceAmount);
  const period = vehicle.listingPurpose === "RENT" && vehicle.pricePeriod
    ? ` / ${vehicleLabel(vehicle.pricePeriod).toLowerCase()}`
    : "";
  return `${vehicle.currencyCode ?? ""} ${formatted}${period}`.trim();
}

export function formatVehicleLocation(location: VehicleLocation | null): string {
  if (!location) return "General area not provided";
  return [location.city, location.region, location.formattedAddress]
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
    .join(", ") || "General area not provided";
}

export function formatVehicleSummary(vehicle: VehicleListing): string {
  return [
    vehicle.makeName,
    vehicle.modelName,
    vehicle.modelYear,
    vehicle.mileage !== null ? `${vehicle.mileage.toLocaleString()} ${vehicle.mileageUnit === "KM" ? "km" : "miles"}` : null,
    vehicle.categoryName,
  ].filter(Boolean).join(" · ");
}

export function formatVehicleDistance(distanceMeters: number | null): string | null {
  if (distanceMeters === null) return null;
  return distanceMeters < 1000
    ? `${Math.round(distanceMeters)} m away`
    : `${(distanceMeters / 1000).toFixed(1)} km away`;
}
