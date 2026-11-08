import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { ErrorState } from "@/shared/components/error-state";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { createSpareBagApi } from "../services/spare-bag-api";
import type { Listing, ListingRequest, ListingType } from "../types/spare-bag-types";
import { ListingForm } from "../components/listing-form";
import { ScreenHeader } from "../components/spare-bag-ui";

export default function ListingEditorScreen({ listingType }: { listingType?: ListingType }) {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = useMemo(() => createSpareBagApi(apiClient), [apiClient]);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.detail(id)
      .then(setListing)
      .catch((cause) => setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not load the listing."))
      .finally(() => setLoading(false));
  }, [api, id]);

  async function submit(request: ListingRequest, publish = false): Promise<Listing> {
    let saved = id ? await api.update(id, request) : await api.create(request);
    if (publish) saved = await api.publish(saved.id);
    router.replace(`/(app)/spare-bag/${saved.id}` as never);
    return saved;
  }

  const type = listing?.listingType ?? listingType;
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        <ScreenHeader
          back
          title={id ? "Edit Spare Bag listing" : type === "SENDER_REQUEST" ? "Send a Parcel" : "I Have Free Space"}
        />
        {loading ? <LoadingScreen /> : error ? <ErrorState message={error} onRetry={() => router.replace(`/(app)/spare-bag/edit/${id}` as never)} /> : type ? (
          <ListingForm listingType={type} listing={listing ?? undefined} onSubmit={submit} />
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
