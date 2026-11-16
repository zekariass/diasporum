/**
 * Friendly copy for the machine-readable error codes FeedService throws for
 * target_mode / CTA validation and entitlement checks. Backend sets
 * `code === message` for these (ResponseStatusException reason), so we key
 * off `ApiError.backendCode` and never show the raw code to the user.
 */

import { ApiError } from "@/core/api/api-error";

const TARGET_MODE_ERROR_MESSAGES: Record<string, string> = {
  INVALID_TARGET_MODE:
    "That targeting option isn't recognized. Please pick one from the list.",
  SELECTED_COMMUNITIES_REQUIRES_TARGETS:
    "Choose at least one community to post to.",
  TARGET_COMMUNITIES_NOT_ALLOWED_FOR_MODE:
    'Community selection only applies to "Selected communities" posts.',
  CTA_LABEL_AND_URL_REQUIRED_TOGETHER:
    "Add both a button label and a link, or leave both blank.",
  CTA_LABEL_TOO_LONG: "Button label must be 60 characters or fewer.",
  INVALID_CTA_URL: "Button link must start with http:// or https://.",
  NOT_A_MEMBER: "You can only post to communities you've joined.",
  COMMUNITY_NOT_FOUND: "One of the selected communities could not be found.",
  ENTITLEMENT_NOT_CONFIGURED:
    "This posting option isn't available on your current plan yet.",
  ENTITLEMENT_QUOTA_EXCEEDED:
    "You've used up your allowance for this posting option. Try again later or post to a single community.",
  BILLING_TARGET_REQUIRED:
    "Something went wrong preparing this post. Please try again.",
};

/** Returns a friendly message for a target_mode/CTA-related API error, or null if unmapped. */
export function friendlyTargetModeMessage(err: unknown): string | null {
  if (!ApiError.isApiError(err)) return null;
  const key = err.backendCode ?? err.message;
  if (!key) return null;
  return TARGET_MODE_ERROR_MESSAGES[key] ?? null;
}
