/**
 * Session provider — loads and holds the authenticated user's full session state
 * (profile, memberships, active community) after Phase 1 authentication succeeds.
 *
 * Responsibilities:
 *  - Fetch me + profile + memberships + active community in parallel on mount
 *  - Expose refresh() to re-resolve after any onboarding step completes
 *  - Expose updateProfile() to PATCH profile and refresh state atomically
 *  - Expose joinCommunity() / setActiveCommunity() with state refresh
 *  - Derive the current OnboardingStep from backend state
 *
 * Only mounted when authState.status === 'authenticated'.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@/core/auth/auth-provider';
import { createApiClient } from '@/core/api/api-client';
import { createProfileApi } from '@/features/profile/services/profile-api';
import { createCommunityApi } from '@/features/communities/services/community-api';
import { createAuthApi } from '@/features/authentication/services/auth-api';
import type { SessionState, OnboardingStep } from './session-types';
import { resolveOnboardingStep } from './session-types';
import type { UpdateProfileRequest } from '@/features/profile/types/profile-types';
import { ApiError } from '@/core/api/api-error';

export interface SessionContextValue {
  /** null while loading or when not authenticated */
  readonly session: SessionState | null;
  /** Shared API client — stable per access token; use for all feature service calls. */
  readonly apiClient: ReturnType<typeof createApiClient>;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Resolved onboarding step — 'main-app' when fully onboarded. */
  readonly onboardingStep: OnboardingStep;
  /** Re-fetch all session data from the backend. */
  refresh(): Promise<void>;
  /** PATCH profile fields and update session state atomically. */
  updateProfile(fields: UpdateProfileRequest): Promise<void>;
  /** Join a community and refresh membership state. */
  joinCommunity(communityId: string): Promise<void>;
  /** Set active community and refresh state. */
  setActiveCommunity(communityId: string): Promise<void>;
  /** Update preferredLanguageCode in user settings. */
  updatePreferredLanguage(code: string): Promise<void>;
  /** Complete onboarding: auto-join community + set defaults. Idempotent. */
  completeOnboarding(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { authState } = auth;
  const [session, setSession] = useState<SessionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  // Recreate the API client whenever the access token changes.
  // authContext is captured at creation time; getCurrentTokens() always reads
  // the live ref so token freshness is guaranteed regardless of authState age.
  const apiClient = React.useMemo(
    () => createApiClient({ authContext: auth }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authState.status === 'authenticated' ? authState.tokens.accessToken : null]
  );
  const profileApi = React.useMemo(() => createProfileApi(apiClient), [apiClient]);
  const communityApi = React.useMemo(() => createCommunityApi(apiClient), [apiClient]);
  const authApi = React.useMemo(() => createAuthApi(apiClient), [apiClient]);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      // First await — all setState calls below run in async callbacks,
      // not synchronously inside the useEffect that invokes load().
      // Account identity comes from /api/v1/auth/me — it exists for every
      // authenticated user. /api/v1/me/profile 404s when the account has no
      // profile yet: that is NOT an auth failure, it routes to onboarding.
      const [meRes, profileRes, membershipsRes, activeRes] = await Promise.all([
        authApi.me(),
        profileApi.profile().catch((e: unknown) => {
          if (ApiError.isApiError(e) && e.httpStatus === 404) return null;
          throw e;
        }),
        communityApi.myCommunities().catch(() => ({ items: [] as never[] })),
        communityApi.activeCommunity().catch(() => ({ communityId: null })),
      ]);
      setSession({
        me: meRes,
        profile: profileRes,
        memberships: membershipsRes.items,
        activeCommunityId: activeRes.communityId,
      });
      setError(null);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.userMessage ?? 'Failed to load session. Please try again.');
      setSession(null);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState.status === 'authenticated' ? authState.tokens.accessToken : null]);

  // Load session whenever the access token changes (new login or refresh).
  // Guard: skip when unauthenticated — prevents unnecessary API calls that
  // would fire without a bearer token and 401.
  useEffect(() => {
    if (authState.status === 'authenticated') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    }
  }, [load, authState.status]);

  // Reset session when the user becomes unauthenticated.
  useEffect(() => {
    if (authState.status === 'unauthenticated') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession(null);
      setIsLoading(false);
      setError(null);
    }
  }, [authState.status]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    await load(); // load() internally guards concurrent calls via loadingRef
  }, [load]);

  const updateProfile = useCallback(
    async (fields: UpdateProfileRequest) => {
      if (!session) return;
      const updated = await profileApi.updateProfile(fields);
      setSession((prev) => prev && { ...prev, profile: updated });
    },
    [session, profileApi]
  );

  const joinCommunity = useCallback(
    async (communityId: string) => {
      await communityApi.join(communityId);
      await refresh();
    },
    [communityApi, refresh]
  );

  const setActiveCommunity = useCallback(
    async (communityId: string) => {
      await communityApi.setActiveCommunity(communityId);
      await refresh();
    },
    [communityApi, refresh]
  );

  const updatePreferredLanguage = useCallback(
    async (code: string) => {
      await profileApi.updateSettings({ preferredLanguageCode: code });
      // Settings update doesn't change profile fields that affect onboarding step
    },
    [profileApi]
  );

  const completeOnboarding = useCallback(async () => {
    await communityApi.completeOnboarding();
    await refresh();
  }, [communityApi, refresh]);

  const onboardingStep = session
    ? resolveOnboardingStep(session)
    : 'country-origin';

  const value: SessionContextValue = {
    session,
    apiClient,
    isLoading,
    error,
    onboardingStep,
    refresh,
    updateProfile,
    joinCommunity,
    setActiveCommunity,
    updatePreferredLanguage,
    completeOnboarding,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
