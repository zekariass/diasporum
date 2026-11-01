import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { BrandColors } from '@/shared/theme/colors';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  style?: ViewStyle;
}

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  style,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;

  const colors: Record<string, { bg: string; text: string; border?: string }> = {
    primary: { bg: BrandColors.primary, text: BrandColors.white },
    secondary: { bg: BrandColors.primarySurface, text: BrandColors.primaryDark, border: BrandColors.primary },
    danger: { bg: BrandColors.errorSurface, text: BrandColors.error },
    ghost: { bg: 'transparent', text: BrandColors.primary },
  };
  const c = colors[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: c.bg, borderColor: c.border ?? c.bg },
        variant === 'secondary' && { borderWidth: 1 },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={c.text} accessibilityLabel={`${label} — loading`} />
      ) : (
        <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    minWidth: 140,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.55 },
  label: { fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },
});
