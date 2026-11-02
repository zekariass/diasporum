import { ApiError } from "@/core/api/api-error";

const MESSAGES: Record<string, string> = {
  ENTITLEMENT_NOT_CONFIGURED: "Vehicle publishing is not enabled for this account yet. You can still save a draft.",
  ENTITLEMENT_EXHAUSTED: "Your vehicle publishing allowance has been used. You can still edit this draft.",
  VEHICLE_EXPIRY_MUST_BE_FUTURE: "Move the listing expiry into the future before publishing.",
  PUBLIC_LOCATION_REQUIRED: "Add a public city, region, or general area before publishing.",
  NOT_VEHICLE_MANAGER: "Your Business Account role or membership no longer allows this action.",
  VEHICLE_NOT_FOUND: "This vehicle is unavailable.",
};

export function vehicleErrorMessage(cause: unknown, fallback: string): string {
  if (!ApiError.isApiError(cause)) return fallback;
  return MESSAGES[cause.message] ?? cause.userMessage;
}
