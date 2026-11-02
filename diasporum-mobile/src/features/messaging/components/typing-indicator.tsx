/**
 * M4 — TypingIndicator: animated dots shown while another participant is typing.
 * Automatically hidden by the use-thread expiry timer — no ref access in render.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

interface Props { visible: boolean; }

export function TypingIndicator({ visible }: Props) {
  const theme = useTheme();
  // useMemo (not useRef) for Animated values — safe in render.
  const dots = useMemo(
    () => [new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)],
    []
  );
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!visible) { animRef.current?.stop(); return; }
    const seq = Animated.loop(
      Animated.stagger(160, dots.map(d =>
        Animated.sequence([
          Animated.timing(d, { toValue: -6, duration: 240, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 240, useNativeDriver: true }),
        ])
      ))
    );
    animRef.current = seq;
    seq.start();
    return () => { seq.stop(); animRef.current = null; };
  }, [visible, dots]);

  if (!visible) return null;
  return (
    <View style={[styles.bubble, { backgroundColor: theme.backgroundElement }]}>
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={[styles.dot, {
            backgroundColor: theme.textSecondary,
            transform: [{ translateY: d }],
          }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 10, borderRadius: 16, alignSelf: 'flex-start', marginVertical: 2, marginHorizontal: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
