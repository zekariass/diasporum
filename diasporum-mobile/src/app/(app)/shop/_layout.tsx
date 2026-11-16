import { Stack } from "expo-router";

/**
 * Shopping marketplace section layout — the (tabs) group provides the
 * marketplace's own bottom navigation (Home, Browse, Sell, Inbox, Profile)
 * while product, cart, checkout, order and seller screens push on top.
 */
export default function ShopLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
