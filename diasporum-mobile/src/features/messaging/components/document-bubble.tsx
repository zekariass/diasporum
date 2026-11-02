/** M4 — document attachment card with name, size, and open/download action. */
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { AttachmentView } from '../types/messaging-types';

interface Props { attachment: AttachmentView; fetchUrl: () => Promise<string>; }

function fmtSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentBubble({ attachment, fetchUrl }: Props) {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);

  const open = async () => {
    setLoading(true);
    try {
      const url = await fetchUrl();
      await Linking.openURL(url);
    } catch { /* silently fail — file may not be openable on device */ }
    finally { setLoading(false); }
  };

  const name = attachment.mimeType === 'application/pdf' ? '📄' : '📎';
  return (
    <Pressable onPress={open} style={[styles.card, { backgroundColor: theme.backgroundElement }]} accessibilityRole="button" accessibilityLabel={`Open document`}>
      <View style={styles.icon}>
        {loading
          ? <ActivityIndicator color={theme.primary} />
          : <ThemedText style={styles.emoji}>{name}</ThemedText>}
      </View>
      <View style={styles.meta}>
        <ThemedText style={styles.name} numberOfLines={2}>{attachment.mimeType?.split('/')[1]?.toUpperCase() ?? 'FILE'}</ThemedText>
        {attachment.sizeBytes ? <ThemedText style={styles.size} themeColor="textSecondary">{fmtSize(attachment.sizeBytes)}</ThemedText> : null}
      </View>
      <Ionicons name="download-outline" size={20} color={theme.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, maxWidth: 240 },
  icon: { width: 36, alignItems: 'center' },
  emoji: { fontSize: 24 },
  meta: { flex: 1 },
  name: { fontSize: 13, fontWeight: '600' },
  size: { fontSize: 11, marginTop: 2 },
});
