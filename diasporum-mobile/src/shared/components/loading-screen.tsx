import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from '@/components/themed-text';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message }: LoadingScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel={message ?? 'Loading'}>
      <ActivityIndicator
        size="large"
        color={theme.text}
        accessibilityLabel="Loading indicator"
      />
      {message ? (
        <ThemedText style={styles.message} themeColor="textSecondary">
          {message}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
  },
});
