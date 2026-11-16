import { Redirect } from "expo-router";

/** `/shop` entry — the marketplace has no home tab of its own (the first bar
 * slot links out to the app Feed), so land on Browse. */
export default function ShopIndex() {
  return <Redirect href="/shop/browse" />;
}
