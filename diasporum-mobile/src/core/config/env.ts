/**
 * Centralized environment configuration module.
 *
 * All EXPO_PUBLIC_* variables are inlined at build time by Metro bundler.
 * Access them only as direct property lookups (no dynamic key access).
 * Client-safe values only — never secrets.
 */

export type AppEnv = 'development' | 'staging' | 'production';

export interface AppConfig {
  readonly appEnv: AppEnv;
  readonly apiBaseUrl: string;
  /** Google OAuth 2.0 client IDs (Android/iOS native + web client used for
   * server-side verification). At least the web client id is required for
   * native Google sign-in to return a backend-verifiable idToken. */
  readonly googleAndroidClientId: string;
  readonly googleIosClientId: string;
  readonly googleWebClientId: string;
  /** Apple Services ID / bundle identifier used as the token audience. */
  readonly appleClientId: string;
  /** URL scheme prefix for auth deep links (verify-email, reset-password). */
  readonly authRedirectUri: string;
}

class ConfigValidationError extends Error {
  constructor(message: string) {
    super(`[Config] ${message}`);
    this.name = 'ConfigValidationError';
  }
}

function requireEnv(key: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new ConfigValidationError(
      `Required environment variable ${key} is missing or empty. ` +
        'Check your .env file and ensure all required EXPO_PUBLIC_* variables are set.'
    );
  }
  return value.trim();
}

function requireUrl(key: string, value: string | undefined): string {
  const raw = requireEnv(key, value);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      if (!raw.includes('://')) {
        throw new ConfigValidationError(`${key} must be a valid URL, got: ${raw}`);
      }
    }
  } catch (e) {
    if (e instanceof ConfigValidationError) throw e;
    throw new ConfigValidationError(`${key} is not a valid URL: ${raw}`);
  }
  return raw;
}

function requireAppEnv(key: string, value: string | undefined): AppEnv {
  const raw = requireEnv(key, value);
  const valid: AppEnv[] = ['development', 'staging', 'production'];
  if (!valid.includes(raw as AppEnv)) {
    throw new ConfigValidationError(
      `${key} must be one of: ${valid.join(', ')}. Got: ${raw}`
    );
  }
  return raw as AppEnv;
}

function optionalEnv(value: string | undefined): string {
  return (value ?? '').trim();
}

function buildConfig(): AppConfig {
  return {
    appEnv: requireAppEnv('EXPO_PUBLIC_APP_ENV', process.env.EXPO_PUBLIC_APP_ENV),
    apiBaseUrl: requireUrl('EXPO_PUBLIC_API_BASE_URL', process.env.EXPO_PUBLIC_API_BASE_URL),
    googleAndroidClientId: optionalEnv(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID),
    googleIosClientId: optionalEnv(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
    googleWebClientId: optionalEnv(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
    appleClientId: optionalEnv(process.env.EXPO_PUBLIC_APPLE_CLIENT_ID),
    authRedirectUri: optionalEnv(process.env.EXPO_PUBLIC_AUTH_REDIRECT_URI)
      || 'diasporummobile://',
  };
}

export const appConfig: AppConfig = buildConfig();
