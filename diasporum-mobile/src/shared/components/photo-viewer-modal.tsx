/**
 * PhotoViewerModal — reusable full-screen photo viewer.
 *
 * Renders one or more images in a dark overlay with horizontal paging,
 * swipe-down-to-dismiss, and a close button. Source-agnostic: callers
 * pass media ids plus a resolver that turns an id into a displayable
 * URL (e.g. a signed download URL from their feature's media-cache),
 * so the same viewer works for feed media, avatars, chat photos, etc.
 *
 * Usage:
 *   <PhotoViewerModal
 *     visible={index !== null}
 *     mediaIds={images.map(m => m.id)}
 *     resolve={id => getFeedMediaUrl(apiClient, id)}
 *     refresh={id => refreshFeedMediaUrl(apiClient, id)}
 *     initialIndex={index ?? 0}
 *     onClose={() => setIndex(null)}
 *   />
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { BrandColors } from '@/shared/theme/colors';
import { SafeAreaView } from 'react-native-safe-area-context';

const DISMISS_DY = 120;
const DISMISS_VY = 0.8;

export interface PhotoViewerModalProps {
  visible: boolean;
  mediaIds: string[];
  /** Resolve a media id to a displayable image URL. */
  resolve: (mediaId: string) => Promise<string>;
  /** Optional re-resolve used once after an image-load failure (expired URL). */
  refresh?: (mediaId: string) => Promise<string>;
  initialIndex?: number;
  onClose: () => void;
}

export function PhotoViewerModal({
  visible, mediaIds, resolve, refresh, initialIndex = 0, onClose,
}: PhotoViewerModalProps) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const [openKey, setOpenKey] = useState(0);
  const [drag] = useState(() => new Animated.ValueXY({ x: 0, y: 0 }));

  // Reset paging + remount the list on each open (render-phase adjust pattern).
  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setIndex(initialIndex);
      setOpenKey((k) => k + 1);
    }
  }

  const latest = useRef({ onClose });
  useEffect(() => { latest.current = { onClose }; });
  useEffect(() => { if (!visible) drag.setValue({ x: 0, y: 0 }); }, [visible, drag]);

  // Vertical drag dismisses; horizontal is left to the paging list.
  // eslint-disable-next-line react-hooks/refs -- refs are read at event time, not during render
  const [pan] = useState(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) =>
      Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: Animated.event(
      [null, { dy: drag.y }],
      { useNativeDriver: false },
    ),
    onPanResponderRelease: (_e, g) => {
      if (g.dy > DISMISS_DY || g.vy > DISMISS_VY) {
        Animated.timing(drag.y, {
          toValue: 400, duration: 140, useNativeDriver: false,
        }).start(() => latest.current.onClose());
      } else {
        Animated.spring(drag.y, { toValue: 0, useNativeDriver: false }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(drag.y, { toValue: 0, useNativeDriver: false }).start();
    },
  }));

  const backdropOpacity = drag.y.interpolate({
    inputRange: [0, 300], outputRange: [1, 0.2], extrapolate: 'clamp',
  });

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}
          accessibilityLabel="Close photo viewer" accessibilityRole="button" />
      </Animated.View>

      <Animated.View
        key={openKey}
        style={[styles.content, { transform: [{ translateY: drag.y }] }]}
        {...pan.panHandlers}
      >
        <FlatList
          data={mediaIds}
          keyExtractor={(id) => id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={Math.min(initialIndex, mediaIds.length - 1)}
          getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) =>
            setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <View style={{ width, height }}>
              <ViewerImage key={item} mediaId={item} resolve={resolve} refresh={refresh} />
            </View>
          )}
        />
      </Animated.View>

      <SafeAreaView style={styles.chrome} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}
            accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>
          {mediaIds.length > 1 && (
            <View style={styles.counter}>
              <ThemedText style={styles.counterText}>
                {index + 1} / {mediaIds.length}
              </ThemedText>
            </View>
          )}
          <View style={styles.closeBtn} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ViewerImage({ mediaId, resolve, refresh }: {
  mediaId: string;
  resolve: (mediaId: string) => Promise<string>;
  refresh?: (mediaId: string) => Promise<string>;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);

  useEffect(() => {
    let cancelled = false;
    resolve(mediaId)
      .then((u) => { if (!cancelled) setUri(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [mediaId, resolve]);

  const handleError = useCallback(() => {
    if (retried.current || !refresh) { setFailed(true); return; }
    retried.current = true;
    refresh(mediaId).then(setUri).catch(() => setFailed(true));
  }, [mediaId, refresh]);

  if (failed) {
    return (
      <View style={styles.state}>
        <Ionicons name="image-outline" size={40} color="rgba(255,255,255,0.5)" />
        <ThemedText style={styles.stateText}>Photo unavailable</ThemedText>
      </View>
    );
  }
  if (!uri) {
    return (
      <View style={styles.state}>
        <ActivityIndicator size="large" color={BrandColors.primary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={styles.image}
      resizeMode="contain"
      onError={handleError}
      accessibilityLabel="Photo full screen"
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000000',
  },
  content: { flex: 1 },
  image: { width: '100%', height: '100%' },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  chrome: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: 8,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  counter: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  counterText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
});
