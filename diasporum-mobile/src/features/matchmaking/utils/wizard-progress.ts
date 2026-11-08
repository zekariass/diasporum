import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type {
  MatchmakingProfileRequest,
  SharedProfileDraft,
} from "../types/matchmaking-types";

/**
 * Local persistence for an interrupted Dating setup wizard. The step position
 * AND the in-progress answers are stored so closing the app mid-flow resumes
 * exactly where the user stopped — the server-side draft remains the
 * cross-device record, this is the device-local one.
 * All operations are best-effort: storage failures must never block the flow.
 */

export interface WizardDraft {
  step: number;
  request: MatchmakingProfileRequest;
  stepKey?: string;
  shared?: SharedProfileDraft;
  /** The complete profile stage was saved; resume at preferences on re-entry. */
  profileSaved?: boolean;
}

const keyFor = (userId: string) => `diasporum.datingSetupDraft.${userId}`;
const pending = new Map<string, Promise<void>>();

function serialize(key: string, operation: () => Promise<void>): Promise<void> {
  const next = (pending.get(key) ?? Promise.resolve())
    .then(operation)
    .catch(() => {});
  pending.set(key, next);
  void next.then(() => {
    if (pending.get(key) === next) pending.delete(key);
  });
  return next;
}

function validRequest(value: unknown): value is MatchmakingProfileRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (
    r.status !== "DRAFT" ||
    typeof r.genderKey !== "string" ||
    typeof r.anonymousAlias !== "string" ||
    r.anonymousAlias.length > 80
  )
    return false;
  if (
    !["VISIBLE", "BLURRED", "HIDDEN"].includes(String(r.nameVisibility)) ||
    !["VISIBLE", "BLURRED", "HIDDEN"].includes(String(r.photoVisibility))
  )
    return false;
  const strings = [
    "addressId",
    "nationalityCountryId",
    "religionId",
    "educationLevel",
    "occupation",
    "relationshipIntention",
    "maritalStatus",
    "wantsChildren",
    "smoking",
    "drinking",
    "activityLevel",
    "marriageTimeline",
    "religionImportance",
    "photoMediaId",
  ];
  if (
    strings.some(
      (key) =>
        r[key] != null &&
        (typeof r[key] !== "string" || (r[key] as string).length > 160),
    )
  )
    return false;
  if (
    ["hasChildren", "longDistanceRelationship", "willingToRelocate"].some(
      (key) => r[key] != null && typeof r[key] !== "boolean",
    )
  )
    return false;
  return (
    r.heightCm == null ||
    (Number.isInteger(r.heightCm) &&
      Number(r.heightCm) >= 80 &&
      Number(r.heightCm) <= 250)
  );
}

const requestKeys = [
  "genderKey",
  "anonymousAlias",
  "nameVisibility",
  "photoVisibility",
  "status",
  "addressId",
  "nationalityCountryId",
  "religionId",
  "educationLevel",
  "occupation",
  "relationshipIntention",
  "maritalStatus",
  "wantsChildren",
  "smoking",
  "drinking",
  "activityLevel",
  "marriageTimeline",
  "religionImportance",
  "photoMediaId",
  "heightCm",
  "hasChildren",
  "longDistanceRelationship",
  "willingToRelocate",
];

function sharedDraft(value: unknown): SharedProfileDraft | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const s = value as Record<string, unknown>;
  const ids = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.length <= 30 &&
    v.every((id) => typeof id === "string" && id.length <= 80);
  if (
    typeof s.bio !== "string" ||
    s.bio.length > 800 ||
    typeof s.city !== "string" ||
    s.city.length > 120 ||
    (s.currentCountryId !== null &&
      (typeof s.currentCountryId !== "string" ||
        s.currentCountryId.length > 80)) ||
    !ids(s.interestIds) ||
    !ids(s.languageIds)
  )
    return undefined;
  return {
    bio: s.bio,
    city: s.city,
    currentCountryId: s.currentCountryId,
    interestIds: s.interestIds,
    languageIds: s.languageIds,
  };
}

export async function loadWizardDraft(
  userId: string | null | undefined,
): Promise<WizardDraft | null> {
  if (!userId) return null;
  try {
    const key = keyFor(userId);
    await pending.get(key);
    const raw =
      Platform.OS === "web"
        ? globalThis.sessionStorage?.getItem(key)
        : await SecureStore.getItemAsync(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardDraft> & {
      version?: number;
    };
    if (
      (parsed.version != null &&
        parsed.version !== 1 &&
        parsed.version !== 2 &&
        parsed.version !== 3) ||
      !Number.isInteger(parsed.step) ||
      (parsed.step ?? -1) < 0 ||
      (parsed.step ?? 0) > 50 ||
      !validRequest(parsed.request)
    ) {
      return null;
    }
    const request = Object.fromEntries(
      Object.entries(parsed.request).filter(([key]) =>
        requestKeys.includes(key),
      ),
    ) as MatchmakingProfileRequest;
    return {
      step: parsed.step as number,
      request,
      shared: sharedDraft(parsed.shared),
      profileSaved: parsed.profileSaved === true,
      stepKey:
        typeof parsed.stepKey === "string" && parsed.stepKey.length < 40
          ? parsed.stepKey
          : parsed.step === 13
            ? "privacy"
            : undefined,
    };
  } catch {
    return null;
  }
}

export async function saveWizardDraft(
  userId: string | null | undefined,
  draft: WizardDraft,
): Promise<void> {
  if (!userId) return;
  const key = keyFor(userId);
  const snapshot = JSON.stringify({ ...draft, version: 3 });
  await serialize(key, async () => {
    if (Platform.OS === "web")
      globalThis.sessionStorage?.setItem(key, snapshot);
    else await SecureStore.setItemAsync(key, snapshot);
  });
}

export async function clearWizardDraft(
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  const key = keyFor(userId);
  await serialize(key, async () => {
    if (Platform.OS === "web") globalThis.sessionStorage?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  });
}
