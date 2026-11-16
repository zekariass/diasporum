/**
 * Shopping marketplace bottom tab navigator — the marketplace's own nav bar:
 * Feed (link to the app feed), Browse, Sell, Inbox (unread badge), Profile.
 * Styled like the dating section's custom bar: top-edge pill on the active
 * tab and a raised circular Sell button in the center.
 */

import { useCallback, useMemo, useState } from "react";
import { Tabs, TabList, TabSlot, TabTrigger } from "expo-router/ui";
import { useFocusEffect } from "expo-router";

import { useSession } from "@/core/session/session-provider";
import { createMessagingApi } from "@/features/messaging/services/messaging-api";
import {
  ShopLinkButton,
  ShopSellButton,
  ShopTabButton,
  useShopTabBarStyle,
} from "@/features/shop/components/shop-bottom-nav";
import { SHOP_CONTEXT_TYPES } from "@/features/shop/types/shop-types";

/** Unread count across shop-context conversations — drives the Inbox badge. */
function useShopUnread() {
  const { apiClient } = useSession();
  const api = useMemo(() => createMessagingApi(apiClient), [apiClient]);
  const [unread, setUnread] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api
        .conversations()
        .then((page) => {
          if (cancelled) return;
          setUnread(
            page.items
              .filter((c) => SHOP_CONTEXT_TYPES.has(c.contextType))
              .reduce((sum, c) => sum + c.unreadCount, 0),
          );
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [api]),
  );

  return unread;
}

export default function ShopTabsLayout() {
  const tabBarStyle = useShopTabBarStyle();
  const unread = useShopUnread();

  return (
    <Tabs>
      <TabSlot />
      <TabList style={tabBarStyle}>
        {/* Feed is a link out of the marketplace to the app's feed screen,
            not a marketplace tab — same pattern as dating's Messages button. */}
        <ShopLinkButton icon="newspaper-outline" label="Feed" href="/" />
        <TabTrigger name="browse" href="/shop/browse" asChild>
          <ShopTabButton icon="grid-outline" activeIcon="grid" label="Browse" />
        </TabTrigger>
        <TabTrigger name="sell" href="/shop/sell" asChild>
          <ShopSellButton />
        </TabTrigger>
        <TabTrigger name="inbox" href="/shop/inbox" asChild>
          <ShopTabButton
            icon="mail-outline"
            activeIcon="mail"
            label="Inbox"
            badge={unread}
          />
        </TabTrigger>
        <TabTrigger name="profile" href="/shop/profile" asChild>
          <ShopTabButton
            icon="person-outline"
            activeIcon="person"
            label="Profile"
          />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}
