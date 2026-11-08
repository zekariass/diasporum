/**
 * VoiceRecorder — record → preview → attach voice notes in the post composer.
 * expo-audio (SDK 58): useAudioRecorder + HIGH_QUALITY preset (.m4a/AAC).
 * Handles permission denial, interruptions and cleanup; recording stops
 * before handing the file to the composer.
 */

import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius } from "@/shared/theme/spacing";

export interface RecordedVoice {
  uri: string;
  name: string;
  mimeType: string; // audio/mp4 — cross-platform container for AAC
  durationMs: number;
}

interface Props {
  visible: boolean;
  disabled?: boolean;
  onRecorded: (file: RecordedVoice) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceRecorder({ visible, disabled, onRecorded, onCancel, onError }: Props) {
  const theme = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);
  const [preview, setPreview] = useState<RecordedVoice | null>(null);
  const [busy, setBusy] = useState(false);
  const previewPlayer = useAudioPlayer(preview?.uri ?? null);
  const previewStatus = useAudioPlayerStatus(previewPlayer);

  const reset = useCallback(() => setPreview(null), []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!visible) reset();
  }, [visible, reset]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        onError("Microphone access is required to record a voice message.");
        onCancel();
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      onError("Could not start recording. Please try again.");
      onCancel();
    } finally {
      setBusy(false);
    }
  }, [recorder, onError, onCancel]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (visible && !preview && !recState.isRecording && !busy) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void start();
    }
  }, [visible]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      if (recorder.uri) {
        const name = `voice-${Date.now()}.m4a`;
        setPreview({
          uri: recorder.uri,
          name,
          mimeType: "audio/mp4",
          durationMs: Math.max(1, Math.round(recState.durationMillis)),
        });
      } else {
        onError("Recording failed — no audio was captured.");
        onCancel();
      }
    } catch {
      onError("Could not finish the recording.");
      onCancel();
    } finally {
      setBusy(false);
    }
  }, [recorder, recState.durationMillis, onError, onCancel]);

  const discard = useCallback(async () => {
    try {
      if (recState.isRecording) await recorder.stop();
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    } catch {
      /* cleanup best-effort */
    }
    reset();
    onCancel();
  }, [recorder, recState.isRecording, reset, onCancel]);

  if (!visible) return null;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement }]}
      accessibilityLabel="Voice recorder"
    >
      {preview ? (
        <>
          <Pressable
            onPress={() =>
              previewStatus.playing ? previewPlayer.pause() : previewPlayer.play()
            }
            style={[styles.btn, { backgroundColor: BrandColors.primary }]}
            accessibilityRole="button"
            accessibilityLabel={previewStatus.playing ? "Pause preview" : "Play preview"}
          >
            <Ionicons
              name={previewStatus.playing ? "pause" : "play"}
              size={18}
              color="#FFFFFF"
            />
          </Pressable>
          <ThemedText style={styles.dur}>{fmt(preview.durationMs)}</ThemedText>
          <View style={styles.row}>
            <Pressable
              onPress={discard}
              disabled={disabled || busy}
              accessibilityRole="button"
              accessibilityLabel="Discard recording"
            >
              <Ionicons name="trash-outline" size={20} color={theme.error} />
            </Pressable>
            <Pressable
              onPress={() => {
                onRecorded(preview);
                reset();
              }}
              disabled={disabled || busy}
              style={[styles.attach, { backgroundColor: BrandColors.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Attach voice message"
            >
              <ThemedText style={styles.attachText}>Attach</ThemedText>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={[styles.dot, { backgroundColor: theme.error }]} />
          <ThemedText style={styles.dur}>
            {recState.isRecording ? fmt(recState.durationMillis) : "…"}
          </ThemedText>
          <View style={styles.row}>
            <Pressable
              onPress={discard}
              disabled={disabled || busy}
              accessibilityRole="button"
              accessibilityLabel="Cancel recording"
            >
              <Ionicons name="close" size={20} color={theme.textSecondary} />
            </Pressable>
            {busy ? (
              <ActivityIndicator size="small" color={BrandColors.primary} />
            ) : (
              <Pressable
                onPress={stop}
                disabled={disabled || !recState.isRecording}
                style={[styles.stop, { borderColor: theme.error }]}
                accessibilityRole="button"
                accessibilityLabel="Stop recording"
              >
                <View style={[styles.stopFill, { backgroundColor: theme.error }]} />
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: BorderRadius.md,
    padding: 10,
    maxWidth: 320,
  },
  btn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dur: { fontSize: 14, fontWeight: "600", flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  stop: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  stopFill: { width: 12, height: 12, borderRadius: 3 },
  attach: { borderRadius: BorderRadius.sm, paddingHorizontal: 12, paddingVertical: 6 },
  attachText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
});
