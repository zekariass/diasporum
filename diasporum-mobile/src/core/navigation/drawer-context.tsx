/**
 * Navigation drawer state — coordinates the two independent app drawers:
 *   left  → FeatureDrawer (main feature navigation)
 *   right → CommunityDrawer (community switching)
 *
 * A single nullable `openDrawer` value enforces mutual exclusion — opening one
 * side automatically closes the other. Mounted once inside (app)/_layout.
 */

import React, { createContext, useCallback, useContext, useState } from "react";

export type DrawerSide = "left" | "right";

interface NavigationDrawerContextValue {
  readonly openDrawer: DrawerSide | null;
  openLeft(): void;
  openRight(): void;
  close(): void;
}

const NavigationDrawerContext =
  createContext<NavigationDrawerContextValue | null>(null);

export function NavigationDrawerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [openDrawer, setOpenDrawer] = useState<DrawerSide | null>(null);

  const openLeft = useCallback(() => setOpenDrawer("left"), []);
  const openRight = useCallback(() => setOpenDrawer("right"), []);
  const close = useCallback(() => setOpenDrawer(null), []);

  return (
    <NavigationDrawerContext.Provider
      value={{ openDrawer, openLeft, openRight, close }}
    >
      {children}
    </NavigationDrawerContext.Provider>
  );
}

export function useNavigationDrawers(): NavigationDrawerContextValue {
  const ctx = useContext(NavigationDrawerContext);
  if (!ctx) {
    throw new Error(
      "useNavigationDrawers must be used within NavigationDrawerProvider",
    );
  }
  return ctx;
}
