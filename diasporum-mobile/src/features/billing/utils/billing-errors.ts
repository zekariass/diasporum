/**
 * Friendly copy for billing error codes. The backend sets `code === message`
 * (ResponseStatusException reason); we key off `ApiError.backendCode` and never
 * surface the raw code.
 */

import { ApiError } from "@/core/api/api-error";

const BILLING_ERROR_MESSAGES: Record<string, string> = {
  ACTIVE_PROFILE_REQUIRED:
    "Your account needs an active profile before you can manage a subscription.",
  BILLING_COUNTRY_REQUIRED:
    "Set your current country in your profile to see subscription options.",
  BILLING_COUNTRY_INACTIVE:
    "Subscriptions aren't available in your country right now.",
  COUNTRY_NOT_FOUND: "We couldn't find your billing country.",
  BILLING_COUNTRY_NOT_CONFIGURED:
    "Subscriptions aren't set up for your country yet.",
  BILLING_NOT_ENABLED_IN_COUNTRY: "Billing isn't available in your country yet.",
  SUBSCRIPTIONS_NOT_ENABLED_IN_COUNTRY:
    "Subscriptions aren't available in your country yet.",
  PAYMENT_PROVIDER_NOT_CONFIGURED:
    "This payment method isn't fully set up yet. Please choose another or try later.",
  IDEMPOTENCY_KEY_REQUIRED:
    "Something went wrong preparing your order. Please try again.",
  BILLING_PRICE_NOT_AVAILABLE:
    "That price is no longer available. Please go back and pick a plan again.",
  BILLING_PLAN_NOT_FOUND: "That plan is no longer available.",
  BILLING_CURRENCY_NOT_SUPPORTED:
    "That currency isn't supported for this payment method.",
  BILLING_ARRANGEMENT_NOT_AVAILABLE:
    "That billing option isn't available in your country.",
  BILLING_TERM_NOT_MEASURABLE: "That billing term isn't supported.",
  PAYMENT_PROVIDER_REQUIRED: "Choose a payment method to continue.",
  PAYMENT_PROVIDER_NOT_AVAILABLE:
    "That payment method isn't available in your country right now.",
  PAYMENT_PROVIDER_ARRANGEMENT_UNSUPPORTED:
    "That payment method doesn't support this kind of plan.",
  PAYMENT_METHOD_NOT_SUPPORTED:
    "That payment method isn't supported for this plan.",
  ALREADY_SUBSCRIBED: "You already have an active subscription on this plan.",
  BILLING_ORDER_NOT_FOUND: "We couldn't find that order. Please start again.",
  BILLING_PAYMENT_NOT_FOUND: "We couldn't find that payment.",
  NO_PREPAID_SUBSCRIPTION:
    "You don't have a prepaid subscription to renew. Choose a plan instead.",
  BILLING_RENEWAL_TERM_REQUIRED:
    "We couldn't work out your previous term. Please choose a plan to renew.",
  BILLING_RENEWAL_MUST_BE_PREPAID:
    "Only prepaid subscriptions can be renewed this way.",
  NOT_PAYMENT_OWNER: "This payment belongs to a different account.",
  BILLING_PAYMENT_NOT_PENDING: "This payment is no longer waiting for payment.",
  PAYMENT_NOT_MANUALLY_VERIFIED:
    "This payment doesn't need a transfer reference.",
  BILLING_PROOF_EVIDENCE_REQUIRED:
    "Add a transfer reference or a receipt photo.",
  BILLING_PROOF_ALREADY_SUBMITTED:
    "You've already submitted proof for this payment. We're verifying it.",
  MEDIA_NOT_FOUND:
    "We couldn't find the receipt you uploaded. Please try again.",
  MEDIA_NOT_USABLE_AS_RECEIPT: "That file can't be used as a receipt.",
  MEDIA_NOT_READY:
    "Your receipt is still uploading. Please try again in a moment.",
  VALIDATION_FAILED: "Some details look wrong. Please check and try again.",
  MALFORMED_REQUEST:
    "Something went wrong sending your request. Please try again.",
};

export const PROOF_ALREADY_SUBMITTED_CODE = "BILLING_PROOF_ALREADY_SUBMITTED";

export function billingErrorCode(err: unknown): string | null {
  if (!ApiError.isApiError(err)) return null;
  return err.backendCode ?? null;
}

/** Always returns user-safe copy; never the raw backend code. */
export function friendlyBillingMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (!ApiError.isApiError(err)) return fallback;
  if (err.isNetworkError) {
    return "Can't reach the server. Check your connection and try again.";
  }
  const code = err.backendCode ?? err.message;
  if (code && BILLING_ERROR_MESSAGES[code]) return BILLING_ERROR_MESSAGES[code];
  return fallback;
}
