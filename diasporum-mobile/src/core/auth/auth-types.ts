/**
 * Authentication domain types — mirror the Diasporum backend auth DTOs
 * (AuthController). The backend is the authority; never trust decoded tokens.
 */

/** Stored Diasporum tokens. expiresAt is an absolute Unix timestamp in ms. */
export interface AuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly tokenType: string;
  readonly scope?: string;
}

/** POST /api/v1/auth/{login,google,apple,refresh} response. */
export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  userId: string;
  sessionId: string;
}

/** GET /api/v1/auth/me — account-level identity; works without a profile. */
export interface AccountMe {
  id: string;
  email: string;
  accountStatus:
    | 'PENDING_VERIFICATION'
    | 'ACTIVE'
    | 'SUSPENDED'
    | 'DELETION_PENDING'
    | 'DELETED';
  emailVerifiedAt: string | null;
}

/** GET /api/v1/auth/sessions item. */
export interface SessionView {
  id: string;
  clientType: 'WEB' | 'IOS' | 'ANDROID' | 'OTHER';
  authMethod: 'PASSWORD' | 'GOOGLE' | 'APPLE';
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string;
}

/** Identity exposed to the UI — account-level, not profile. */
export interface UserInfo {
  readonly userId: string;
  readonly sessionId: string;
  readonly email?: string;
}

/** Discriminated union representing every possible authentication state. */
export type AuthState =
  | { readonly status: 'loading' }
  | { readonly status: 'unauthenticated' }
  | {
      readonly status: 'authenticated';
      readonly tokens: AuthTokens;
      readonly user: UserInfo;
    };

/** Convert an AuthResponse to stored tokens. */
export function authResponseToTokens(r: AuthResponse): AuthTokens {
  return {
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    expiresAt: Date.now() + r.expiresIn * 1000,
    tokenType: r.tokenType,
  };
}
