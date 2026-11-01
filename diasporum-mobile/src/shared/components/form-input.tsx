import React from 'react';
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { BrandColors } from '@/shared/theme/colors';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';

export interface FormInputProps extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  endAdornment?: React.ReactNode;
}

export function FormInput({ label, error, hint, required, endAdornment, ...props }: FormInputProps) {
  const theme = useTheme();
  const hasError = Boolean(error);

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <ThemedText style={styles.label}>
          {label}
          {required ? <ThemedText style={{ color: BrandColors.error }}> *</ThemedText> : null}
        </ThemedText>
      </View>
      <View style={styles.inputWrap}>
        <TextInput
          {...props}
          style={[
            styles.input,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: hasError ? BrandColors.error : theme.border,
              color: theme.text,
            },
            endAdornment ? styles.inputWithAdornment : null,
          ]}
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel={required ? `${label} (required)` : label}
        />
        {endAdornment ? (
          <View style={styles.adornment} pointerEvents="box-none">
            {endAdornment}
          </View>
        ) : null}
      </View>
      {error ? (
        <ThemedText style={[styles.hint, { color: BrandColors.error }]}
          accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText style={styles.hint} themeColor="textSecondary">{hint}</ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one },
  labelRow: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 14, fontWeight: '600' },
  inputWrap: { justifyContent: 'center' },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 15,
    minHeight: 48,
  },
  inputWithAdornment: { paddingRight: Spacing.six },
  adornment: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  hint: { fontSize: 12, lineHeight: 16 },
});
