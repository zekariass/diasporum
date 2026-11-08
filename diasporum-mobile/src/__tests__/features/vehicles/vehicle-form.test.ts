import type {
  VehicleCategory,
  VehicleMediaItem,
} from "@/features/vehicles/types/vehicle-types";
import {
  initialVehicleFormState,
  moveVehicleMedia,
  setVehicleCover,
  toVehicleRequest,
  validateVehicleForm,
  validateVehicleStep,
  vehicleFieldVisible,
  type VehicleFormState,
} from "@/features/vehicles/utils/vehicle-form";

const NOW = new Date("2026-11-01T12:00:00Z");
const CATEGORY: VehicleCategory = {
  category: { id: "category-1", key: "CAR", displayName: "Cars", sortOrder: 1 },
  coreFields: [
    "title",
    "description",
    "modelYear",
    "priceAmount",
    "pricePeriod",
    "rentalDeposit",
  ],
  requiredCoreFields: ["modelYear"],
  allowedFeatures: ["ABS"],
  attributes: {
    batteryCapacity: {
      type: "NUMBER",
      required: true,
      minimum: 10,
      maximum: 200,
      options: [],
      filterable: true,
    },
    drivetrain: {
      type: "ENUM",
      required: false,
      minimum: null,
      maximum: null,
      options: ["FOUR_WD", "AWD"],
      filterable: true,
    },
  },
};

function validForm(
  overrides: Partial<VehicleFormState> = {},
): VehicleFormState {
  return {
    ...initialVehicleFormState("community-1"),
    categoryId: "category-1",
    title: "2022 Volvo XC60",
    description: "Well maintained family vehicle",
    modelYear: "2022",
    priceAmount: "27500",
    city: "Frankfurt",
    expiresAt: "2026-12-31",
    ...overrides,
  };
}

describe("vehicle form validation and mapping", () => {
  it("validates one wizard step without blocking on later steps", () => {
    const form = validForm({ priceAmount: "" });
    expect(validateVehicleStep(form, 0, true, NOW)).toBeNull();
    expect(validateVehicleStep(form, 1, true, NOW)).toBeNull();
    expect(validateVehicleStep(form, 2, true, NOW)).toMatch(/price/);
    expect(validateVehicleStep(form, 3, true, NOW)).toBeNull();
    expect(validateVehicleStep(form, 4, true, NOW)).toBeNull();
  });

  it("maps a SALE draft with ownership, audience, and FOUR_WD drive type", () => {
    const form = validForm({
      businessAccountId: "business-1",
      driveType: "FOUR_WD",
      currencyCode: "eur",
    });
    expect(validateVehicleForm(form, true, NOW)).toBeNull();
    expect(toVehicleRequest(form)).toEqual(
      expect.objectContaining({
        businessAccountId: "business-1",
        communityId: "community-1",
        selectedCommunityIds: [],
        listingPurpose: "SALE",
        driveType: "FOUR_WD",
        pricePeriod: "TOTAL",
        currencyCode: "EUR",
        clearLocation: false,
        clearExpiry: false,
      }),
    );
    expect(toVehicleRequest(form).rentalDeposit).toBeUndefined();
  });

  it("maps RENT-specific pricing, deposit, allowance, and conditions", () => {
    const request = toVehicleRequest(
      validForm({
        listingPurpose: "RENT",
        pricePeriod: "WEEK",
        priceAmount: "450",
        rentalDeposit: "800",
        mileageAllowance: "1200",
        rentalConditions: "Return clean",
      }),
    );
    expect(request).toEqual(
      expect.objectContaining({
        listingPurpose: "RENT",
        pricePeriod: "WEEK",
        rentalDeposit: 800,
        mileageAllowance: 1200,
        rentalConditions: "Return clean",
      }),
    );
  });

  it("validates year and non-negative numeric ranges", () => {
    expect(
      validateVehicleForm(validForm({ modelYear: "1885" }), true, NOW),
    ).toMatch(/Model year/);
    expect(
      validateVehicleForm(validForm({ registrationYear: "2201" }), true, NOW),
    ).toMatch(/Registration year/);
    expect(
      validateVehicleForm(validForm({ mileage: "-1" }), true, NOW),
    ).toMatch(/Mileage/);
    expect(validateVehicleForm(validForm({ doors: "0" }), true, NOW)).toMatch(
      /Doors/,
    );
    expect(
      validateVehicleForm(validForm({ priceAmount: "-10" }), true, NOW),
    ).toMatch(/Price/);
  });

  it("requires title, description, category, price, and valid currency", () => {
    expect(
      validateVehicleForm(validForm({ categoryId: "" }), true, NOW),
    ).toMatch(/category/);
    expect(validateVehicleForm(validForm({ title: "" }), true, NOW)).toMatch(
      /title/,
    );
    expect(
      validateVehicleForm(validForm({ description: "" }), true, NOW),
    ).toMatch(/description/);
    expect(
      validateVehicleForm(validForm({ priceAmount: "" }), true, NOW),
    ).toMatch(/price/);
    expect(
      validateVehicleForm(validForm({ currencyCode: "EU" }), true, NOW),
    ).toMatch(/three-letter/);
  });

  it("validates community and selected-community audiences", () => {
    expect(
      validateVehicleForm(validForm({ communityId: "" }), true, NOW),
    ).toMatch(/active community/);
    expect(
      validateVehicleForm(
        validForm({ visibilityScope: "COUNTRY", communityId: "" }),
        true,
        NOW,
      ),
    ).toBeNull();
    expect(
      validateVehicleForm(
        validForm({
          visibilityScope: "SELECTED_COMMUNITIES",
          selectedCommunityIds: [],
        }),
        true,
        NOW,
      ),
    ).toMatch(/at least one community/);
    const request = toVehicleRequest(
      validForm({
        visibilityScope: "SELECTED_COMMUNITIES",
        selectedCommunityIds: ["community-1", "community-2"],
      }),
    );
    expect(request.communityId).toBeUndefined();
    expect(request.selectedCommunityIds).toEqual([
      "community-1",
      "community-2",
    ]);
  });

  it("requires public location only for publishing and keeps coordinates paired", () => {
    expect(validateVehicleForm(validForm({ city: "" }), false, NOW)).toBeNull();
    expect(validateVehicleForm(validForm({ city: "" }), true, NOW)).toMatch(
      /public city/,
    );
    expect(
      validateVehicleForm(validForm({ discoveryLatitude: 9.01 }), false, NOW),
    ).toMatch(/incomplete/);
    expect(
      validateVehicleForm(
        validForm({ discoveryLatitude: 9.01, discoveryLongitude: 38.75 }),
        true,
        NOW,
      ),
    ).toBeNull();
  });

  it("validates expiry for publishing while allowing a historical draft expiry to be edited", () => {
    expect(
      validateVehicleForm(validForm({ expiresAt: "31/12/2026" }), false, NOW),
    ).toMatch(/YYYY-MM-DD/);
    expect(
      validateVehicleForm(validForm({ expiresAt: "2026-02-31" }), false, NOW),
    ).toMatch(/YYYY-MM-DD/);
    expect(
      validateVehicleForm(validForm({ expiresAt: "2026-10-31" }), true, NOW),
    ).toMatch(/future/);
    expect(
      validateVehicleForm(validForm({ expiresAt: "2026-10-31" }), false, NOW),
    ).toBeNull();
  });

  it("applies category field visibility, required fields, and typed attribute policies", () => {
    expect(vehicleFieldVisible(CATEGORY, "modelYear")).toBe(true);
    expect(vehicleFieldVisible(CATEGORY, "doors")).toBe(false);
    const withoutAttribute = validForm({ additionalAttributes: {} });
    expect(validateVehicleForm(withoutAttribute, true, NOW, CATEGORY)).toMatch(
      /batteryCapacity/,
    );
    expect(
      validateVehicleForm(validForm({ modelYear: "" }), true, NOW, CATEGORY),
    ).toMatch(/modelYear/);
    const complete = validForm({
      additionalAttributes: { batteryCapacity: "75.5", drivetrain: "FOUR_WD" },
    });
    expect(validateVehicleForm(complete, true, NOW, CATEGORY)).toBeNull();
    expect(
      toVehicleRequest(complete, false, CATEGORY).additionalAttributes,
    ).toEqual({
      batteryCapacity: 75.5,
      drivetrain: "FOUR_WD",
    });
    expect(
      validateVehicleForm(
        validForm({ additionalAttributes: { batteryCapacity: "500" } }),
        true,
        NOW,
        CATEGORY,
      ),
    ).toMatch(/range/);
  });

  it("maps seller contact channels with visibility flags and clears them on edit", () => {
    const form = validForm({
      contactPhone: "+49 170 123",
      contactWhatsapp: "",
      contactEmail: "seller@example.com",
      contactPreferredMethod: "PHONE",
      contactShowPhone: true,
      contactShowWhatsapp: true,
      contactShowEmail: false,
    });
    expect(validateVehicleForm(form, true, NOW)).toBeNull();
    expect(toVehicleRequest(form).contact).toEqual({
      phone: "+49 170 123",
      whatsapp: undefined,
      email: "seller@example.com",
      preferredMethod: "PHONE",
      showPhone: true,
      showWhatsapp: false,
      showEmail: false,
    });
    const cleared = toVehicleRequest(validForm(), true);
    expect(cleared.contact).toBeUndefined();
    expect(cleared.clearContact).toBe(true);
    const created = toVehicleRequest(validForm(), false);
    expect(created.contact).toBeUndefined();
    expect(created.clearContact).toBeUndefined();
  });

  it("validates contact email format and preferred-channel consistency", () => {
    expect(
      validateVehicleForm(
        validForm({ contactEmail: "not-an-email" }),
        true,
        NOW,
      ),
    ).toMatch(/email/);
    expect(
      validateVehicleForm(
        validForm({ contactPreferredMethod: "PHONE" }),
        true,
        NOW,
      ),
    ).toMatch(/matching contact channel/);
    expect(
      validateVehicleForm(
        validForm({
          contactEmail: "seller@example.com",
          contactPreferredMethod: "WHATSAPP",
        }),
        true,
        NOW,
      ),
    ).toMatch(/WhatsApp/);
    expect(
      validateVehicleForm(
        validForm({
          contactEmail: "seller@example.com",
          contactPreferredMethod: "EMAIL",
        }),
        true,
        NOW,
      ),
    ).toBeNull();
  });

  it("omits immutable ownership on edit and clears optional and location fields", () => {
    const request = toVehicleRequest(
      validForm({
        businessAccountId: "business-1",
        modelYear: "",
        colour: "",
        city: "",
        expiresAt: "",
      }),
      true,
    );
    expect(request).not.toHaveProperty("businessAccountId");
    expect(request.clearLocation).toBe(true);
    expect(request.clearExpiry).toBe(true);
    expect(request.clearFields).toEqual(
      expect.arrayContaining(["modelYear", "colour"]),
    );
  });
});

describe("vehicle media ordering", () => {
  const media: VehicleMediaItem[] = [
    { id: "one", uri: null, selection: null, cover: true },
    { id: "two", uri: null, selection: null, cover: false },
    { id: "three", uri: null, selection: null, cover: false },
  ];

  it("moves images without losing their order or identity", () => {
    expect(moveVehicleMedia(media, "two", -1).map((item) => item.id)).toEqual([
      "two",
      "one",
      "three",
    ]);
    expect(moveVehicleMedia(media, "one", -1)).toBe(media);
    expect(moveVehicleMedia(media, "three", 1)).toBe(media);
  });

  it("selects exactly one cover", () => {
    const updated = setVehicleCover(media, "three");
    expect(updated.filter((item) => item.cover).map((item) => item.id)).toEqual(
      ["three"],
    );
  });

  it("rejects more than five images", () => {
    const six = Array.from({ length: 6 }, (_, index) => ({
      id: String(index),
      uri: null,
      selection: null,
      cover: index === 0,
    }));
    expect(validateVehicleForm(validForm({ media: six }), false, NOW)).toMatch(
      /five/,
    );
  });
});
