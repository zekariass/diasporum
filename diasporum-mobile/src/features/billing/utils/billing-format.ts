import type { BillingOption, SubscriptionView } from "../types/billing-types";

export const RENEWAL_WINDOW_DAYS = 14;

export function formatAmount(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

/** "1 month", "3 months", "1 year" — derived from the server's interval + count. */
export function formatInterval(interval: string, count: number): string {
  const unit = interval.toLowerCase();
  return count === 1 ? `1 ${unit}` : `${count} ${unit}s`;
}

export function arrangementLabel(arrangement: string): string {
  if (arrangement === "PREPAID") return "Prepaid term";
  if (arrangement === "RECURRING") return "Auto-renewing";
  return titleCase(arrangement.replace(/_/g, " "));
}

export function optionPriceLabel(o: BillingOption): string {
  return `${formatAmount(o.amount, o.currencyCode)} / ${formatInterval(o.billingInterval, o.intervalCount)}`;
}

export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function isNearExpiry(
  periodEnd: string | null | undefined,
  now: Date = new Date(),
  windowDays: number = RENEWAL_WINDOW_DAYS,
): boolean {
  if (!periodEnd) return false;
  const end = new Date(periodEnd).getTime();
  if (Number.isNaN(end)) return false;
  return end - now.getTime() <= windowDays * 24 * 60 * 60 * 1000;
}

export function canRenew(
  sub: SubscriptionView | null,
  now: Date = new Date(),
): boolean {
  if (!sub || sub.billingArrangement !== "PREPAID") return false;
  if (sub.status === "EXPIRED") return true;
  if (sub.status !== "ACTIVE" && sub.status !== "TRIALING") return false;
  return isNearExpiry(sub.currentPeriodEnd, now);
}

export function statusLabel(status: string): string {
  return titleCase(status.replace(/_/g, " "));
}
