import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { useTheme } from "@/hooks/use-theme";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BrandColors } from "@/shared/theme/colors";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { BusinessImage } from "../components/business-image";
import {
  DirectoryChip,
  DirectoryHeader,
  DirectoryMessage,
} from "../components/directory-ui";
import {
  createDirectoryApi,
  uploadBusinessImage,
} from "../services/directory-api";
import type {
  BusinessDetail,
  BusinessMediaRole,
} from "../types/directory-types";

export default function ManageBusinessScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const { apiClient } = useSession();
  const api = React.useMemo(() => createDirectoryApi(apiClient), [apiClient]);
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const result = await api.detail(businessId);
      if (!result.business.canManage) {
        throw new Error("You do not have permission to manage this profile.");
      }
      setDetail(result);
      setError(null);
    } catch (cause) {
      setDetail(null);
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : cause instanceof Error
            ? cause.message
            : "Could not load business management.",
      );
    } finally {
      setLoading(false);
    }
  }, [api, businessId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const run = async (key: string, operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await operation();
      await load();
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : cause instanceof Error
            ? cause.message
            : "The operation could not be completed.",
      );
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const pickAndUpload = (role: BusinessMediaRole) => {
    void run(`upload-${role}`, async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Photo library access is required to choose an image.");
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: role === "LOGO" ? [1, 1] : role === "COVER" ? [16, 9] : [4, 3],
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const mimeType = (asset.mimeType ?? "image/jpeg").toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
        throw new Error("Choose a JPEG, PNG, or WebP image.");
      }
      await uploadBusinessImage(
        apiClient,
        businessId,
        {
          uri: asset.uri,
          mimeType,
          size: asset.fileSize,
        },
        role,
        detail?.media.length ?? 0,
      );
      setNotice(`${role.toLowerCase()} image uploaded.`);
    });
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete business profile?",
      "This removes the public profile from discovery. This action cannot be undone in the app.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            void run("delete", async () => {
              await api.remove(businessId);
              router.replace("/(app)/businesses/manage" as never);
            }),
        },
      ],
    );
  };

  if (loading) return <LoadingScreen />;

  if (!detail) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safeArea} edges={["top"]}>
          <DirectoryHeader title="Manage business" />
          <View style={styles.unavailable}>
            <DirectoryMessage error>
              {error ?? "This business profile is unavailable."}
            </DirectoryMessage>
            <PrimaryButton label="Try again" onPress={() => void load()} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const { business, locations, media } = detail;
  const canRequestVerification = ["UNVERIFIED", "REJECTED", "REVOKED"].includes(
    business.verificationStatus,
  );

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <DirectoryHeader title="Manage business" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.titleRow}>
            <View style={styles.titleCopy}>
              <ThemedText style={styles.title}>{business.name}</ThemedText>
              <ThemedText style={styles.subtitle} themeColor="textSecondary">
                {business.status} · {business.verificationStatus}
              </ThemedText>
            </View>
            <Pressable
              onPress={() =>
                router.push(`/(app)/businesses/${businessId}/edit` as never)
              }
              accessibilityLabel="Edit business profile"
            >
              <Ionicons name="create-outline" size={25} color={BrandColors.primary} />
            </Pressable>
          </View>

          {error ? <DirectoryMessage error>{error}</DirectoryMessage> : null}
          {notice ? <DirectoryMessage>{notice}</DirectoryMessage> : null}

          <Section title="Publication" icon="megaphone-outline">
            <ThemedText style={styles.body} themeColor="textSecondary">
              {business.status === "PUBLISHED"
                ? "This profile is visible according to its country or community audience."
                : "This draft is visible only to its managers. Add branches and media before publishing."}
            </ThemedText>
            {business.status === "DRAFT" ? (
              <PrimaryButton
                label="Publish profile"
                loading={busy === "publish"}
                onPress={() =>
                  void run("publish", async () => {
                    await api.publish(businessId);
                    setNotice("Profile published.");
                  })
                }
              />
            ) : (
              <PrimaryButton
                label="Unpublish profile"
                variant="secondary"
                loading={busy === "unpublish"}
                onPress={() =>
                  Alert.alert("Unpublish profile?", "It will leave public discovery and become a draft.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Unpublish",
                      onPress: () =>
                        void run("unpublish", async () => {
                          await api.unpublish(businessId);
                          setNotice("Profile moved back to draft.");
                        }),
                    },
                  ])
                }
              />
            )}
            <PrimaryButton
              label="View public profile"
              variant="ghost"
              onPress={() => router.push(`/(app)/businesses/${businessId}` as never)}
            />
          </Section>

          <Section title={`Branches and hours (${locations.length})`} icon="location-outline">
            {locations.map((branch) => (
              <View
                key={branch.id}
                style={[styles.branch, { borderColor: theme.border }]}
              >
                <View style={styles.branchCopy}>
                  <ThemedText style={styles.branchName}>
                    {branch.locationName || "Branch"}
                    {branch.primary ? " · Primary" : ""}
                  </ThemedText>
                  <ThemedText style={styles.body} themeColor="textSecondary">
                    {branch.address.formattedAddress ||
                      [branch.address.addressLine1, branch.address.city]
                        .filter(Boolean)
                        .join(", ") ||
                      "No public address"}
                  </ThemedText>
                  <ThemedText style={styles.body} themeColor="textSecondary">
                    {branch.active ? "Active" : "Inactive"} · {branch.timezone} · {branch.hours.length} hours rows
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() =>
                    router.push(
                      `/(app)/businesses/${businessId}/branch?locationId=${branch.id}` as never,
                    )
                  }
                  accessibilityLabel={`Edit ${branch.locationName || "branch"}`}
                >
                  <Ionicons name="create-outline" size={22} color={BrandColors.primary} />
                </Pressable>
                {branch.active ? (
                  <Pressable
                    onPress={() =>
                      Alert.alert("Deactivate branch?", "It will no longer appear to directory visitors.", [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Deactivate",
                          style: "destructive",
                          onPress: () =>
                            void run(`branch-${branch.id}`, async () => {
                              await api.deactivateBranch(businessId, branch.id);
                            }),
                        },
                      ])
                    }
                    accessibilityLabel={`Deactivate ${branch.locationName || "branch"}`}
                  >
                    <Ionicons name="trash-outline" size={21} color={BrandColors.error} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            <PrimaryButton
              label="Add branch"
              variant="secondary"
              onPress={() =>
                router.push(`/(app)/businesses/${businessId}/branch` as never)
              }
            />
          </Section>

          <Section title="Logo, cover, and gallery" icon="images-outline">
            <View style={styles.uploadRow}>
              {(["LOGO", "COVER", "GALLERY"] as const).map((role) => (
                <Pressable
                  key={role}
                  onPress={() => pickAndUpload(role)}
                  disabled={busy !== null}
                  accessibilityLabel={`Add ${role.toLowerCase()} image`}
                  style={[styles.uploadButton, { borderColor: theme.border }]}
                >
                  {busy === `upload-${role}` ? (
                    <ThemedText style={styles.uploadText}>Uploading…</ThemedText>
                  ) : (
                    <ThemedText style={styles.uploadText}>Add {role.toLowerCase()}</ThemedText>
                  )}
                </Pressable>
              ))}
            </View>
            {media.length === 0 ? (
              <DirectoryMessage>No business images have been attached.</DirectoryMessage>
            ) : null}
            {media.map((item) => (
              <View
                key={item.mediaId}
                style={[styles.mediaRow, { borderColor: theme.border }]}
              >
                <View style={styles.mediaImage}>
                  <BusinessImage
                    businessId={businessId}
                    mediaId={item.mediaId}
                    label={`${item.role.toLowerCase()} image`}
                  />
                </View>
                <View style={styles.mediaControls}>
                  <ThemedText style={styles.branchName}>
                    {item.role} · Position {item.sortOrder}
                  </ThemedText>
                  <View style={styles.chips}>
                    {(["LOGO", "COVER", "GALLERY"] as const).map((role) => (
                      <DirectoryChip
                        key={role}
                        label={role}
                        active={item.role === role}
                        onPress={() =>
                          void run(`media-${item.mediaId}`, async () => {
                            await api.updateMedia(businessId, item.mediaId, role);
                          })
                        }
                      />
                    ))}
                  </View>
                  <View style={styles.orderRow}>
                    <Pressable
                      accessibilityLabel={`Move ${item.mediaId} earlier`}
                      onPress={() =>
                        void run(`media-${item.mediaId}`, async () => {
                          await api.updateMedia(
                            businessId,
                            item.mediaId,
                            undefined,
                            Math.max(0, item.sortOrder - 1),
                          );
                        })
                      }
                    >
                      <ThemedText style={styles.actionText}>Move earlier</ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Move ${item.mediaId} later`}
                      onPress={() =>
                        void run(`media-${item.mediaId}`, async () => {
                          await api.updateMedia(
                            businessId,
                            item.mediaId,
                            undefined,
                            item.sortOrder + 1,
                          );
                        })
                      }
                    >
                      <ThemedText style={styles.actionText}>Move later</ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Remove ${item.mediaId}`}
                      onPress={() =>
                        Alert.alert("Remove image?", "The image will be detached from this business profile.", [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Remove",
                            style: "destructive",
                            onPress: () =>
                              void run(`media-${item.mediaId}`, async () => {
                                await api.detachMedia(businessId, item.mediaId);
                              }),
                          },
                        ])
                      }
                    >
                      <ThemedText style={styles.deleteText}>Remove</ThemedText>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </Section>

          <Section title={`Listings (${business.listingCount})`} icon="albums-outline">
            <ThemedText style={styles.body} themeColor="textSecondary">
              Property and vehicle listings owned by the Business Account can be published under this public profile.
            </ThemedText>
            <PrimaryButton
              label="Manage profile listings"
              variant="secondary"
              onPress={() =>
                router.push(
                  `/(app)/businesses/${businessId}/listings?profileName=${encodeURIComponent(business.name)}${business.businessAccountId ? `&accountId=${business.businessAccountId}` : ""}` as never,
                )
              }
            />
          </Section>

          <Section title="Verification" icon="shield-checkmark-outline">
            <ThemedText style={styles.verification}>{business.verificationStatus}</ThemedText>
            <ThemedText style={styles.body} themeColor="textSecondary">
              {business.verificationStatus === "VERIFIED"
                ? "Platform staff verified this business. Verification is separate from publication."
                : business.verificationStatus === "PENDING"
                  ? "Your request is waiting for platform review."
                  : "Verification is optional. Submit the profile for platform review when its public details are ready."}
            </ThemedText>
            {canRequestVerification ? (
              <PrimaryButton
                label={
                  ["REJECTED", "REVOKED"].includes(business.verificationStatus)
                    ? "Request verification again"
                    : "Request verification"
                }
                variant="secondary"
                loading={busy === "verification"}
                onPress={() =>
                  void run("verification", async () => {
                    await api.requestVerification(businessId);
                    setNotice("Verification request submitted.");
                  })
                }
              />
            ) : null}
          </Section>

          <PrimaryButton
            label="Delete business profile"
            variant="danger"
            onPress={confirmDelete}
            loading={busy === "delete"}
          />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.section,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={20} color={BrandColors.primary} />
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.four },
  unavailable: { padding: Spacing.five, gap: Spacing.four },
  titleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.three },
  titleCopy: { flex: 1 },
  title: { fontSize: 25, lineHeight: 32, fontWeight: "800" },
  subtitle: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  body: { fontSize: 13, lineHeight: 19 },
  section: {
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  sectionTitle: { flex: 1, fontSize: 17, fontWeight: "800" },
  branch: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  branchCopy: { flex: 1, gap: 3 },
  branchName: { fontSize: 14, fontWeight: "700" },
  uploadRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  uploadButton: {
    borderWidth: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  uploadText: { fontSize: 12, fontWeight: "700", textTransform: "capitalize" },
  mediaRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  mediaImage: { width: 74, height: 74, borderRadius: BorderRadius.md, overflow: "hidden" },
  mediaControls: { flex: 1, gap: Spacing.two },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  orderRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.three },
  actionText: { color: BrandColors.primary, fontSize: 11, fontWeight: "700" },
  deleteText: { color: BrandColors.error, fontSize: 11, fontWeight: "700" },
  verification: { fontSize: 18, fontWeight: "800", color: BrandColors.primary },
});
