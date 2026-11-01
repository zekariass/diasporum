/**
 * Authentication-specific error types.
 * Provides safe, user-facing messages without exposing tokens, codes or stack traces.
 */

export type AuthErrorCode =
  | 'AUTH_CANCELLED'
  | 'AUTH_INVALID_STATE'
  | 'AUTH_INVALID_REDIRECT'
  | 'AUTH_FAILED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_RESTRICTED'
  | 'PROVIDER_TOKEN_INVALID'
  | 'EMAIL_TAKEN'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'TOKEN_REFRESH_FAILED'
  | 'SESSION_EXPIRED'
  | 'STORAGE_ERROR'
  | 'NETWORK_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'LOGOUT_FAILED';

const USER_MESSAGES: Record<AuthErrorCode, string> = {
  AUTH_CANCELLED: 'Sign-in was cancelled.',
  AUTH_INVALID_STATE: 'The sign-in request could not be verified. Please try again.',
  AUTH_INVALID_REDIRECT: 'An unexpected error occurred during sign-in. Please try again.',
  AUTH_FAILED: 'Sign-in failed. Please try again.',
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  ACCOUNT_RESTRICTED: 'This account is restricted. Please contact support.',
  PROVIDER_TOKEN_INVALID: 'Provider sign-in could not be verified. Please try again.',
  EMAIL_TAKEN: 'An account with this email already exists.',
  TOKEN_EXCHANGE_FAILED: 'Could not complete sign-in. Please try again.',
  TOKEN_REFRESH_FAILED: 'Your session could not be renewed. Please sign in again.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  STORAGE_ERROR: 'A secure storage error occurred. Please try again.',
  NETWORK_ERROR: 'A network error occurred. Please check your connection.',
  CONFIGURATION_ERROR: 'Authentication is not correctly configured.',
  LOGOUT_FAILED: 'Sign-out could not be completed cleanly.',
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  /** Safe message suitable for display to the user (no tokens, codes or internals). */
  readonly userMessage: string;

  constructor(code: AuthErrorCode, detail?: string) {
    super(detail ?? USER_MESSAGES[code]);
    this.name = 'AuthError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
  }

  static isAuthError(err: unknown): err is AuthError {
    return err instanceof AuthError;
  }
}
