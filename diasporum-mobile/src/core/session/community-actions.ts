import { Alert } from "react-native";

import type { ApiClient } from "@/core/api/api-client";
import { ApiError } from "@/core/api/api-error";
import { createCommunityApi } from "@/features/communities/services/community-api";
import type {
  CommunityActionEligibility,
  CommunityActionKey,
  MyCommunityAccess,
} from "@/features/communities/types/community-types";
import { activeCommunityContext } from "./community-capabilities";

export interface CommunityActionConfirmation {
  readonly actionKey: CommunityActionKey;
  readonly title: string;
  readonly confirmLabel: string;
}

export function communityActionEligibilityMessage(
  eligibility: CommunityActionEligibility,
): string {
  if (eligibility.allowed) return "This action is available.";
  switch (eligibility.reason) {
    case "ENTITLEMENT_QUOTA_EXCEEDED":
      return "Your credits or allowance for this community are exhausted. You can still browse and use free actions.";
    case "ENTITLEMENT_NOT_CONFIGURED":
      return "This action is not configured for your current plan.";
    case "COMMUNITY_MODULE_NOT_AVAILABLE":
      return "This action is not available in your active community.";
    default:
      return "This action is currently unavailable in your active community.";
  }
}

function confirmationMessage(eligibility: CommunityActionEligibility): string {
  const quantity = eligibility.quantity;
  if (eligibility.availableCredits != null) {
    return `This uses ${quantity} credit${quantity === 1 ? "" : "s"} in your active community. ${eligibility.availableCredits} credit${eligibility.availableCredits === 1 ? "" : "s"} available before this action.`;
  }
  if (eligibility.remainingFreeQuota != null) {
    return `This uses ${quantity} unit${quantity === 1 ? "" : "s"} from your active-community allowance. ${eligibility.remainingFreeQuota} remaining before this action.`;
  }
  return "This action consumes an allowance in your active community. The backend will verify the final allowance when the action succeeds.";
}

/**
 * Previews the backend decision without consuming anything. A missing snapshot
 * preserves legacy-client behavior; backend authorization remains authoritative.
 */
export async function confirmCommunityAction(
  client: ApiClient,
  access: MyCommunityAccess | null | undefined,
  confirmation: CommunityActionConfirmation,
): Promise<boolean> {
  if (access == null) return true;
  if (activeCommunityContext(access)?.accessType === "DEFAULT") return true;

  let eligibility: CommunityActionEligibility;
  try {
    eligibility = await createCommunityApi(client).actionEligibility(
      confirmation.actionKey,
    );
  } catch (error) {
    Alert.alert(
      "Could not verify allowance",
      ApiError.isApiError(error)
        ? error.userMessage
        : "Check your connection and try again. Nothing has been published or charged.",
    );
    return false;
  }

  if (!eligibility.allowed) {
    Alert.alert(
      "Action unavailable",
      communityActionEligibilityMessage(eligibility),
    );
    return false;
  }
  if (!eligibility.chargeRequired && !eligibility.consumptionRequired)
    return true;

  return new Promise((resolve) => {
    Alert.alert(
      confirmation.title,
      confirmationMessage(eligibility),
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: confirmation.confirmLabel,
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
