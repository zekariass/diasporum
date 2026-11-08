import type {
  FurnishedStatus,
  ListingPurpose,
  PropertyCommand,
  PropertyDetail,
  PropertyImageSelection,
  PropertyVisibility,
} from "../types/property-types";

export interface PropertyFormState {
  countryId: string;
  businessAccountId?: string;
  businessListingId?: string;
  propertyTypeId?: string;
  visibilityScope: PropertyVisibility;
  communityId?: string;
  communityIds: string[];
  listingPurpose: ListingPurpose;
  title: string;
  description: string;
  priceAmount: string;
  currencyCode: string;
  pricePeriod: "WEEK" | "MONTH" | "YEAR";
  bedrooms: string;
  bathrooms: string;
  receptionRooms: string;
  floorArea: string;
  floorAreaUnit: "SQM" | "SQFT";
  furnishedStatus?: FurnishedStatus;
  rentalDeposit: string;
  billsIncluded: boolean;
  minimumTenancyMonths: string;
  availabilityDate: string;
  tenure: string;
  conditionKey: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  phone: string;
  whatsapp: string;
  email: string;
  preferredMethod?: "PHONE" | "WHATSAPP" | "EMAIL";
  showPhone: boolean;
  showWhatsapp: boolean;
  showEmail: boolean;
  amenityIds: string[];
  additionalAttributes?: Record<string, unknown>;
  images: PropertyImageSelection[];
}

export function initialPropertyForm(countryId: string, communityId?: string): PropertyFormState {
  return {
    countryId,
    visibilityScope: communityId ? "COMMUNITY" : "COUNTRY",
    communityId,
    communityIds: [],
    listingPurpose: "RENT",
    title: "",
    description: "",
    priceAmount: "",
    currencyCode: "EUR",
    pricePeriod: "MONTH",
    bedrooms: "",
    bathrooms: "",
    receptionRooms: "",
    floorArea: "",
    floorAreaUnit: "SQM",
    rentalDeposit: "",
    billsIncluded: false,
    minimumTenancyMonths: "",
    availabilityDate: "",
    tenure: "",
    conditionKey: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    postalCode: "",
    latitude: "",
    longitude: "",
    phone: "",
    whatsapp: "",
    email: "",
    showPhone: true,
    showWhatsapp: true,
    showEmail: true,
    amenityIds: [],
    images: [],
  };
}

export function propertyFormFromDetail(detail: PropertyDetail): PropertyFormState {
  const property = detail.item.property;
  const address = detail.privateAddress;
  return {
    ...initialPropertyForm(property.countryId, property.communityId ?? undefined),
    businessAccountId: property.businessAccountId ?? undefined,
    businessListingId: property.businessListingId ?? undefined,
    propertyTypeId: property.propertyTypeId,
    visibilityScope: property.visibilityScope,
    communityIds: detail.communityIds ?? [],
    listingPurpose: property.listingPurpose,
    title: property.title,
    description: property.description,
    priceAmount: String(property.priceAmount),
    currencyCode: property.currencyCode,
    pricePeriod: property.pricePeriod === "WEEK" || property.pricePeriod === "YEAR" ? property.pricePeriod : "MONTH",
    bedrooms: optionalString(property.bedrooms),
    bathrooms: optionalString(property.bathrooms),
    receptionRooms: optionalString(property.receptionRooms),
    floorArea: optionalString(property.floorArea),
    floorAreaUnit: property.floorAreaUnit ?? "SQM",
    furnishedStatus: property.furnishedStatus ?? undefined,
    rentalDeposit: optionalString(property.rentalDeposit),
    billsIncluded: Boolean(property.billsIncluded),
    minimumTenancyMonths: optionalString(property.minimumTenancyMonths),
    availabilityDate: property.availabilityDate ?? "",
    tenure: property.tenure ?? "",
    conditionKey: property.conditionKey ?? "",
    addressLine1: address?.addressLine1 ?? "",
    addressLine2: address?.addressLine2 ?? "",
    city: address?.city ?? detail.item.location?.city ?? "",
    region: address?.region ?? detail.item.location?.region ?? "",
    postalCode: address?.postalCode ?? "",
    latitude: address?.latitude != null ? String(address.latitude) : "",
    longitude: address?.longitude != null ? String(address.longitude) : "",
    phone: detail.contact?.phone ?? "",
    whatsapp: detail.contact?.whatsapp ?? "",
    email: detail.contact?.email ?? "",
    preferredMethod: detail.contact?.preferredMethod ?? undefined,
    amenityIds: detail.amenities.map((amenity) => amenity.id),
    additionalAttributes: property.additionalAttributes ?? undefined,
  };
}

export const PROPERTY_STEP_TITLES = [
  "Listing basics",
  "Price & details",
  "Audience & location",
  "Amenities & contact",
  "Photos",
] as const;

/** Validates only the fields owned by one wizard step — the submit path still runs validatePropertyForm. */
export function validatePropertyStep(form: PropertyFormState, step: number): string | null {
  if (step === 0) {
    if (!form.propertyTypeId) return "Choose a property type.";
    if (!form.title.trim() || form.title.trim().length > 220) return "Enter a title of up to 220 characters.";
    if (!form.description.trim() || form.description.trim().length > 20000) return "Enter a description of up to 20,000 characters.";
    return null;
  }
  if (step === 1) {
    if (!validNonnegative(form.priceAmount)) return "Enter a valid, non-negative price.";
    if (!/^[A-Z]{3}$/.test(form.currencyCode)) return "Use a three-letter currency code, such as EUR.";
    if (form.floorArea.trim() && !validNonnegative(form.floorArea)) return "Floor area must be non-negative.";
    for (const value of [form.bedrooms, form.bathrooms, form.receptionRooms]) {
      if (value.trim() && (!Number.isInteger(Number(value)) || Number(value) < 0)) return "Room counts must be non-negative whole numbers.";
    }
    if (form.listingPurpose === "RENT" && form.minimumTenancyMonths.trim() && (!Number.isInteger(Number(form.minimumTenancyMonths)) || Number(form.minimumTenancyMonths) <= 0)) return "Minimum tenancy must be a positive whole number.";
    return null;
  }
  if (step === 2) {
    if (form.visibilityScope === "COMMUNITY" && !form.communityId) return "Choose a community audience.";
    if (form.visibilityScope === "SELECTED_COMMUNITIES" && form.communityIds.length === 0) return "Choose at least one community.";
    if (!form.city.trim() && !form.addressLine1.trim()) return "Enter a city for the public location.";
    const hasLat = form.latitude.trim() !== "";
    const hasLng = form.longitude.trim() !== "";
    if (hasLat !== hasLng) return "Enter both latitude and longitude, or leave both empty.";
    if (hasLat) {
      const latitude = Number(form.latitude);
      const longitude = Number(form.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return "Enter valid coordinates for the private address.";
    }
    return null;
  }
  if (step === 3 && form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return "Enter a valid contact email.";
  return null;
}

export function validatePropertyForm(form: PropertyFormState): string | null {
  if (!form.countryId) return "Your current country is required.";
  for (let step = 0; step < PROPERTY_STEP_TITLES.length; step++) {
    const message = validatePropertyStep(form, step);
    if (message) return message;
  }
  return null;
}

export function propertyCommandFromForm(form: PropertyFormState): PropertyCommand {
  const hasContact = Boolean(form.phone.trim() || form.whatsapp.trim() || form.email.trim());
  return {
    countryId: form.countryId,
    businessAccountId: form.businessAccountId,
    businessListingId: form.businessAccountId ? form.businessListingId : undefined,
    propertyTypeId: form.propertyTypeId as string,
    visibilityScope: form.visibilityScope,
    communityId: form.visibilityScope === "COMMUNITY" ? form.communityId : undefined,
    communityIds: form.visibilityScope === "SELECTED_COMMUNITIES" ? form.communityIds : undefined,
    listingPurpose: form.listingPurpose,
    title: form.title.trim(),
    description: form.description.trim(),
    additionalAttributes: form.additionalAttributes,
    priceAmount: Number(form.priceAmount),
    currencyCode: form.currencyCode,
    pricePeriod: form.listingPurpose === "SALE" ? "TOTAL" : form.pricePeriod,
    address: {
      addressLine1: optionalText(form.addressLine1),
      addressLine2: optionalText(form.addressLine2),
      city: optionalText(form.city),
      region: optionalText(form.region),
      postalCode: optionalText(form.postalCode),
      latitude: optionalNumber(form.latitude),
      longitude: optionalNumber(form.longitude),
    },
    bedrooms: optionalNumber(form.bedrooms),
    bathrooms: optionalNumber(form.bathrooms),
    receptionRooms: optionalNumber(form.receptionRooms),
    floorArea: optionalNumber(form.floorArea),
    floorAreaUnit: form.floorArea.trim() ? form.floorAreaUnit : undefined,
    furnishedStatus: form.furnishedStatus,
    rentalDeposit: form.listingPurpose === "RENT" ? optionalNumber(form.rentalDeposit) : undefined,
    billsIncluded: form.listingPurpose === "RENT" ? form.billsIncluded : undefined,
    minimumTenancyMonths: form.listingPurpose === "RENT" ? optionalNumber(form.minimumTenancyMonths) : undefined,
    availabilityDate: optionalText(form.availabilityDate),
    tenure: optionalText(form.tenure),
    conditionKey: optionalText(form.conditionKey),
    amenityIds: form.amenityIds,
    contact: hasContact ? {
      phone: optionalText(form.phone),
      whatsapp: optionalText(form.whatsapp),
      email: optionalText(form.email),
      preferredMethod: form.preferredMethod,
      showPhone: form.showPhone,
      showWhatsapp: form.showWhatsapp,
      showEmail: form.showEmail,
    } : undefined,
  };
}

function optionalText(value: string): string | undefined {
  return value.trim() || undefined;
}
function optionalNumber(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}
function optionalString(value: number | null): string {
  return value === null ? "" : String(value);
}
function validNonnegative(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
}
