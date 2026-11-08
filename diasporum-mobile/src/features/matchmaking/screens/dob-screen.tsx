import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { PrimaryButton } from '@/shared/components/primary-button';
import { DobSelect } from '@/shared/components/dob-select';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/core/session/session-provider';
import { ApiError } from '@/core/api/api-error';
import { Spacing } from '@/shared/theme/spacing';
import { toIsoDate } from '@/shared/utils/date-of-birth';
import { WizardHeader } from '../components/wizard-ui';
import { matchmakingError } from '../services/matchmaking-errors';

/**
 * One-time date-of-birth collection shown when the account has no stored
 * DOB (eligibility reason DOB_REQUIRED). The save writes the shared
 * account `date_of_birth` field and stamps the adult-eligibility
 * confirmation; the backend then re-resolves eligibility — 18+ continues
 * to setup, under-18 lands on the adults-only screen. DOB is immutable:
 * the backend rejects any second write, so this screen never reappears
 * once a value exists.
 */
export default function DatingDobScreen({ onSaved }: { onSaved: () => void }) {
  const theme = useTheme();
  const { updateProfile } = useSession();
  const [picked, setPicked] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!picked || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ dateOfBirth: toIsoDate(picked) });
      onSaved();
    } catch (cause) {
      // 409 DATE_OF_BIRTH_ALREADY_SET — DOB was stored elsewhere already;
      // re-resolve eligibility instead of blocking the user on a conflict.
      if (ApiError.isApiError(cause) && cause.httpStatus === 409) {
        onSaved();
        return;
      }
      setError(matchmakingError(cause, 'Your date of birth could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <WizardHeader step={0} total={5} title="Basic profile" icon="person"
          onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <View style={[styles.iconWrap, { backgroundColor: theme.primarySurface }]}
            accessibilityElementsHidden importantForAccessibility="no">
            <Ionicons name="calendar" size={44} color={theme.primary} />
          </View>

          <ThemedText type="title" style={styles.center}>When is your birthday?</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.center}>
            Dating is for members aged 18 or older.
          </ThemedText>

          <View style={styles.field}>
            <DobSelect value={picked}
              onChange={(date) => { setPicked(date); if (date) setError(null); }} />
            <ThemedText type="small" themeColor="textSecondary">
              {"Set once — it can't be edited afterwards."}
            </ThemedText>
          </View>

          {error ? (
            <ThemedText style={[styles.error, { color: theme.error }]}
              accessibilityRole="alert">
              {error}
            </ThemedText>
          ) : null}

          <PrimaryButton label="Continue" onPress={() => void save()}
            loading={saving} disabled={!picked || saving} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    padding: Spacing.four, gap: Spacing.four,
  },
  iconWrap: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  center: { textAlign: 'center', maxWidth: 330 },
  field: { alignSelf: 'stretch', gap: Spacing.one },
  error: { fontSize: 13, textAlign: 'center' },
});
