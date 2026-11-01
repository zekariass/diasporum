/**
 * Messages tab — honest placeholder until the messaging module ships.
 * No fake conversation data is rendered.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/shared/theme/spacing';

export default function MessagesScreen() {
  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Messages</ThemedText>
        </View>
        <View style={styles.empty}>
          <ThemedText style={styles.icon}>💬</ThemedText>
          <ThemedText style={styles.emptyTitle}>No conversations yet</ThemedText>
          <ThemedText style={styles.emptyBody} themeColor="textSecondary">
            Direct messaging is coming soon. When it arrives, your
            conversations will appear here.
          </ThemedText>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  title: { fontSize: 24, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingHorizontal: Spacing.five },
  icon: { fontSize: 44 },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyBody: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
});
