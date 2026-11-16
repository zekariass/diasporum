import React, { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ThemedView } from "@/components/themed-view";
import { LoadingScreen } from "@/shared/components/loading-screen";
import { ErrorState } from "@/shared/components/error-state";
import { useSession } from "@/core/session/session-provider";
import { ApiError } from "@/core/api/api-error";
import { createMessagingApi } from "@/features/messaging/services/messaging-api";

export default function ShopMessageScreen() {
  const { shopId, productId, sellerOrderId } =
    useLocalSearchParams<{ shopId?: string; productId?: string; sellerOrderId?: string }>();
  const router = useRouter();
  const { apiClient } = useSession();
  const api = useMemo(() => createMessagingApi(apiClient), [apiClient]);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    queueMicrotask(() => (async () => {
      try {
        const conversation = await api.createConversation(
          sellerOrderId
            ? { contextType: "SHOP_ORDER", contextId: sellerOrderId }
            : productId
              ? { contextType: "SHOP_PRODUCT", contextId: productId }
              : { contextType: "SHOP", contextId: shopId! },
        );
        router.replace(`/(app)/messages/${conversation.id}` as never);
      } catch (cause) {
        setError(ApiError.isApiError(cause) ? cause.userMessage : "Could not open the conversation.");
      }
    })());
  }, [api, shopId, productId, sellerOrderId, router, tries]);

  return (
    <ThemedView style={{ flex: 1 }}>
      {error ? <ErrorState message={error} onRetry={() => setTries((t) => t + 1)} /> : <LoadingScreen />}
    </ThemedView>
  );
}
