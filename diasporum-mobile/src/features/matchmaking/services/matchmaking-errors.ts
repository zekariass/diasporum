import { ApiError } from '@/core/api/api-error';

export function isMissingResource(error: unknown): boolean {
  return ApiError.isApiError(error) && error.isNotFound;
}

export function matchmakingError(error: unknown, fallback: string): string {
  if (!ApiError.isApiError(error)) return fallback;
  const reason = error.message ?? '';
  if (/ENTITLEMENT|QUOTA|MATCHMAKING_INTERACT|FEATURE_DISABLED/i.test(reason)) {
    return 'Your current plan does not allow more Matchmaking interactions. Review your subscription or try again after your allowance resets.';
  }
  if (/NOT_ELIGIBLE|ADULT|AGE_ELIGIBILITY/i.test(reason)) {
    return 'Matchmaking requires a confirmed adult profile and discovery opt-in.';
  }
  if (/PREFERENCES_REQUIRED/i.test(reason)) {
    return 'Save your discovery preferences before activating Matchmaking.';
  }
  if (/DISCOVERY_LOCATION/i.test(reason)) {
    return 'A distance limit needs your approximate location. Allow it here or clear the distance field.';
  }
  if (/PHOTO_NOT_READY/i.test(reason)) {
    return 'Your selected photo is still processing. Wait for it to be ready, then try again.';
  }
  if (error.isUnauthenticated) return 'Sign in again to continue.';
  if (error.isNetworkError) return 'You appear to be offline. Reconnect and try again.';
  return error.userMessage || fallback;
}
