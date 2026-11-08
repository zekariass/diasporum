import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { PrimaryButton } from "@/shared/components/primary-button";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { ScreenHeader } from "../components/matchmaking-ui";
import { loadWizardDraft } from "../utils/wizard-progress";

type IconName = keyof typeof Ionicons.glyphMap;

function FeatureBullet({ icon, text }: { icon: IconName; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.bullet}>
      <View
        style={[styles.bulletIcon, { backgroundColor: theme.primarySurface }]}
      >
        <Ionicons name={icon} size={17} color={theme.primary} />
      </View>
      <ThemedText themeColor="textSecondary" style={styles.bulletText}>
        {text}
      </ThemedText>
    </View>
  );
}

/** Dedicated Dating introduction shown when the user has no Dating profile. */
export default function DatingIntroScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const [resumable, setResumable] = useState(false);

  // A saved onboarding draft means this is a continuation, not a first visit —
  // e.g. the app was closed mid-setup before the draft reached the server.
  useEffect(() => {
    let active = true;
    void loadWizardDraft(session?.me?.id).then((draft) => {
      if (active && draft) setResumable(true);
    });
    return () => {
      active = false;
    };
  }, [session?.me?.id]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <ScreenHeader title="Dating" />
        <ScrollView contentContainerStyle={styles.content}>
          {/* Layered brand visual — no bitmap asset required */}
          <View
            style={styles.hero}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            <View
              style={[
                styles.halo,
                styles.haloOuter,
                { backgroundColor: theme.primarySurface },
              ]}
            />
            <View
              style={[
                styles.halo,
                styles.haloInner,
                { backgroundColor: theme.primarySurface },
              ]}
            />
            <View
              style={[styles.heroCircle, { backgroundColor: theme.primary }]}
            >
              <Ionicons name="heart" size={58} color="#fff" />
            </View>
            <View
              style={[
                styles.orb,
                styles.orbLeft,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <Ionicons name="people" size={20} color={theme.primary} />
            </View>
            <View
              style={[
                styles.orb,
                styles.orbRight,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <Ionicons
                name="chatbubble-ellipses"
                size={18}
                color={theme.primary}
              />
            </View>
          </View>

          <ThemedText type="title" style={styles.title}>
            Find meaningful connections
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.body}>
            Create your Dating profile to discover people, express interest and
            connect with others in the Diasporum community. Dating is optional,
            and you can pause at any time.
          </ThemedText>

          <View style={styles.bullets}>
            <FeatureBullet
              icon="shield-checkmark-outline"
              text="Private by default — you control name and photo visibility"
            />
            <FeatureBullet
              icon="heart-half-outline"
              text="Swipe or browse — mutual likes open a conversation"
            />
            <FeatureBullet
              icon="checkmark-circle-outline"
              text="Adults only, with reciprocal preference matching"
            />
            <FeatureBullet
              icon="flag-outline"
              text="Report or block at any time — your safety comes first"
            />
          </View>

          <PrimaryButton
            label={
              resumable ? "Complete your profile" : "Create Dating Profile"
            }
            onPress={() => router.push("/(app)/matchmaking/setup" as never)}
          />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const HERO = 148;

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
    gap: Spacing.four,
  },
  hero: {
    width: 220,
    height: 190,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: { position: "absolute", borderRadius: BorderRadius.full },
  haloOuter: { width: 190, height: 190, opacity: 0.45 },
  haloInner: { width: 162, height: 162, opacity: 0.8 },
  heroCircle: {
    width: HERO,
    height: HERO,
    borderRadius: HERO / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  orb: {
    position: "absolute",
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  orbLeft: { left: 4, top: 40 },
  orbRight: { right: 0, bottom: 30 },
  title: { textAlign: "center" },
  body: { textAlign: "center", fontSize: 15, lineHeight: 22, maxWidth: 330 },
  bullets: {
    alignSelf: "stretch",
    gap: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  bullet: { flexDirection: "row", alignItems: "center", gap: Spacing.three },
  bulletIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 19 },
});
