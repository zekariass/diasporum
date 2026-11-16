import { z } from "zod";
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
    currencyCode: "GBP",
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

/** Field-keyed validation messages — rendered inline under each control so users can see exactly what to fix. */
export type PropertyFieldErrors = Record<string, string>;

function nonnegativeAmount(message: string) {
  return z
    .string(message)
    .refine(
      (value) =>
        value.trim() !== "" &&
        Number.isFinite(Number(value)) &&
        Number(value) >= 0,
      message,
    );
}

function optionalNonnegativeAmount(message: string) {
  return z
    .string()
    .refine(
      (value) =>
        value.trim() === "" ||
        (Number.isFinite(Number(value)) && Number(value) >= 0),
      message,
    );
}

function optionalNonnegativeInt(message: string) {
  return z
    .string()
    .refine(
      (value) =>
        value.trim() === "" ||
        (Number.isInteger(Number(value)) && Number(value) >= 0),
      message,
    );
}

const ROOM_COUNT_MESSAGE = "Room counts must be non-negative whole numbers.";

const STEP_SCHEMAS = [
  z.object({
    propertyTypeId: z
      .string("Choose a property type.")
      .min(1, "Choose a property type."),
    title: z
      .string("Enter a title of up to 220 characters.")
      .refine(
        (value) => value.trim().length > 0 && value.trim().length <= 220,
        "Enter a title of up to 220 characters.",
      ),
    description: z
      .string("Enter a description of up to 20,000 characters.")
      .refine(
        (value) => value.trim().length > 0 && value.trim().length <= 20000,
        "Enter a description of up to 20,000 characters.",
      ),
  }),
  z.object({
    priceAmount: nonnegativeAmount("Enter a valid, non-negative price."),
    currencyCode: z
      .string("Use a three-letter currency code, such as GBP.")
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, such as GBP."),
    floorArea: optionalNonnegativeAmount("Floor area must be non-negative."),
    bedrooms: optionalNonnegativeInt(ROOM_COUNT_MESSAGE),
    bathrooms: optionalNonnegativeInt(ROOM_COUNT_MESSAGE),
    receptionRooms: optionalNonnegativeInt(ROOM_COUNT_MESSAGE),
    availabilityDate: z
      .string()
      .refine((value) => {
        const trimmed = value.trim();
        if (!trimmed) return true;
        return (
          /^\d{4}-\d{2}-\d{2}$/.test(trimmed) &&
          !Number.isNaN(new Date(`${trimmed}T12:00:00`).getTime())
        );
      }, "Choose a valid availability date."),
  }),
  z.object({
    latitude: z
      .string()
      .refine(
        (value) =>
          value.trim() === "" ||
          (Number.isFinite(Number(value)) &&
            Number(value) >= -90 &&
            Number(value) <= 90),
        "Enter valid coordinates for the private address.",
      ),
    longitude: z
      .string()
      .refine(
        (value) =>
          value.trim() === "" ||
          (Number.isFinite(Number(value)) &&
            Number(value) >= -180 &&
            Number(value) <= 180),
        "Enter valid coordinates for the private address.",
      ),
  }),
  z.object({
    email: z
      .string()
      .refine(
        (value) =>
          value.trim() === "" ||
          /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()),
        "Enter a valid contact email.",
      ),
  }),
] as const;

/** Validates only the fields owned by one wizard step — the submit path still checks every step. */
export function propertyStepErrors(
  form: PropertyFormState,
  step: number,
): PropertyFieldErrors {
  const errors: PropertyFieldErrors = {};
  const schema = STEP_SCHEMAS[step];
  const parsed = schema?.safeParse(form);
  for (const issue of parsed?.error?.issues ?? []) {
    const key = String(issue.path[0] ?? "form");
    if (!errors[key]) errors[key] = issue.message;
  }

  // Cross-field rules that a single field schema cannot express.
  if (step === 1 && form.listingPurpose === "RENT") {
    if (
      form.rentalDeposit.trim() &&
      (!Number.isFinite(Number(form.rentalDeposit)) ||
        Number(form.rentalDeposit) < 0)
    )
      errors.rentalDeposit ??= "Deposit must be a non-negative amount.";
    if (
      form.minimumTenancyMonths.trim() &&
      (!Number.isInteger(Number(form.minimumTenancyMonths)) ||
        Number(form.minimumTenancyMonths) <= 0)
    )
      errors.minimumTenancyMonths ??=
        "Minimum tenancy must be a positive whole number.";
  }
  if (step === 2) {
    if (form.visibilityScope === "COMMUNITY" && !form.communityId)
      errors.communityId ??= "Choose a community audience.";
    if (
      form.visibilityScope === "SELECTED_COMMUNITIES" &&
      form.communityIds.length === 0
    )
      errors.communityIds ??= "Choose at least one community.";
    if (!form.city.trim() && !form.addressLine1.trim())
      errors.city ??= "Enter a city for the public location.";
    const hasLatitude = form.latitude.trim() !== "";
    const hasLongitude = form.longitude.trim() !== "";
    if (hasLatitude !== hasLongitude)
      errors.latitude ??=
        "Enter both latitude and longitude, or leave both empty.";
  }
  return errors;
}

/** First wizard step containing validation errors, or -1 when the whole form is valid. */
export function firstInvalidPropertyStep(form: PropertyFormState): number {
  for (let step = 0; step < PROPERTY_STEP_TITLES.length; step += 1) {
    if (Object.keys(propertyStepErrors(form, step)).length > 0) return step;
  }
  return -1;
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
