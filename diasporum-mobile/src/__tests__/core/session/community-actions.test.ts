import { Alert } from "react-native";

import {
  communityActionEligibilityMessage,
  confirmCommunityAction,
} from "@/core/session/community-actions";
import type { ApiClient } from "@/core/api/api-client";
import type {
  CommunityActionEligibility,
  MyCommunityAccess,
} from "@/features/communities/types/community-types";

const confirmation = {
  actionKey: "EXTENDED_FEED_POST_PUBLISH" as const,
  title: "Publish post?",
  confirmLabel: "Publish",
};

function eligibility(
  overrides: Partial<CommunityActionEligibility> = {},
): CommunityActionEligibility {
  return {
    allowed: true,
    chargeRequired: false,
    consumptionRequired: false,
    quantity: 1,
    remainingFreeQuota: null,
    availableCredits: null,
    source: "UNCONFIGURED_FREE",
    reason: "OK",
    ...overrides,
  };
}

function access(
  accessType: "DEFAULT" | "ORIGIN_EXTENDED" = "ORIGIN_EXTENDED",
): MyCommunityAccess {
  return {
    defaultCommunityId: "default-1",
    activeCommunityId: "community-1",
    communities: [
      {
        communityId: "community-1",
        communityName: "Community",
        accessType,
        originCountryId: "origin-1",
        destinationCountryId: "destination-1",
        modules: { FEED: true },
      },
    ],
  };
}

function clientWith(response: CommunityActionEligibility) {
  return {
    get: jest.fn().mockResolvedValue(response),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  } as unknown as ApiClient;
}

describe("confirmCommunityAction", () => {
  afterEach(() => jest.restoreAllMocks());

  it("does not request Extended eligibility for a Default community", async () => {
    const client = clientWith(eligibility());
    await expect(
      confirmCommunityAction(client, access("DEFAULT"), confirmation),
    ).resolves.toBe(true);
    expect(client.get).not.toHaveBeenCalled();
  });

  it("allows an unconfigured-free Extended action without a confirmation prompt", async () => {
    const client = clientWith(eligibility());
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await expect(
      confirmCommunityAction(client, access(), confirmation),
    ).resolves.toBe(true);
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/me/community-actions/EXTENDED_FEED_POST_PUBLISH/eligibility",
      { authenticated: true },
    );
    expect(alert).not.toHaveBeenCalled();
  });

  it("shows server-reported credits and continues only after confirmation", async () => {
    const client = clientWith(
      eligibility({
        chargeRequired: true,
        consumptionRequired: true,
        availableCredits: 7,
        source: "CREDIT_GRANT",
      }),
    );
    const alert = jest
      .spyOn(Alert, "alert")
      .mockImplementation((_title, _message, buttons) => {
        buttons?.find((button) => button.text === "Publish")?.onPress?.();
      });
    await expect(
      confirmCommunityAction(client, access(), confirmation),
    ).resolves.toBe(true);
    expect(alert).toHaveBeenCalledWith(
      "Publish post?",
      expect.stringContaining("7 credits available"),
      expect.any(Array),
      expect.any(Object),
    );
  });

  it("shows remaining plan quota and supports cancellation", async () => {
    const client = clientWith(
      eligibility({
        consumptionRequired: true,
        remainingFreeQuota: 3,
        source: "PLAN_ENTITLEMENT",
      }),
    );
    jest
      .spyOn(Alert, "alert")
      .mockImplementation((_title, message, buttons) => {
        expect(message).toContain("3 remaining");
        buttons?.find((button) => button.text === "Cancel")?.onPress?.();
      });
    await expect(
      confirmCommunityAction(client, access(), confirmation),
    ).resolves.toBe(false);
  });

  it("does not offer a charge confirmation when quota is exhausted", async () => {
    const denied = eligibility({
      allowed: false,
      consumptionRequired: true,
      remainingFreeQuota: 0,
      source: "PLAN_ENTITLEMENT",
      reason: "ENTITLEMENT_QUOTA_EXCEEDED",
    });
    const client = clientWith(denied);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await expect(
      confirmCommunityAction(client, access(), confirmation),
    ).resolves.toBe(false);
    expect(communityActionEligibilityMessage(denied)).toContain("exhausted");
    expect(alert).toHaveBeenCalledWith(
      "Action unavailable",
      expect.stringContaining("exhausted"),
    );
  });

  it("keeps legacy sessions compatible while retaining backend enforcement", async () => {
    const client = clientWith(eligibility());
    await expect(
      confirmCommunityAction(client, null, confirmation),
    ).resolves.toBe(true);
    expect(client.get).not.toHaveBeenCalled();
  });
});
