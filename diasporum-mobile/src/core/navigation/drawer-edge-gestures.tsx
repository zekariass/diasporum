/**
 * DrawerEdgeGestures — wraps the app content and detects swipes that START
 * within a thin band at the screen edges:
 *   left edge  + swipe right → open the feature navigation drawer
 *   right edge + swipe left  → open the community switcher drawer
 *
 * The pan responder lives on an ancestor of the content, so every inner view
 * (scroll views, dating cards, reels pager, tabs) gets first refusal — the
 * edge gesture only claims touches that clearly move horizontally from the
 * screen edge and that no child has claimed. It never blocks taps, vertical
 * scrolling, or in-content swipes.
 */

import React, { useState } from "react";
import {
  Dimensions,
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";

import { useNavigationDrawers, type DrawerSide } from "./drawer-context";

/** Width of the screen-edge band that can start a drawer swipe. */
const EDGE_WIDTH = 24;
/** Horizontal movement required before the responder claims the touch. */
const ACTIVATE_DX = 12;
/** Release thresholds that qualify as "open the drawer". */
const OPEN_DX = 60;
const OPEN_VX = 0.45;
/** Horizontal must dominate vertical by this factor to count as a drawer swipe. */
const AXIS_RATIO = 1.25;

/** The screen edge where the gesture started (current x minus displacement). */
function edgeFor(
  evt: GestureResponderEvent,
  gesture: PanResponderGestureState,
): DrawerSide | null {
  const width = Dimensions.get("window").width;
  const startX = evt.nativeEvent.pageX - gesture.dx;
  if (startX <= EDGE_WIDTH) return "left";
  if (startX >= width - EDGE_WIDTH) return "right";
  return null;
}

export function DrawerEdgeGestures({
  children,
}: {
  children: React.ReactNode;
}) {
  const { openLeft, openRight } = useNavigationDrawers();

  // useState initializer: the responder is created once; its callbacks close
  // over stable context functions and keep no shared mutable state.
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gesture) => {
        const side = edgeFor(evt, gesture);
        if (side == null) return false;
        const { dx, dy } = gesture;
        const inward = side === "left" ? dx > 0 : dx < 0;
        return (
          inward &&
          Math.abs(dx) >= ACTIVATE_DX &&
          Math.abs(dx) > Math.abs(dy) * AXIS_RATIO
        );
      },
      onPanResponderRelease: (evt, gesture) => {
        const side = edgeFor(evt, gesture);
        if (side === "left" && (gesture.dx > OPEN_DX || gesture.vx > OPEN_VX)) {
          openLeft();
        } else if (
          side === "right" &&
          (gesture.dx < -OPEN_DX || gesture.vx < -OPEN_VX)
        ) {
          openRight();
        }
      },
      onPanResponderTerminationRequest: () => true,
    }),
  );

  return (
    <View
      style={styles.container}
      collapsable={false}
      {...responder.panHandlers}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
