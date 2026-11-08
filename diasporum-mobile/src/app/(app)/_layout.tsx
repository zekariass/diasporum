/**
 * Authenticated route group layout.
 * Guards: must be authenticated AND fully onboarded.
 * Unauthenticated → login. Onboarding incomplete → onboarding flow.
 *
 * Hosts the two app-wide drawers (left = feature navigation,
 * right = community switching) and the screen-edge gestures that open them.
 */

import {
  Redirect,
  Stack,
  useLocalSearchParams,
  usePathname,
} from "expo-router";

import { useAuth } from "@/core/auth/auth-provider";
import { useSession } from "@/core/session/session-provider";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import {
  communityModuleForPath,
  isCommunityModuleEnabled,
} from "@/core/session/community-capabilities";
import {
  NavigationDrawerProvider,
  useNavigationDrawers,
} from "@/core/navigation/drawer-context";
import { DrawerEdgeGestures } from "@/core/navigation/drawer-edge-gestures";
import { FeatureDrawer } from "@/core/navigation/feature-drawer";
import { CommunityDrawer } from "@/features/feed/components/community-drawer";

/** Mounts both drawers once; single openDrawer state keeps them exclusive. */
function AppDrawers() {
  const { openDrawer, openRight, close } = useNavigationDrawers();
  return (
    <>
      <FeatureDrawer
        visible={openDrawer === "left"}
        onClose={close}
        onSwitchCommunity={openRight}
      />
      <CommunityDrawer visible={openDrawer === "right"} onClose={close} />
    </>
  );
}

export default function AppLayout() {
  const { authState } = useAuth();
  const { session, isLoading, error, onboardingStep, refresh } = useSession();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const requiredModule = communityModuleForPath(pathname, mode);

  if (authState.status === "loading" || isLoading) {
    return <LoadingScreen />;
  }

  if (authState.status === "unauthenticated") {
    return <Redirect href="/(auth)/login" />;
  }

  if (error && !session) {
    return <ErrorState message={error} onRetry={refresh} />;
  }

  if (onboardingStep !== "main-app") {
    return <Redirect href={`/(onboarding)/${onboardingStep}` as never} />;
  }

  if (
    requiredModule &&
    !isCommunityModuleEnabled(session?.access, requiredModule)
  ) {
    return (
      <ErrorState
        message="This feature isn't available in your active community. Switch communities or return to an enabled feature."
        onRetry={refresh}
      />
    );
  }

  return (
    <NavigationDrawerProvider>
      <DrawerEdgeGestures>
        <Stack screenOptions={{ headerShown: false }} />
      </DrawerEdgeGestures>
      <AppDrawers />
    </NavigationDrawerProvider>
  );
}
