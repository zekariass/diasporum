import { z } from "zod";
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
  businessListingId: string | null;
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
  contactPhone: string;
  contactWhatsapp: string;
  contactEmail: string;
  contactPreferredMethod: string;
  contactShowPhone: boolean;
  contactShowWhatsapp: boolean;
  contactShowEmail: boolean;
}

export function initialVehicleFormState(
  activeCommunityId = "",
): VehicleFormState {
  return {
    businessAccountId: null,
    businessListingId: null,
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
    contactPhone: "",
    contactWhatsapp: "",
    contactEmail: "",
    contactPreferredMethod: "MESSAGING",
    contactShowPhone: false,
    contactShowWhatsapp: false,
    contactShowEmail: false,
  };
}

export function vehicleFormStateFromDetail(
  detail: VehicleView,
): VehicleFormState {
  const vehicle = detail.listing;
  return {
    ...initialVehicleFormState(vehicle.communityId ?? ""),
    businessAccountId: vehicle.businessAccountId,
    businessListingId: vehicle.businessListingId,
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
    priceAmount:
      vehicle.priceAmount === null ? "" : String(vehicle.priceAmount),
    currencyCode: vehicle.currencyCode ?? "EUR",
    pricePeriod:
      vehicle.pricePeriod ??
      (vehicle.listingPurpose === "SALE" ? "TOTAL" : "DAY"),
    rentalDeposit:
      vehicle.rentalDeposit === null ? "" : String(vehicle.rentalDeposit),
    mileageAllowance: text(vehicle.mileageAllowance),
    rentalConditions: vehicle.rentalConditions ?? "",
    city: detail.location?.city ?? "",
    region: detail.location?.region ?? "",
    formattedAddress: detail.location?.formattedAddress ?? "",
    expiresAt: vehicle.expiresAt?.slice(0, 10) ?? "",
    featureIds: detail.features.map((feature) => feature.id),
    additionalAttributes: Object.fromEntries(
      Object.entries(vehicle.additionalAttributes).map(([key, value]) => [
        key,
        String(value),
      ]),
    ),
    media: detail.media.map((media) => ({
      id: media.id,
      uri: media.downloadUrl,
      selection: null,
      cover: media.cover,
    })),
    contactPhone: detail.contact?.phone ?? "",
    contactWhatsapp: detail.contact?.whatsapp ?? "",
    contactEmail: detail.contact?.email ?? "",
    contactPreferredMethod: detail.contact?.preferredMethod ?? "MESSAGING",
    contactShowPhone:
      detail.contact?.showPhone ?? Boolean(detail.contact?.phone),
    contactShowWhatsapp:
      detail.contact?.showWhatsapp ?? Boolean(detail.contact?.whatsapp),
    contactShowEmail:
      detail.contact?.showEmail ?? Boolean(detail.contact?.email),
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
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
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

export function vehicleFieldVisible(
  category: VehicleCategory | undefined,
  field: string,
): boolean {
  return !category || category.coreFields.includes(field);
}

export const VEHICLE_STEP_TITLES = [
  "Vehicle basics",
  "Specifications",
  "Pricing",
  "Audience & contact",
  "Location & photos",
  "Review",
] as const;

/** Field-keyed validation messages — rendered inline under each control. */
export type VehicleFieldErrors = Record<string, string>;

const requiredText = (message: string) =>
  z.string().refine((value) => value.trim().length > 0, message);

function optionalNumberInRange(
  label: string,
  minimum: number,
  maximum?: number,
) {
  return z.string().refine((value) => {
    const raw = value.trim();
    if (!raw) return true;
    const parsed = Number(raw);
    return (
      Number.isFinite(parsed) &&
      parsed >= minimum &&
      (maximum === undefined || parsed <= maximum)
    );
  }, maximum === undefined
    ? `${label} must be at least ${minimum}.`
    : `${label} must be between ${minimum} and ${maximum}.`);
}

function optionalNonnegative(label: string) {
  return z.string().refine((value) => {
    const raw = value.trim();
    return !raw || (Number.isFinite(Number(raw)) && Number(raw) >= 0);
  }, `${label} must be at least 0.`);
}

function optionalIsoDate(label: string) {
  return z
    .string()
    .refine(
      (value) => !value || validDate(value),
      `${label} must use YYYY-MM-DD.`,
    );
}

const basicsSchema = z.object({
  categoryId: requiredText("Select a vehicle category."),
  title: requiredText("Enter a vehicle title."),
  description: requiredText("Enter a vehicle description."),
});

const specificationSchema = z.object({
  modelYear: optionalNumberInRange("Model year", 1886, 2200),
  registrationYear: optionalNumberInRange("Registration year", 1886, 2200),
  mileage: optionalNumberInRange("Mileage", 0),
  engineSizeCc: optionalNumberInRange("Engine size", 0),
  doors: optionalNumberInRange("Doors", 1),
  seats: optionalNumberInRange("Seats", 1),
  previousOwners: optionalNumberInRange("Previous owners", 0),
  motExpiry: optionalIsoDate("MOT expiry"),
});

function pricingSchema(publishing: boolean, now: Date) {
  return z
    .object({
      priceAmount: z
        .string()
        .refine((value) => {
          const raw = value.trim();
          return (
            !raw || (Number.isFinite(Number(raw)) && Number(raw) >= 0)
          );
        }, "Price must be at least 0.")
        .refine(
          (value) => value.trim() !== "",
          "Enter a non-negative vehicle price.",
        ),
      rentalDeposit: optionalNonnegative("Rental deposit"),
      mileageAllowance: optionalNonnegative("Mileage allowance"),
      currencyCode: z
        .string()
        .regex(/^[A-Za-z]{3}$/, "Enter a three-letter currency."),
      expiresAt: optionalIsoDate("Listing expiry"),
    })
    .superRefine((form, ctx) => {
      if (
        form.expiresAt &&
        validDate(form.expiresAt) &&
        publishing &&
        new Date(`${form.expiresAt}T23:59:59.999Z`).getTime() <= now.getTime()
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["expiresAt"],
          message: "Listing expiry must be in the future before publishing.",
        });
      }
    });
}

const audienceSchema = z
  .object({
    visibilityScope: z.string(),
    communityId: z.string(),
    selectedCommunityIds: z.array(z.string()),
  })
  .superRefine((form, ctx) => {
    if (form.visibilityScope === "COMMUNITY" && !form.communityId) {
      ctx.addIssue({
        code: "custom",
        path: ["communityId"],
        message: "Select an active community for this vehicle.",
      });
    }
    if (
      form.visibilityScope === "SELECTED_COMMUNITIES" &&
      form.selectedCommunityIds.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["selectedCommunityIds"],
        message: "Select at least one community for this vehicle.",
      });
    }
  });

const CONTACT_CHANNEL_FIELDS: Record<
  string,
  "contactPhone" | "contactWhatsapp" | "contactEmail"
> = {
  PHONE: "contactPhone",
  WHATSAPP: "contactWhatsapp",
  EMAIL: "contactEmail",
};

const CONTACT_CHANNEL_MESSAGES: Record<string, string> = {
  PHONE: "Phone is preferred but no phone number was provided.",
  WHATSAPP: "WhatsApp is preferred but no WhatsApp number was provided.",
  EMAIL: "Email is preferred but no email address was provided.",
};

const contactSchema = z
  .object({
    contactPhone: z.string(),
    contactWhatsapp: z.string(),
    contactEmail: z.string(),
    contactPreferredMethod: z.string(),
  })
  .superRefine((form, ctx) => {
    const hasChannel = Boolean(
      form.contactPhone.trim() ||
        form.contactWhatsapp.trim() ||
        form.contactEmail.trim(),
    );
    const preferredField = CONTACT_CHANNEL_FIELDS[form.contactPreferredMethod];
    if (!hasChannel) {
      if (preferredField) {
        ctx.addIssue({
          code: "custom",
          path: [preferredField],
          message:
            "Add the matching contact channel or choose in-app messaging.",
        });
      }
      return;
    }
    if (
      form.contactEmail.trim() &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contactEmail.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["contactEmail"],
        message: "Enter a valid contact email address.",
      });
    }
    if (preferredField && !String(form[preferredField]).trim()) {
      ctx.addIssue({
        code: "custom",
        path: [preferredField],
        message: CONTACT_CHANNEL_MESSAGES[form.contactPreferredMethod],
      });
    }
  });

function locationMediaSchema(publishing: boolean) {
  return z
    .object({
      city: z.string(),
      region: z.string(),
      formattedAddress: z.string(),
      discoveryLatitude: z.number().nullable(),
      discoveryLongitude: z.number().nullable(),
      media: z.array(z.unknown()),
    })
    .superRefine((form, ctx) => {
      const hasLocation = Boolean(
        form.city.trim() ||
          form.region.trim() ||
          form.formattedAddress.trim(),
      );
      if (publishing && !hasLocation) {
        ctx.addIssue({
          code: "custom",
          path: ["city"],
          message: "Enter a public city, region, or general area.",
        });
      }
      if (
        !hasLocation &&
        (form.discoveryLatitude !== null || form.discoveryLongitude !== null)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["formattedAddress"],
          message:
            "Enter a public general area before adding an approximate discovery point.",
        });
      }
      if (
        (form.discoveryLatitude === null) !==
        (form.discoveryLongitude === null)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["discoveryLatitude"],
          message: "The approximate discovery point is incomplete.",
        });
      }
      if (form.media.length > 5) {
        ctx.addIssue({
          code: "custom",
          path: ["media"],
          message: "Attach no more than five vehicle images.",
        });
      }
    });
}

const PRICED_CORE_FIELDS = [
  "pricePeriod",
  "rentalDeposit",
  "mileageAllowance",
  "rentalConditions",
];

/** Attribute and required-core-field checks — these depend on the loaded category, not static schema. */
function categoryErrors(
  form: VehicleFormState,
  category: VehicleCategory | undefined,
  scope: "specs" | "pricing" | "all",
): VehicleFieldErrors {
  const errors: VehicleFieldErrors = {};
  for (const required of category?.requiredCoreFields ?? []) {
    const key = CORE_STATE_KEYS[required];
    if (!key) continue;
    const priced = PRICED_CORE_FIELDS.includes(required);
    if (
      (scope === "specs" && priced) ||
      (scope === "pricing" && !priced)
    ) {
      continue;
    }
    if (!String(form[key] ?? "").trim()) {
      errors[key] ??= `Complete the required ${required} field.`;
    }
  }
  if (scope === "pricing") return errors;
  for (const [key, policy] of Object.entries(category?.attributes ?? {})) {
    const error = validateAttribute(
      key,
      form.additionalAttributes[key],
      policy,
    );
    if (error) errors[`attribute:${key}`] ??= error;
  }
  for (const key of Object.keys(form.additionalAttributes)) {
    if (
      category &&
      !category.attributes[key] &&
      form.additionalAttributes[key].trim()
    ) {
      errors[`attribute:${key}`] ??=
        `${key} is not approved for this vehicle category.`;
    }
  }
  return errors;
}

function schemaErrors(
  schema: z.ZodType,
  value: unknown,
): VehicleFieldErrors {
  const errors: VehicleFieldErrors = {};
  const result = schema.safeParse(value);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "form");
      errors[key] ??= issue.message;
    }
  }
  return errors;
}

function firstError(errors: VehicleFieldErrors): string | null {
  return Object.values(errors)[0] ?? null;
}

/** Field-keyed validation for one wizard step — the submit path still checks every step. */
export function vehicleStepErrors(
  form: VehicleFormState,
  step: number,
  publishing = true,
  now = new Date(),
  category?: VehicleCategory,
): VehicleFieldErrors {
  if (step === 0) return schemaErrors(basicsSchema, form);
  if (step === 1) {
    return {
      ...schemaErrors(specificationSchema, form),
      ...categoryErrors(form, category, "specs"),
    };
  }
  if (step === 2) {
    return {
      ...schemaErrors(pricingSchema(publishing, now), form),
      ...categoryErrors(form, category, "pricing"),
    };
  }
  if (step === 3) {
    return {
      ...schemaErrors(audienceSchema, form),
      ...schemaErrors(contactSchema, form),
    };
  }
  if (step === 4) return schemaErrors(locationMediaSchema(publishing), form);
  return {};
}

/** Validates only the current wizard step; submission still runs the complete validator. */
export function validateVehicleStep(
  form: VehicleFormState,
  step: number,
  publishing = true,
  now = new Date(),
  category?: VehicleCategory,
): string | null {
  return firstError(vehicleStepErrors(form, step, publishing, now, category));
}

export function validateVehicleForm(
  form: VehicleFormState,
  publishing = true,
  now = new Date(),
  category?: VehicleCategory,
): string | null {
  return (
    firstError(schemaErrors(basicsSchema, form)) ??
    firstError(schemaErrors(audienceSchema, form)) ??
    firstError(schemaErrors(specificationSchema, form)) ??
    firstError(schemaErrors(pricingSchema(publishing, now), form)) ??
    firstError(schemaErrors(locationMediaSchema(publishing), form)) ??
    firstError(schemaErrors(contactSchema, form)) ??
    firstError(categoryErrors(form, category, "all"))
  );
}

function validateAttribute(
  key: string,
  raw: string | undefined,
  policy: VehicleAttributePolicy,
): string | null {
  if (policy.required && !raw?.trim())
    return `Complete the required ${key} attribute.`;
  if (!raw?.trim()) return null;
  const type = policy.type || "STRING";
  if (["NUMBER", "INTEGER"].includes(type)) {
    const value = Number(raw);
    if (
      !Number.isFinite(value) ||
      (type === "INTEGER" && !Number.isInteger(value))
    ) {
      return `${key} must be a valid ${type === "INTEGER" ? "integer" : "number"}.`;
    }
    if (
      (policy.minimum !== null && value < policy.minimum) ||
      (policy.maximum !== null && value > policy.maximum)
    ) {
      return `${key} is outside its permitted range.`;
    }
  }
  if (type === "BOOLEAN" && !["true", "false"].includes(raw))
    return `${key} must be true or false.`;
  if (policy.options.length && !policy.options.includes(raw))
    return `${key} has an invalid option.`;
  return null;
}

function typedAttributes(
  form: VehicleFormState,
  category?: VehicleCategory,
): Record<string, VehicleAttributeValue> {
  return Object.fromEntries(
    Object.entries(form.additionalAttributes)
      .filter(
        ([key, value]) =>
          value.trim() && (!category || category.attributes[key]),
      )
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
  const hasLocation = Boolean(
    form.city.trim() || form.region.trim() || form.formattedAddress.trim(),
  );
  const request: VehicleRequest = {
    ...(editing
      ? {}
      : { businessAccountId: form.businessAccountId ?? undefined }),
    businessListingId: form.businessAccountId
      ? (form.businessListingId ?? undefined)
      : undefined,
    visibilityScope: form.visibilityScope,
    communityId:
      form.visibilityScope === "COMMUNITY" ? form.communityId : undefined,
    selectedCommunityIds:
      form.visibilityScope === "SELECTED_COMMUNITIES"
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
    rentalDeposit:
      form.listingPurpose === "RENT" ? number(form.rentalDeposit) : undefined,
    mileageAllowance:
      form.listingPurpose === "RENT"
        ? number(form.mileageAllowance)
        : undefined,
    rentalConditions:
      form.listingPurpose === "RENT"
        ? optional(form.rentalConditions)
        : undefined,
    location: hasLocation
      ? {
          city: optional(form.city),
          region: optional(form.region),
          formattedAddress: optional(form.formattedAddress),
          ...(form.discoveryLatitude !== null &&
          form.discoveryLongitude !== null
            ? {
                discoveryLatitude: form.discoveryLatitude,
                discoveryLongitude: form.discoveryLongitude,
              }
            : {}),
        }
      : undefined,
    featureIds: form.featureIds,
    expiresAt: expiry(form.expiresAt),
    clearLocation: editing && !hasLocation,
    clearExpiry: editing && !form.expiresAt,
    clearFields: editing
      ? [
          ...Object.entries(CORE_STATE_KEYS)
            .filter(([, key]) => !String(form[key] ?? "").trim())
            .map(([field]) => field),
          ...(form.listingPurpose === "SALE"
            ? ["rentalDeposit", "mileageAllowance", "rentalConditions"]
            : []),
        ]
      : [],
  };
  const hasChannel = Boolean(
    form.contactPhone.trim() ||
    form.contactWhatsapp.trim() ||
    form.contactEmail.trim(),
  );
  if (hasChannel) {
    request.contact = {
      phone: optional(form.contactPhone),
      whatsapp: optional(form.contactWhatsapp),
      email: optional(form.contactEmail),
      preferredMethod: form.contactPreferredMethod,
      showPhone: form.contactShowPhone && Boolean(form.contactPhone.trim()),
      showWhatsapp:
        form.contactShowWhatsapp && Boolean(form.contactWhatsapp.trim()),
      showEmail: form.contactShowEmail && Boolean(form.contactEmail.trim()),
    };
  } else if (editing) {
    request.clearContact = true;
  }
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

export function setVehicleCover(
  media: VehicleMediaItem[],
  id: string,
): VehicleMediaItem[] {
  return media.map((item) => ({ ...item, cover: item.id === id }));
}
