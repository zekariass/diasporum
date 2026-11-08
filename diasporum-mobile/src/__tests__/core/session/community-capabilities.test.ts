import {
  activeCommunityContext,
  communityModuleForPath,
  enabledModuleSummary,
  isCommunityModuleEnabled,
  isExtendedCommunity,
} from "@/core/session/community-capabilities";
import type {
  CommunityAccessContext,
  MyCommunityAccess,
} from "@/features/communities/types/community-types";

function context(
  overrides: Partial<CommunityAccessContext> = {},
): CommunityAccessContext {
  return {
    communityId: "extended-1",
    communityName: "Origin in Destination",
    accessType: "ORIGIN_EXTENDED",
    originCountryId: "origin-1",
    destinationCountryId: "destination-1",
    modules: {
      FEED: true,
      REELS: true,
      MATCHMAKING: true,
      COMMUNITY_HELP: true,
      PROPERTY: false,
      EVENTS: false,
      VOICE_ROOMS: false,
    },
    ...overrides,
  };
}

function access(overrides: Partial<MyCommunityAccess> = {}): MyCommunityAccess {
  return {
    defaultCommunityId: "default-1",
    activeCommunityId: "extended-1",
    communities: [context()],
    ...overrides,
  };
}

describe("community capabilities", () => {
  it("uses only effective modules from the active Extended context", () => {
    const snapshot = access();
    expect(activeCommunityContext(snapshot)?.communityName).toBe(
      "Origin in Destination",
    );
    expect(isExtendedCommunity(snapshot)).toBe(true);
    expect(isCommunityModuleEnabled(snapshot, "FEED")).toBe(true);
    expect(isCommunityModuleEnabled(snapshot, "COMMUNITY_HELP")).toBe(true);
    expect(isCommunityModuleEnabled(snapshot, "PROPERTY")).toBe(false);
    expect(isCommunityModuleEnabled(snapshot, "EVENTS")).toBe(false);
    expect(isCommunityModuleEnabled(snapshot, "VOICE_ROOMS")).toBe(false);
    expect(enabledModuleSummary(context())).toBe(
      "Feed · Reels · Matchmaking · Community Help & Offers",
    );
  });

  it("fails closed for an invalid active context once a snapshot exists", () => {
    const snapshot = access({ activeCommunityId: "missing" });
    expect(isCommunityModuleEnabled(snapshot, "FEED")).toBe(false);
  });

  it("preserves legacy behavior only when no capability snapshot exists", () => {
    expect(isCommunityModuleEnabled(null, "PROPERTY")).toBe(true);
    expect(isCommunityModuleEnabled(undefined, "EVENTS")).toBe(true);
  });

  it("summarizes Default access without treating it as Extended", () => {
    const snapshot = access({
      activeCommunityId: "default-1",
      communities: [
        context({
          communityId: "default-1",
          accessType: "DEFAULT",
          modules: { FEED: true, PROPERTY: true },
        }),
      ],
    });
    expect(isExtendedCommunity(snapshot)).toBe(false);
    expect(isCommunityModuleEnabled(snapshot, "PROPERTY")).toBe(true);
    expect(enabledModuleSummary(activeCommunityContext(snapshot)!)).toBe(
      "Full community access",
    );
  });

  it("maps direct routes and Help mode to backend module keys", () => {
    expect(communityModuleForPath("/properties/create")).toBe("PROPERTY");
    expect(communityModuleForPath("/(app)/business/workspace/account-1")).toBe(
      "BUSINESS_DIRECTORY",
    );
    expect(communityModuleForPath("/(app)/(tabs)/rooms")).toBe("VOICE_ROOMS");
    expect(communityModuleForPath("/posts/create", "help")).toBe(
      "COMMUNITY_HELP",
    );
    expect(communityModuleForPath("/posts/create", "poll")).toBe("FEED");
    expect(communityModuleForPath("/messages/conversation-1")).toBeNull();
    expect(communityModuleForPath("/settings/security")).toBeNull();
  });
});
