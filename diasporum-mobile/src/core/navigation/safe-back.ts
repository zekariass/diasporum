/**
 * Guarded back navigation — prevents dispatching GO_BACK when the current
 * stack has no previous entry (unhandled-action dev warning + no-op UX).
 */

import { router } from 'expo-router';

export function safeBack(): void {
  if (router.canGoBack()) router.back();
}
