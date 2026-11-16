/**
 * ScrollView that stays usable above the software keyboard — wraps the app's
 * standard KeyboardAvoidingView pattern (iOS padding / Android height) while
 * keeping taps working and the keyboard open during scroll. Use instead of a plain
 * ScrollView on any screen containing text inputs so forms are never covered.
 */
import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type StyleProp,
  type ViewStyle,
  type ScrollViewProps,
} from "react-native";

/** Bare KeyboardAvoidingView with the app's standard platform behavior. Use
 * when a screen needs avoidance but not a ScrollView (e.g. docked footers,
 * lists that already handle their own scrolling). */
export function KeyboardAvoiding({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

export function KeyboardAwareScrollView({
  children,
  contentContainerStyle,
  ...rest
}: ScrollViewProps) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        contentContainerStyle={contentContainerStyle}
        {...rest}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
