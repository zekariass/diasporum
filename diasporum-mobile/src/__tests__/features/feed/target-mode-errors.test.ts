/**
 * friendlyTargetModeMessage — maps FeedService's target_mode/CTA/entitlement
 * error codes to friendly copy for the composer and edit screens.
 */

import { ApiError } from "@/core/api/api-error";
import { friendlyTargetModeMessage } from "@/features/feed/utils/target-mode-errors";

function errorWithCode(code: string): ApiError {
  return new ApiError({
    code: "VALIDATION_ERROR",
    httpStatus: 400,
    message: code,
    backendCode: code,
  });
}

describe("friendlyTargetModeMessage", () => {
  const mappedCodes = [
    "INVALID_TARGET_MODE",
    "SELECTED_COMMUNITIES_REQUIRES_TARGETS",
    "TARGET_COMMUNITIES_NOT_ALLOWED_FOR_MODE",
    "CTA_LABEL_AND_URL_REQUIRED_TOGETHER",
    "CTA_LABEL_TOO_LONG",
    "INVALID_CTA_URL",
    "NOT_A_MEMBER",
    "COMMUNITY_NOT_FOUND",
    "ENTITLEMENT_NOT_CONFIGURED",
    "ENTITLEMENT_QUOTA_EXCEEDED",
    "BILLING_TARGET_REQUIRED",
  ];

  it.each(mappedCodes)("maps %s to a non-empty friendly message", (code) => {
    const message = friendlyTargetModeMessage(errorWithCode(code));
    expect(typeof message).toBe("string");
    expect(message!.length).toBeGreaterThan(0);
    expect(message).not.toBe(code);
  });

  it("falls back to the Error.message key when backendCode is absent", () => {
    const err = new ApiError({
      code: "FORBIDDEN",
      httpStatus: 403,
      message: "ENTITLEMENT_NOT_CONFIGURED",
    });
    expect(friendlyTargetModeMessage(err)).toBe(
      "This posting option isn't available on your current plan yet.",
    );
  });

  it("returns null for an unmapped code", () => {
    expect(friendlyTargetModeMessage(errorWithCode("SOME_OTHER_CODE"))).toBeNull();
  });

  it("returns null for a non-ApiError value", () => {
    expect(friendlyTargetModeMessage(new Error("boom"))).toBeNull();
    expect(friendlyTargetModeMessage("ENTITLEMENT_NOT_CONFIGURED")).toBeNull();
    expect(friendlyTargetModeMessage(null)).toBeNull();
  });
});
