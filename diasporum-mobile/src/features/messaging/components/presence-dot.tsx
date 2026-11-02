/** M4 — small green/grey dot indicating online/offline status. */
import React from 'react';
import { View, StyleSheet } from 'react-native';

interface Props { online: boolean; size?: number; }

export function PresenceDot({ online, size = 10 }: Props) {
  return (
    <View style={[styles.dot, {
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: online ? '#22c55e' : '#9ca3af',
    }]} />
  );
}

const styles = StyleSheet.create({ dot: { borderWidth: 1.5, borderColor: '#fff' } });
