/**
 * Onboarding header row: back button (optional) + segmented progress bar.
 * Used on every onboarding screen for consistent navigation and orientation.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/shared/theme/spacing';
import { OnboardingProgress } from './onboarding-progress';
import type { OnboardingStep } from '@/core/session/session-types';

interface OnboardingHeaderProps {
  currentStep: OnboardingStep;
  showBack?: boolean;
  onBack?: () => void;
}

export function OnboardingHeader({
  currentStep,
  showBack = false,
  onBack,
}: OnboardingHeaderProps) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      {showBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={({ pressed }) => [
            styles.backBtn,
            { backgroundColor: theme.backgroundElement },
            pressed && styles.backBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <ThemedText style={styles.backArrow}>‹</ThemedText>
        </Pressable>
      ) : (
        <View style={styles.placeholder} />
      )}

      <OnboardingProgress currentStep={currentStep} />

      {/* Right spacer keeps progress bar centred */}
      <View style={styles.placeholder} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  backBtnPressed: { opacity: 0.55 },
  backArrow: {
    fontSize: 24,
    fontWeight: '400',
    lineHeight: 28,
    marginTop: -2,
  },
  placeholder: {
    width: 36,
    flexShrink: 0,
  },
});
