import type {
  VehicleAttributePolicy,
  VehicleAttributeValue,
  VehicleCategory,
  VehicleMediaItem,
  VehiclePurpose,
  VehicleRequest,
  VehicleView,
  VehicleVisibility,
} from "../types/vehicle-types";

export interface VehicleFormState {
  businessAccountId: string | null;
  visibilityScope: VehicleVisibility;
  communityId: string;
  selectedCommunityIds: string[];
  listingPurpose: VehiclePurpose;
  categoryId: string;
  makeId: string;
  modelId: string;
  variantId: string;
  title: string;
  description: string;
  modelYear: string;
  registrationYear: string;
  mileage: string;
  mileageUnit: string;
  fuelType: string;
  transmission: string;
  driveType: string;
  bodyType: string;
  engineSizeCc: string;
  colour: string;
  doors: string;
  seats: string;
  condition: string;
  previousOwners: string;
  motExpiry: string;
  serviceHistory: string;
  priceAmount: string;
  currencyCode: string;
  pricePeriod: "TOTAL" | "DAY" | "WEEK" | "MONTH";
  rentalDeposit: string;
  mileageAllowance: string;
  rentalConditions: string;
  city: string;
  region: string;
  formattedAddress: string;
  discoveryLatitude: number | null;
  discoveryLongitude: number | null;
  expiresAt: string;
  featureIds: string[];
  additionalAttributes: Record<string, string>;
  media: VehicleMediaItem[];
}

export function initialVehicleFormState(activeCommunityId = ""): VehicleFormState {
  return {
    businessAccountId: null,
    visibilityScope: "COMMUNITY",
    communityId: activeCommunityId,
    selectedCommunityIds: [],
    listingPurpose: "SALE",
    categoryId: "",
    makeId: "",
    modelId: "",
    variantId: "",
    title: "",
    description: "",
    modelYear: "",
    registrationYear: "",
    mileage: "",
    mileageUnit: "KM",
    fuelType: "UNKNOWN",
    transmission: "UNKNOWN",
    driveType: "UNKNOWN",
    bodyType: "UNKNOWN",
    engineSizeCc: "",
    colour: "",
    doors: "",
    seats: "",
    condition: "",
    previousOwners: "",
    motExpiry: "",
    serviceHistory: "",
    priceAmount: "",
    currencyCode: "EUR",
    pricePeriod: "TOTAL",
    rentalDeposit: "",
    mileageAllowance: "",
    rentalConditions: "",
    city: "",
    region: "",
    formattedAddress: "",
    discoveryLatitude: null,
    discoveryLongitude: null,
    expiresAt: "",
    featureIds: [],
    additionalAttributes: {},
    media: [],
  };
}

export function vehicleFormStateFromDetail(detail: VehicleView): VehicleFormState {
  const vehicle = detail.listing;
  return {
    ...initialVehicleFormState(vehicle.communityId ?? ""),
    businessAccountId: vehicle.businessAccountId,
    visibilityScope: vehicle.visibilityScope,
    selectedCommunityIds: detail.selectedCommunityIds,
    listingPurpose: vehicle.listingPurpose,
    categoryId: vehicle.categoryId,
    makeId: vehicle.makeId ?? "",
    modelId: vehicle.modelId ?? "",
    variantId: vehicle.variantId ?? "",
    title: vehicle.title,
    description: vehicle.description,
    modelYear: text(vehicle.modelYear),
    registrationYear: text(vehicle.registrationYear),
    mileage: text(vehicle.mileage),
    mileageUnit: vehicle.mileageUnit ?? "KM",
    fuelType: vehicle.fuelType ?? "UNKNOWN",
    transmission: vehicle.transmission ?? "UNKNOWN",
    driveType: vehicle.driveType ?? "UNKNOWN",
    bodyType: vehicle.bodyType ?? "UNKNOWN",
    engineSizeCc: text(vehicle.engineSizeCc),
    colour: vehicle.colour ?? "",
    doors: text(vehicle.doors),
    seats: text(vehicle.seats),
    condition: vehicle.conditionKey ?? "",
    previousOwners: text(vehicle.previousOwners),
    motExpiry: vehicle.motExpiry ?? "",
    serviceHistory: vehicle.serviceHistory ?? "",
    priceAmount: vehicle.priceAmount === null ? "" : String(vehicle.priceAmount),
    currencyCode: vehicle.currencyCode ?? "EUR",
    pricePeriod: vehicle.pricePeriod ?? (vehicle.listingPurpose === "SALE" ? "TOTAL" : "DAY"),
    rentalDeposit: vehicle.rentalDeposit === null ? "" : String(vehicle.rentalDeposit),
    mileageAllowance: text(vehicle.mileageAllowance),
    rentalConditions: vehicle.rentalConditions ?? "",
    city: detail.location?.city ?? "",
    region: detail.location?.region ?? "",
    formattedAddress: detail.location?.formattedAddress ?? "",
    expiresAt: vehicle.expiresAt?.slice(0, 10) ?? "",
    featureIds: detail.features.map((feature) => feature.id),
    additionalAttributes: Object.fromEntries(
      Object.entries(vehicle.additionalAttributes).map(([key, value]) => [key, String(value)]),
    ),
    media: detail.media.map((media) => ({
      id: media.id,
      uri: media.downloadUrl,
      selection: null,
      cover: media.cover,
    })),
  };
}

function text(value: number | null): string {
  return value === null ? "" : String(value);
}

function optional(value: string): string | undefined {
  return value.trim() || undefined;
}

function number(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function expiry(value: string): string | undefined {
  return value ? new Date(`${value}T23:59:59.999Z`).toISOString() : undefined;
}

const CORE_STATE_KEYS: Record<string, keyof VehicleFormState> = {
  modelYear: "modelYear",
  registrationYear: "registrationYear",
  mileage: "mileage",
  fuelType: "fuelType",
  transmission: "transmission",
  driveType: "driveType",
  bodyType: "bodyType",
  engineSizeCc: "engineSizeCc",
  colour: "colour",
  doors: "doors",
  seats: "seats",
  condition: "condition",
  previousOwners: "previousOwners",
  motExpiry: "motExpiry",
  serviceHistory: "serviceHistory",
  pricePeriod: "pricePeriod",
  rentalDeposit: "rentalDeposit",
  mileageAllowance: "mileageAllowance",
  rentalConditions: "rentalConditions",
};

export function vehicleFieldVisible(category: VehicleCategory | undefined, field: string): boolean {
  return !category || category.coreFields.includes(field);
}

export function validateVehicleForm(
  form: VehicleFormState,
  publishing = true,
  now = new Date(),
  category?: VehicleCategory,
): string | null {
  if (!form.categoryId) return "Select a vehicle category.";
  if (!form.title.trim()) return "Enter a vehicle title.";
  if (!form.description.trim()) return "Enter a vehicle description.";
  if (form.visibilityScope === "COMMUNITY" && !form.communityId) {
    return "Select an active community for this vehicle.";
  }
  if (form.visibilityScope === "SELECTED_COMMUNITIES" && form.selectedCommunityIds.length === 0) {
    return "Select at least one community for this vehicle.";
  }
  const numericFields: [string, string, number, number?][] = [
    ["Model year", form.modelYear, 1886, 2200],
    ["Registration year", form.registrationYear, 1886, 2200],
    ["Mileage", form.mileage, 0],
    ["Engine size", form.engineSizeCc, 0],
    ["Doors", form.doors, 1],
    ["Seats", form.seats, 1],
    ["Previous owners", form.previousOwners, 0],
    ["Price", form.priceAmount, 0],
    ["Rental deposit", form.rentalDeposit, 0],
    ["Mileage allowance", form.mileageAllowance, 0],
  ];
  for (const [label, raw, minimum, maximum] of numericFields) {
    if (!raw.trim()) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < minimum || (maximum !== undefined && value > maximum)) {
      return `${label} must be ${maximum === undefined ? `at least ${minimum}` : `between ${minimum} and ${maximum}`}.`;
    }
  }
  if (!form.priceAmount.trim()) return "Enter a non-negative vehicle price.";
  if (!/^[A-Za-z]{3}$/.test(form.currencyCode)) return "Enter a three-letter currency.";
  if (form.motExpiry && !validDate(form.motExpiry)) return "MOT expiry must use YYYY-MM-DD.";
  if (form.expiresAt) {
    if (!validDate(form.expiresAt)) return "Listing expiry must use YYYY-MM-DD.";
    if (publishing && new Date(`${form.expiresAt}T23:59:59.999Z`).getTime() <= now.getTime()) {
      return "Listing expiry must be in the future before publishing.";
    }
  }
  const hasLocation = Boolean(
    form.city.trim() || form.region.trim() || form.formattedAddress.trim(),
  );
  if (publishing && !hasLocation) return "Enter a public city, region, or general area.";
  if (!hasLocation && (form.discoveryLatitude !== null || form.discoveryLongitude !== null)) {
    return "Enter a public general area before adding an approximate discovery point.";
  }
  if ((form.discoveryLatitude === null) !== (form.discoveryLongitude === null)) {
    return "The approximate discovery point is incomplete.";
  }
  if (form.media.length > 5) return "Attach no more than five vehicle images.";
  for (const required of category?.requiredCoreFields ?? []) {
    const key = CORE_STATE_KEYS[required];
    if (key && !String(form[key] ?? "").trim()) return `Complete the required ${required} field.`;
  }
  for (const [key, policy] of Object.entries(category?.attributes ?? {})) {
    const error = validateAttribute(key, form.additionalAttributes[key], policy);
    if (error) return error;
  }
  for (const key of Object.keys(form.additionalAttributes)) {
    if (category && !category.attributes[key] && form.additionalAttributes[key].trim()) {
      return `${key} is not approved for this vehicle category.`;
    }
  }
  return null;
}

function validateAttribute(
  key: string,
  raw: string | undefined,
  policy: VehicleAttributePolicy,
): string | null {
  if (policy.required && !raw?.trim()) return `Complete the required ${key} attribute.`;
  if (!raw?.trim()) return null;
  const type = policy.type || "STRING";
  if (["NUMBER", "INTEGER"].includes(type)) {
    const value = Number(raw);
    if (!Number.isFinite(value) || (type === "INTEGER" && !Number.isInteger(value))) {
      return `${key} must be a valid ${type === "INTEGER" ? "integer" : "number"}.`;
    }
    if ((policy.minimum !== null && value < policy.minimum) ||
        (policy.maximum !== null && value > policy.maximum)) {
      return `${key} is outside its permitted range.`;
    }
  }
  if (type === "BOOLEAN" && !["true", "false"].includes(raw)) return `${key} must be true or false.`;
  if (policy.options.length && !policy.options.includes(raw)) return `${key} has an invalid option.`;
  return null;
}

function typedAttributes(
  form: VehicleFormState,
  category?: VehicleCategory,
): Record<string, VehicleAttributeValue> {
  return Object.fromEntries(
    Object.entries(form.additionalAttributes)
      .filter(([key, value]) => value.trim() && (!category || category.attributes[key]))
      .map(([key, value]) => {
        const type = category?.attributes[key]?.type;
        const parsed = ["NUMBER", "INTEGER"].includes(type ?? "")
          ? Number(value)
          : type === "BOOLEAN"
            ? value === "true"
            : value.trim();
        return [key, parsed];
      }),
  );
}

export function toVehicleRequest(
  form: VehicleFormState,
  editing = false,
  category?: VehicleCategory,
): VehicleRequest {
  const hasLocation = Boolean(form.city.trim() || form.region.trim() || form.formattedAddress.trim());
  const request: VehicleRequest = {
    ...(editing ? {} : { businessAccountId: form.businessAccountId ?? undefined }),
    visibilityScope: form.visibilityScope,
    communityId: form.visibilityScope === "COMMUNITY" ? form.communityId : undefined,
    selectedCommunityIds: form.visibilityScope === "SELECTED_COMMUNITIES"
      ? form.selectedCommunityIds
      : [],
    listingPurpose: form.listingPurpose,
    categoryId: form.categoryId,
    makeId: optional(form.makeId),
    modelId: optional(form.modelId),
    variantId: optional(form.variantId),
    title: form.title.trim(),
    description: form.description.trim(),
    modelYear: number(form.modelYear),
    mileage: number(form.mileage),
    mileageUnit: form.mileageUnit,
    fuelType: form.fuelType,
    transmission: form.transmission,
    driveType: form.driveType,
    bodyType: form.bodyType,
    engineSizeCc: number(form.engineSizeCc),
    colour: optional(form.colour),
    doors: number(form.doors),
    seats: number(form.seats),
    condition: optional(form.condition),
    registrationYear: number(form.registrationYear),
    previousOwners: number(form.previousOwners),
    additionalAttributes: typedAttributes(form, category),
    motExpiry: optional(form.motExpiry),
    serviceHistory: optional(form.serviceHistory),
    priceAmount: number(form.priceAmount),
    currencyCode: form.currencyCode.toUpperCase(),
    pricePeriod: form.listingPurpose === "SALE" ? "TOTAL" : form.pricePeriod,
    rentalDeposit: form.listingPurpose === "RENT" ? number(form.rentalDeposit) : undefined,
    mileageAllowance: form.listingPurpose === "RENT" ? number(form.mileageAllowance) : undefined,
    rentalConditions: form.listingPurpose === "RENT" ? optional(form.rentalConditions) : undefined,
    location: hasLocation ? {
      city: optional(form.city),
      region: optional(form.region),
      formattedAddress: optional(form.formattedAddress),
      ...(form.discoveryLatitude !== null && form.discoveryLongitude !== null ? {
        discoveryLatitude: form.discoveryLatitude,
        discoveryLongitude: form.discoveryLongitude,
      } : {}),
    } : undefined,
    featureIds: form.featureIds,
    expiresAt: expiry(form.expiresAt),
    clearLocation: editing && !hasLocation,
    clearExpiry: editing && !form.expiresAt,
    clearFields: editing ? [
      ...Object.entries(CORE_STATE_KEYS)
        .filter(([, key]) => !String(form[key] ?? "").trim())
        .map(([field]) => field),
      ...(form.listingPurpose === "SALE"
        ? ["rentalDeposit", "mileageAllowance", "rentalConditions"]
        : []),
    ] : [],
  };
  return request;
}

export function moveVehicleMedia(
  media: VehicleMediaItem[],
  id: string,
  direction: -1 | 1,
): VehicleMediaItem[] {
  const index = media.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= media.length) return media;
  const next = [...media];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function setVehicleCover(media: VehicleMediaItem[], id: string): VehicleMediaItem[] {
  return media.map((item) => ({ ...item, cover: item.id === id }));
}
