import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { FormInput, FormInputProps } from '@/shared/components/form-input';
import { useTheme } from '@/hooks/use-theme';

export function PasswordInput(props: Omit<FormInputProps, 'secureTextEntry'>) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);

  return (
    <FormInput
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      secureTextEntry={!visible}
      endAdornment={
        <Pressable
          onPress={() => setVisible((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          style={({ pressed }) => pressed && styles.pressed}>
          <SymbolView
            name={
              visible
                ? { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' }
                : { ios: 'eye', android: 'visibility', web: 'visibility' }
            }
            size={20}
            tintColor={theme.textSecondary}
          />
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
});
