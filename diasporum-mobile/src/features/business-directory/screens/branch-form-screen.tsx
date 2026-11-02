import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ApiError } from "@/core/api/api-error";
import { useSession } from "@/core/session/session-provider";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { PrimaryButton } from "@/shared/components/primary-button";
import { BorderRadius, Spacing } from "@/shared/theme/spacing";
import { useTheme } from "@/hooks/use-theme";
import {
  DirectoryChip,
  DirectoryField,
  DirectoryHeader,
  DirectoryInput,
  DirectoryMessage,
} from "../components/directory-ui";
import { createDirectoryApi } from "../services/directory-api";
import type { OpeningHour } from "../types/directory-types";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

interface HourState {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  closed: boolean;
}

interface BranchFormState {
  locationName: string;
  phone: string;
  timezone: string;
  primary: boolean;
  active: boolean;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  formattedAddress: string;
  latitude: string;
  longitude: string;
  clearCoordinates: boolean;
  hours: HourState[];
}

function defaultHours(): HourState[] {
  return DAYS.map((_, index) => ({
    dayOfWeek: index + 1,
    openTime: "09:00",
    closeTime: "17:00",
    closed: index >= 5,
  }));
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

export function validateBranchForm(
  state: Pick<
    BranchFormState,
    | "addressLine1"
    | "city"
    | "formattedAddress"
    | "latitude"
    | "longitude"
    | "clearCoordinates"
    | "timezone"
    | "hours"
  >,
  creating: boolean,
): string | null {
  if (
    creating &&
    !state.addressLine1.trim() &&
    !state.city.trim() &&
    !state.formattedAddress.trim()
  ) {
    return "Enter an address line, city, or formatted public address.";
  }
  if (!validTimezone(state.timezone)) {
    return "Enter a valid IANA timezone, such as Europe/Berlin.";
  }
  const hasLatitude = state.latitude.trim().length > 0;
  const hasLongitude = state.longitude.trim().length > 0;
  if (state.clearCoordinates && (hasLatitude || hasLongitude)) {
    return "Clear the coordinate fields or turn off Clear coordinates.";
  }
  if (!state.clearCoordinates && hasLatitude !== hasLongitude) {
    return "Enter both latitude and longitude.";
  }
  if (hasLatitude && hasLongitude) {
    const lat = Number(state.latitude);
    const lon = Number(state.longitude);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      return "Enter valid discovery coordinates.";
    }
  }
  for (const hour of state.hours) {
    if (hour.closed) continue;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hour.openTime)) {
      return `${DAYS[hour.dayOfWeek - 1]} opening time must be HH:MM (24-hour).`;
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hour.closeTime)) {
      return `${DAYS[hour.dayOfWeek - 1]} closing time must be HH:MM (24-hour).`;
    }
  }
  return null;
}

export default function BranchFormScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    businessId: string;
    locationId?: string;
  }>();
  const creating = !params.locationId;
  const { apiClient } = useSession();
  const api = React.useMemo(() => createDirectoryApi(apiClient), [apiClient]);
  const [state, setState] = useState<BranchFormState>(() => ({
    locationName: "",
    phone: "",
    timezone: deviceTimezone(),
    primary: false,
    active: true,
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    postalCode: "",
    formattedAddress: "",
    latitude: "",
    longitude: "",
    clearCoordinates: false,
    hours: defaultHours(),
  }));
  const [loading, setLoading] = useState(!creating);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!params.businessId || !params.locationId) return;
    api
      .detail(params.businessId)
      .then((detail) => {
        if (!detail.business.canManage) {
          throw new Error("You cannot manage branches for this business.");
        }
        const branch = detail.locations.find(
          (item) => item.id === params.locationId,
        );
        if (!branch) throw new Error("This branch could not be found.");
        const existingHours = new Map<number, OpeningHour>(
          branch.hours.map((hour) => [hour.dayOfWeek, hour]),
        );
        setState({
          locationName: branch.locationName ?? "",
          phone: branch.phone ?? "",
          timezone: branch.timezone,
          primary: branch.primary,
          active: branch.active,
          addressLine1: branch.address.addressLine1 ?? "",
          addressLine2: branch.address.addressLine2 ?? "",
          city: branch.address.city ?? "",
          region: branch.address.region ?? "",
          postalCode: branch.address.postalCode ?? "",
          formattedAddress: branch.address.formattedAddress ?? "",
          latitude: "",
          longitude: "",
          clearCoordinates: false,
          hours: defaultHours().map((fallback) => {
            const hour = existingHours.get(fallback.dayOfWeek);
            return hour
              ? {
                  dayOfWeek: hour.dayOfWeek,
                  openTime: hour.openTime?.slice(0, 5) ?? "09:00",
                  closeTime: hour.closeTime?.slice(0, 5) ?? "17:00",
                  closed: hour.closed,
                }
              : fallback;
          }),
        });
        setError(null);
      })
      .catch((cause) =>
        setError(
          ApiError.isApiError(cause)
            ? cause.userMessage
            : cause instanceof Error
              ? cause.message
              : "Could not load this branch.",
        ),
      )
      .finally(() => setLoading(false));
  }, [api, params.businessId, params.locationId]);

  const patch = (value: Partial<BranchFormState>) =>
    setState((previous) => ({ ...previous, ...value }));

  const save = async () => {
    if (savingRef.current) return;
    const validation = validateBranchForm(state, creating);
    if (validation) {
      setError(validation);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const hasCoordinates = state.latitude.trim() && state.longitude.trim();
      const request = {
        locationName: state.locationName.trim(),
        phone: state.phone.trim(),
        primary: state.primary,
        active: state.active,
        timezone: state.timezone.trim(),
        address: {
          addressLine1: state.addressLine1.trim(),
          addressLine2: state.addressLine2.trim(),
          city: state.city.trim(),
          region: state.region.trim(),
          postalCode: state.postalCode.trim(),
          formattedAddress: state.formattedAddress.trim(),
          ...(hasCoordinates
            ? {
                latitude: Number(state.latitude),
                longitude: Number(state.longitude),
              }
            : {}),
          ...(!creating && state.clearCoordinates
            ? { clearCoordinates: true }
            : {}),
        },
      };
      const branch = creating
        ? await api.createBranch(params.businessId, request)
        : await api.updateBranch(params.businessId, params.locationId as string, request);
      await api.replaceHours(
        params.businessId,
        branch.id,
        state.hours.map((hour) => ({
          dayOfWeek: hour.dayOfWeek,
          openTime: hour.closed ? null : hour.openTime,
          closeTime: hour.closed ? null : hour.closeTime,
          closed: hour.closed,
        })),
      );
      router.back();
    } catch (cause) {
      setError(
        ApiError.isApiError(cause)
          ? cause.userMessage
          : "The branch or its opening hours could not be saved.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <ThemedView style={styles.root}>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <DirectoryHeader title={creating ? "Add branch" : "Edit branch"} />
        <ScrollView contentContainerStyle={styles.content}>
          <DirectoryField label="Branch name (optional)">
            <DirectoryInput
              label="Branch name (optional)"
              value={state.locationName}
              onChangeText={(locationName) => patch({ locationName })}
              placeholder="Main office, City centre…"
              maxLength={200}
            />
          </DirectoryField>
          <DirectoryField label="Branch phone (optional)">
            <DirectoryInput
              label="Branch phone (optional)"
              value={state.phone}
              onChangeText={(phone) => patch({ phone })}
              keyboardType="phone-pad"
              autoCapitalize="none"
              maxLength={30}
            />
          </DirectoryField>
          <DirectoryField label="Timezone (IANA)">
            <DirectoryInput
              label="Timezone (IANA)"
              value={state.timezone}
              onChangeText={(timezone) => patch({ timezone })}
              placeholder="Europe/Berlin"
              autoCapitalize="none"
              maxLength={100}
            />
          </DirectoryField>
          <View style={styles.chips}>
            <DirectoryChip
              label="Primary branch"
              active={state.primary}
              onPress={() => patch({ primary: !state.primary })}
            />
            <DirectoryChip
              label="Active"
              active={state.active}
              onPress={() => patch({ active: !state.active })}
            />
          </View>

          <ThemedText style={styles.sectionTitle}>Public address</ThemedText>
          <DirectoryInput
            label="Address line 1"
            value={state.addressLine1}
            onChangeText={(addressLine1) => patch({ addressLine1 })}
            placeholder="Street and number"
            maxLength={240}
          />
          <DirectoryInput
            label="Address line 2"
            value={state.addressLine2}
            onChangeText={(addressLine2) => patch({ addressLine2 })}
            placeholder="Apartment, suite, etc. (optional)"
            maxLength={240}
          />
          <View style={styles.row}>
            <View style={styles.rowField}>
              <DirectoryInput
                label="City"
                value={state.city}
                onChangeText={(city) => patch({ city })}
                maxLength={120}
              />
            </View>
            <View style={styles.rowField}>
              <DirectoryInput
                label="Region"
                value={state.region}
                onChangeText={(region) => patch({ region })}
                maxLength={120}
              />
            </View>
          </View>
          <DirectoryInput
            label="Postal code"
            value={state.postalCode}
            onChangeText={(postalCode) => patch({ postalCode })}
            autoCapitalize="characters"
            maxLength={40}
          />
          <DirectoryInput
            label="Formatted public address"
            value={state.formattedAddress}
            onChangeText={(formattedAddress) => patch({ formattedAddress })}
            placeholder="Address shown to directory visitors"
            maxLength={1000}
          />

          <ThemedText style={styles.sectionTitle}>Discovery coordinates</ThemedText>
          <ThemedText style={styles.hint} themeColor="textSecondary">
            {creating
              ? "Optional coordinates enable nearby search. Both fields are required when used."
              : "Leave both fields blank to keep the existing coordinates. Enter both to replace them."}
          </ThemedText>
          <View style={styles.row}>
            <View style={styles.rowField}>
              <DirectoryInput
                label="Latitude"
                value={state.latitude}
                onChangeText={(latitude) => patch({ latitude })}
                keyboardType="decimal-pad"
                autoCapitalize="none"
              />
            </View>
            <View style={styles.rowField}>
              <DirectoryInput
                label="Longitude"
                value={state.longitude}
                onChangeText={(longitude) => patch({ longitude })}
                keyboardType="decimal-pad"
                autoCapitalize="none"
              />
            </View>
          </View>
          {!creating ? (
            <DirectoryChip
              label="Clear existing coordinates"
              active={state.clearCoordinates}
              onPress={() =>
                patch({ clearCoordinates: !state.clearCoordinates })
              }
            />
          ) : null}

          <ThemedText style={styles.sectionTitle}>Weekly opening hours</ThemedText>
          <ThemedText style={styles.hint} themeColor="textSecondary">
            One opening period per weekday, interpreted in the branch timezone.
          </ThemedText>
          {state.hours.map((hour, index) => (
            <View
              key={hour.dayOfWeek}
              style={[
                styles.hourCard,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              ]}
            >
              <View style={styles.hourHeader}>
                <ThemedText style={styles.day}>{DAYS[index]}</ThemedText>
                <DirectoryChip
                  label={hour.closed ? "Closed" : "Open"}
                  active={!hour.closed}
                  onPress={() =>
                    patch({
                      hours: state.hours.map((item) =>
                        item.dayOfWeek === hour.dayOfWeek
                          ? { ...item, closed: !item.closed }
                          : item,
                      ),
                    })
                  }
                />
              </View>
              {!hour.closed ? (
                <View style={styles.row}>
                  <View style={styles.rowField}>
                    <DirectoryInput
                      label={`${DAYS[index]} opening time`}
                      value={hour.openTime}
                      onChangeText={(openTime) =>
                        patch({
                          hours: state.hours.map((item) =>
                            item.dayOfWeek === hour.dayOfWeek
                              ? { ...item, openTime }
                              : item,
                          ),
                        })
                      }
                      placeholder="09:00"
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={styles.rowField}>
                    <DirectoryInput
                      label={`${DAYS[index]} closing time`}
                      value={hour.closeTime}
                      onChangeText={(closeTime) =>
                        patch({
                          hours: state.hours.map((item) =>
                            item.dayOfWeek === hour.dayOfWeek
                              ? { ...item, closeTime }
                              : item,
                          ),
                        })
                      }
                      placeholder="17:00"
                      autoCapitalize="none"
                    />
                  </View>
                </View>
              ) : null}
            </View>
          ))}

          {error ? <DirectoryMessage error>{error}</DirectoryMessage> : null}
          <PrimaryButton
            label={creating ? "Add branch and hours" : "Save branch and hours"}
            onPress={() => void save()}
            loading={saving}
            disabled={saving}
          />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.three },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  sectionTitle: { fontSize: 18, fontWeight: "800", marginTop: Spacing.three },
  hint: { fontSize: 12, lineHeight: 18 },
  row: { flexDirection: "row", gap: Spacing.two },
  rowField: { flex: 1 },
  hourCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  hourHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  day: { fontSize: 14, fontWeight: "700" },
});
