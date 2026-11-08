import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { DiscoveryMode } from "../components/matchmaking-ui";

/**
 * Device-local memory of the last discovery view mode (swipe deck or browse
 * grid). The module snapshot restores instantly when navigating back to
 * discovery; SecureStore keeps the choice across app restarts. Best-effort —
 * storage failures must never block the screen.
 */
const STORAGE_KEY = "diasporum.discoveryViewMode";
let snapshot: DiscoveryMode | null = null;

const isMode = (value: unknown): value is DiscoveryMode =>
  value === "swipe" || value === "browse";

/** Last known mode for the first render; "swipe" until restored. */
export function discoveryModeSnapshot(): DiscoveryMode {
  return snapshot ?? "swipe";
}

/** Hydrates the snapshot from storage; resolves to the effective mode. */
export async function loadDiscoveryMode(): Promise<DiscoveryMode> {
  try {
    const stored =
      Platform.OS === "web"
        ? globalThis.sessionStorage?.getItem(STORAGE_KEY)
        : await SecureStore.getItemAsync(STORAGE_KEY);
    if (isMode(stored)) snapshot = stored;
  } catch {
    // Best-effort — a storage failure falls back to the snapshot default.
  }
  return discoveryModeSnapshot();
}

export function saveDiscoveryMode(mode: DiscoveryMode): void {
  snapshot = mode;
  void (async () => {
    try {
      if (Platform.OS === "web") {
        globalThis.sessionStorage?.setItem(STORAGE_KEY, mode);
      } else {
        await SecureStore.setItemAsync(STORAGE_KEY, mode);
      }
    } catch {
      // Best-effort — losing the preference must never break discovery.
    }
  })();
}
