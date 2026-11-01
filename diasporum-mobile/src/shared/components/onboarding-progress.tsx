import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BrandColors } from '@/shared/theme/colors';
import type { OnboardingStep } from '@/core/session/session-types';
import { ONBOARDING_STEPS } from '@/core/session/session-types';

interface OnboardingProgressProps {
  currentStep: OnboardingStep;
}

/** Segmented progress bar + "N of 5" counter shown on each onboarding screen. */
export function OnboardingProgress({ currentStep }: OnboardingProgressProps) {
  const steps = ONBOARDING_STEPS.slice(0, -1); // exclude 'main-app'
  const currentIndex = steps.indexOf(currentStep);

  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${currentIndex + 1} of ${steps.length}`}
      accessibilityValue={{ min: 0, max: steps.length, now: currentIndex + 1 }}>
      <View style={styles.track}>
        {steps.map((step, i) => (
          <View
            key={step}
            style={[styles.segment, i <= currentIndex && styles.segmentFilled]}
          />
        ))}
      </View>
      <ThemedText style={styles.counter} themeColor="textSecondary">
        {currentIndex + 1} of {steps.length}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  track: {
    flex: 1,
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  segmentFilled: {
    backgroundColor: BrandColors.primary,
  },
  counter: {
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 0,
  },
});
