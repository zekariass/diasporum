import React, { useEffect, useState, type ComponentProps } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";

type IconName = ComponentProps<typeof Ionicons>["name"];

interface CreateOption {
  key: string;
  title: string;
  description: string;
  icon: IconName;
  color: string;
  route?: string;
}

const OPTIONS: CreateOption[] = [
  {
    key: "post",
    title: "Post",
    description: "Share an update with your community",
    icon: "create-outline",
    color: BrandColors.primary,
    route: "/(app)/posts/create",
  },
  {
    key: "reel",
    title: "Reel",
    description: "Create a short, engaging video",
    icon: "play-outline",
    color: "#DB2777",
    route: "/(app)/reels/create",
  },
  {
    key: "property",
    title: "Property",
    description: "List a home, apartment, or rental",
    icon: "business-outline",
    color: "#2563EB",
  },
  {
    key: "vehicle",
    title: "Vehicle",
    description: "Offer a car or other vehicle",
    icon: "car-outline",
    color: "#0891B2",
  },
  {
    key: "spare-bag",
    title: "Spare Bag",
    description: "Offer luggage space or request transport",
    icon: "bag-outline",
    color: "#7C3AED",
  },
  {
    key: "service-request",
    title: "Service Request",
    description: "Find someone for a service you need",
    icon: "construct-outline",
    color: "#EA580C",
  },
  {
    key: "event",
    title: "Event",
    description: "Bring your community together",
    icon: "calendar-outline",
    color: "#D97706",
  },
  {
    key: "job",
    title: "Job",
    description: "Share a new work opportunity",
    icon: "briefcase-outline",
    color: "#16A34A",
  },
  {
    key: "community-help",
    title: "Community Help & Offers",
    description: "Request help or offer support",
    icon: "heart-outline",
    color: "#0F766E",
    route: "/(app)/posts/create?mode=help",
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function CreateSheet({ visible, onClose }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [translateY] = useState(
    () => new Animated.Value(Dimensions.get("window").height),
  );
  const [opacity] = useState(() => new Animated.Value(0));
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(Dimensions.get("window").height);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, translateY, opacity]);

  function close(afterClose?: () => void) {
    if (closing) return;
    setClosing(true);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: Dimensions.get("window").height,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setClosing(false);
      onClose();
      afterClose?.();
    });
  }

  function select(option: CreateOption) {
    if (!option.route) return;
    close(() => router.push(option.route as never));
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => close()}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={() => close()}
          accessibilityRole="button"
          accessibilityLabel="Close create menu"
        />
        <Animated.View
          style={[
            styles.panel,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
              paddingBottom: Spacing.four + insets.bottom,
              opacity,
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <ThemedText style={styles.title}>Create something</ThemedText>
              <ThemedText style={styles.subtitle} themeColor="textSecondary">
                What would you like to share?
              </ThemedText>
            </View>
            <Pressable
              onPress={() => close()}
              hitSlop={8}
              style={[
                styles.closeButton,
                { backgroundColor: theme.backgroundElement },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close create menu"
            >
              <Ionicons name="close" size={20} color={theme.textSecondary} />
            </Pressable>
          </View>

          <Pressable
            onPress={() => close(() => router.push("/(app)/business" as never))}
            accessibilityRole="button"
            accessibilityLabel="Go to Business Workspace"
            style={({ pressed }) => [
              styles.workspaceLink,
              {
                backgroundColor: theme.primarySurface,
                borderColor: theme.border,
              },
              pressed && styles.optionPressed,
            ]}
          >
            <View
              style={[
                styles.workspaceIcon,
                { backgroundColor: `${theme.primary}18` },
              ]}
            >
              <Ionicons name="briefcase-outline" size={17} color={theme.primary} />
            </View>
            <ThemedText style={styles.workspaceLinkText}>
              Business Workspace
            </ThemedText>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={theme.primary}
            />
          </Pressable>

          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.grid}
          >
            {OPTIONS.map((option) => {
              const available = Boolean(option.route);
              return (
                <Pressable
                  key={option.key}
                  disabled={!available}
                  onPress={() => select(option)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    available
                      ? `Create ${option.title.toLowerCase()}`
                      : `${option.title}, coming soon`
                  }
                  accessibilityState={{ disabled: !available }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor:
                        available && pressed ? option.color : theme.border,
                    },
                    pressed && styles.optionPressed,
                    !available && styles.optionDisabled,
                  ]}
                >
                  <View
                    style={[
                      styles.iconWrap,
                      { backgroundColor: `${option.color}18` },
                    ]}
                  >
                    <Ionicons
                      name={option.icon}
                      size={25}
                      color={option.color}
                    />
                  </View>
                  {!available && (
                    <View
                      style={[
                        styles.soonBadge,
                        { backgroundColor: theme.backgroundSelected },
                      ]}
                    >
                      <ThemedText
                        style={styles.soonText}
                        themeColor="textSecondary"
                      >
                        Soon
                      </ThemedText>
                    </View>
                  )}
                  <ThemedText style={styles.optionTitle}>
                    {option.title}
                  </ThemedText>
                  <ThemedText
                    style={styles.optionDescription}
                    themeColor="textSecondary"
                  >
                    {option.description}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(15, 14, 23, 0.52)",
  },
  panel: {
    maxHeight: "88%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: 10,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 18,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: BorderRadius.full,
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
  },
  headerText: { flex: 1 },
  title: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 2 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: Spacing.three,
  },
  workspaceLink: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  workspaceIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.two + Spacing.half,
  },
  workspaceLinkText: { flex: 1, fontSize: 14, lineHeight: 18, fontWeight: "700" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: Spacing.three,
    paddingBottom: Spacing.one,
  },
  option: {
    width: "47%",
    minHeight: 144,
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
  },
  optionPressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  optionDisabled: { opacity: 0.58 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.three,
  },
  soonBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  soonText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  optionTitle: { fontSize: 16, lineHeight: 20, fontWeight: "700" },
  optionDescription: { fontSize: 12, lineHeight: 17, marginTop: 4 },
});
