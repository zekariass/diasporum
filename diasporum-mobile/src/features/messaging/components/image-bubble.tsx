/**
 * M4 — renders a single image attachment thumbnail. Tapping opens a
 * presigned download URL in a full-screen viewer. Download is deferred to
 * tap-time so we never request URLs eagerly for every history message.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/use-theme';
import type { AttachmentView } from '../types/messaging-types';

interface Props {
  attachment: AttachmentView;
  fetchUrl: () => Promise<string>;
}

export function ImageBubble({ attachment, fetchUrl }: Props) {
  const theme = useTheme();
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);

  const openViewer = async () => {
    if (!fullUrl) {
      setLoading(true);
      try { setFullUrl(await fetchUrl()); } finally { setLoading(false); }
    }
    setViewerVisible(true);
  };

  return (
    <>
      <Pressable onPress={openViewer} style={styles.thumb} accessibilityRole="imagebutton" accessibilityLabel="View image">
        {fullUrl
          ? <Image source={{ uri: fullUrl }} style={styles.img} resizeMode="cover" />
          : <View style={[styles.placeholder, { backgroundColor: theme.backgroundElement }]}>
              {loading
                ? <ActivityIndicator color={theme.primary} />
                : <Ionicons name="image-outline" size={28} color={theme.textSecondary} />}
            </View>}
      </Pressable>

      <Modal visible={viewerVisible} transparent animationType="fade" onRequestClose={() => setViewerVisible(false)}>
        <View style={styles.overlay}>
          <Pressable style={styles.closeBtn} onPress={() => setViewerVisible(false)} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          {fullUrl && <Image source={{ uri: fullUrl }} style={styles.fullImg} resizeMode="contain" />}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 200, height: 160, borderRadius: 12, overflow: 'hidden' },
  img: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  closeBtn: { position: 'absolute', top: 52, right: 20, zIndex: 10, padding: 8 },
  fullImg: { width: '100%', height: '80%' },
});
