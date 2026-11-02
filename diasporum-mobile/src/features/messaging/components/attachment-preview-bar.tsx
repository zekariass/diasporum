/** M4 — horizontal strip of pending attachments with progress, remove, retry. */
import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { PendingAttachment } from '../types/messaging-types';

interface Props {
  attachments: PendingAttachment[];
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}

export function AttachmentPreviewBar({ attachments, onRemove, onRetry }: Props) {
  const theme = useTheme();
  if (attachments.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.content}>
      {attachments.map((att) => (
        <View key={att.localId} style={styles.item}>
          {att.purpose === 'MESSAGE_IMAGE'
            ? <Image source={{ uri: att.uri }} style={styles.thumb} />
            : <View style={[styles.docThumb, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="document-outline" size={28} color={theme.textSecondary} />
                <ThemedText style={styles.docLabel} numberOfLines={1} themeColor="textSecondary">{att.name.split('.').pop()?.toUpperCase()}</ThemedText>
              </View>}

          {att.status === 'uploading' && (
            <View style={styles.overlay}>
              <ActivityIndicator size="small" color="#fff" />
              <ThemedText style={styles.pct}>{Math.round(att.progress * 100)}%</ThemedText>
            </View>
          )}
          {att.status === 'failed' && (
            <Pressable style={styles.overlay} onPress={() => onRetry(att.localId)}>
              <Ionicons name="refresh" size={18} color="#fff" />
            </Pressable>
          )}

          <Pressable style={styles.removeBtn} onPress={() => onRemove(att.localId)} accessibilityRole="button" accessibilityLabel="Remove attachment">
            <Ionicons name="close-circle" size={18} color={theme.text} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ccc' },
  content: { padding: 8, gap: 8 },
  item: { width: 72, height: 72, borderRadius: 8, overflow: 'hidden', position: 'relative' },
  thumb: { width: '100%', height: '100%' },
  docThumb: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  docLabel: { fontSize: 9, marginTop: 2 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  pct: { color: '#fff', fontSize: 10, marginTop: 2 },
  removeBtn: { position: 'absolute', top: 2, right: 2, zIndex: 10 },
});
