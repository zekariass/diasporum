import type { AccountMe } from '@/core/auth/auth-types';
/**
 * Tests for the onboarding step resolver — the single source of truth
 * for post-authentication routing decisions.
 *
 * Flow: country-origin → country-current → community-preview → profile
 * → complete (join happens there) → main-app.
 */

import { resolveOnboardingStep } from '@/core/session/session-types';
import type { SessionState } from '@/core/session/session-types';
import type { ProfileResponse } from '@/features/profile/types/profile-types';
import type { MembershipView } from '@/features/communities/types/community-types';

function makeProfile(overrides: Partial<ProfileResponse> = {}): ProfileResponse {
  return {
    id: 'u1',
    username: 'alice',
    displayName: 'Alice',
    bio: null,
    city: null,
    dateOfBirth: null,
    originCountryId: 'c1',
    currentCountryId: 'c2',
    accountStatus: 'ACTIVE',
    profileCompleted: true,
    avatarMediaId: null,
    ...overrides,
  };
}

function makeMe(overrides: Partial<AccountMe> = {}): AccountMe {
  return {
    id: 'u1',
    email: 'a@b.c',
    accountStatus: 'ACTIVE',
    emailVerifiedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMembership(communityId = 'com1'): MembershipView {
  return {
    communityId,
    userId: 'u1',
    role: 'MEMBER',
    status: 'ACTIVE',
    joinedAt: new Date().toISOString(),
  };
}

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    me: makeMe(),
    profile: makeProfile(),
    memberships: [makeMembership()],
    activeCommunityId: 'com1',
    ...overrides,
  };
}

describe('resolveOnboardingStep', () => {
  it('returns country-origin when there is no profile', () => {
    const s = makeSession({ profile: null });
    expect(resolveOnboardingStep(s)).toBe('country-origin');
  });

  it('returns country-origin when originCountryId is null', () => {
    const s = makeSession({ profile: makeProfile({ originCountryId: null, profileCompleted: false }) });
    expect(resolveOnboardingStep(s)).toBe('country-origin');
  });

  it('returns country-current when currentCountryId is null', () => {
    const s = makeSession({ profile: makeProfile({ currentCountryId: null, profileCompleted: false }) });
    expect(resolveOnboardingStep(s)).toBe('country-current');
  });

  it('returns community-preview when displayName is missing', () => {
    const s = makeSession({ profile: makeProfile({ displayName: null, profileCompleted: false }) });
    expect(resolveOnboardingStep(s)).toBe('community-preview');
  });

  it('returns community-preview when username is missing', () => {
    const s = makeSession({ profile: makeProfile({ username: null, profileCompleted: false }) });
    expect(resolveOnboardingStep(s)).toBe('community-preview');
  });

  it('returns community-preview when profileCompleted flag is false', () => {
    const s = makeSession({ profile: makeProfile({ profileCompleted: false }) });
    expect(resolveOnboardingStep(s)).toBe('community-preview');
  });

  it('returns complete when profile is done but no memberships', () => {
    const s = makeSession({ memberships: [], activeCommunityId: null });
    expect(resolveOnboardingStep(s)).toBe('complete');
  });

  it('returns complete when memberships exist but no active community set', () => {
    const s = makeSession({ activeCommunityId: null });
    expect(resolveOnboardingStep(s)).toBe('complete');
  });

  it('returns community-preview when profile incomplete even if membership exists', () => {
    const s = makeSession({ profile: makeProfile({ profileCompleted: false }) });
    expect(resolveOnboardingStep(s)).toBe('community-preview');
  });

  it('returns main-app when fully onboarded', () => {
    expect(resolveOnboardingStep(makeSession())).toBe('main-app');
  });
});
