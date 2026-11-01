import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from './primary-button';
import { BrandColors } from '@/shared/theme/colors';
import { Spacing } from '@/shared/theme/spacing';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({ message, onRetry, retryLabel = 'Try again' }: ErrorStateProps) {
  return (
    <View style={styles.container} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <View style={styles.iconWrap}>
        <ThemedText style={styles.icon}>!</ThemedText>
      </View>
      <ThemedText type="subtitle" style={styles.title}>Something went wrong</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
        {message}
      </ThemedText>
      {onRetry ? (
        <PrimaryButton label={retryLabel} onPress={onRetry} variant="secondary" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: BrandColors.errorSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 32,
    fontWeight: '700',
    color: BrandColors.error,
  },
  title: { textAlign: 'center' },
  message: { textAlign: 'center', maxWidth: 300 },
});
