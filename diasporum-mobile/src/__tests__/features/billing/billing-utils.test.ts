import { ApiError } from "@/core/api/api-error";
import { friendlyBillingMessage } from "@/features/billing/utils/billing-errors";
import {
  canRenew,
  formatInterval,
  humanizeKey,
  isNearExpiry,
} from "@/features/billing/utils/billing-format";
import {
  hasProofErrors,
  validateProof,
} from "@/features/billing/utils/proof-validation";
import type { SubscriptionView } from "@/features/billing/types/billing-types";

describe("validateProof", () => {
  it("requires a reference or a receipt", () => {
    const e = validateProof({ proofReference: "  ", notes: "" });
    expect(hasProofErrors(e)).toBe(true);
    expect(e.form).toBeDefined();
  });
  it("accepts a receipt alone or a reference alone", () => {
    expect(hasProofErrors(validateProof({ proofReference: "", mediaObjectId: "m", notes: "" }))).toBe(false);
    expect(hasProofErrors(validateProof({ proofReference: "R1", notes: "" }))).toBe(false);
  });
  it("rejects overlong values", () => {
    expect(validateProof({ proofReference: "x".repeat(201), notes: "" }).proofReference).toBeDefined();
    expect(validateProof({ proofReference: "R", notes: "x".repeat(1001) }).notes).toBeDefined();
  });
});

describe("billing format", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const sub = (over: Partial<SubscriptionView>): SubscriptionView =>
    ({
      status: "ACTIVE",
      billingArrangement: "PREPAID",
      currentPeriodEnd: "2026-01-10T00:00:00Z",
      ...over,
    }) as SubscriptionView;

  it("detects near expiry", () => {
    expect(isNearExpiry("2026-01-10T00:00:00Z", now)).toBe(true);
    expect(isNearExpiry("2026-03-01T00:00:00Z", now)).toBe(false);
    expect(isNearExpiry(null, now)).toBe(false);
  });
  it("offers renewal only for prepaid near expiry or expired", () => {
    expect(canRenew(sub({}), now)).toBe(true);
    expect(canRenew(sub({ currentPeriodEnd: "2026-06-01T00:00:00Z" }), now)).toBe(false);
    expect(canRenew(sub({ billingArrangement: "RECURRING" }), now)).toBe(false);
    expect(canRenew(sub({ status: "EXPIRED", currentPeriodEnd: "2025-12-01T00:00:00Z" }), now)).toBe(true);
    expect(canRenew(null, now)).toBe(false);
  });
  it("formats intervals and keys", () => {
    expect(formatInterval("MONTH", 1)).toBe("1 month");
    expect(formatInterval("YEAR", 2)).toBe("2 years");
    expect(humanizeKey("accountNumber")).toBe("Account number");
    expect(humanizeKey("bank_name")).toBe("Bank name");
  });
});

describe("friendlyBillingMessage", () => {
  const apiErr = (backendCode: string) =>
    ApiError.fromHttpResponse(409, { code: backendCode, message: backendCode });

  it("maps known codes without leaking the raw code", () => {
    const msg = friendlyBillingMessage(apiErr("PAYMENT_PROVIDER_NOT_AVAILABLE"));
    expect(msg).not.toContain("PAYMENT_PROVIDER_NOT_AVAILABLE");
    expect(msg.length).toBeGreaterThan(10);
  });
  it("falls back for unknown codes and non-API errors", () => {
    expect(friendlyBillingMessage(apiErr("SOMETHING_NEW"), "fallback")).toBe("fallback");
    expect(friendlyBillingMessage(new Error("x"), "fallback")).toBe("fallback");
  });
});
