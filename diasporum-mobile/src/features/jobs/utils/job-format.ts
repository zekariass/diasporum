import { CURRENCIES } from "@/shared/utils/currencies";
import type { JobItem, JobLocation, JobRow } from "../types/job-types";

export function label(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatLocation(
  location: JobLocation | null,
  workplace: JobRow["workplaceType"],
): string {
  if (workplace === "REMOTE") return "Remote";
  return (
    location?.formattedAddress ||
    [location?.city, location?.region].filter(Boolean).join(", ") ||
    label(workplace)
  );
}

export function formatSalary(job: JobRow): string | null {
  if (job.salaryMin === null && job.salaryMax === null) return null;
  const symbol = CURRENCIES.find((currency) => currency.code === job.salaryCurrency)?.symbol;
  const code = job.salaryCurrency ?? "";
  const amount = (value: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  const money = (value: number) =>
    symbol ? `${symbol}${amount(value)}` : `${amount(value)}${code ? ` ${code}` : ""}`;
  const min = job.salaryMin === null ? null : Number(job.salaryMin);
  const max = job.salaryMax === null ? null : Number(job.salaryMax);
  if (min !== null && max !== null) return `${money(min)}–${money(max)}`;
  if (min !== null) return `${money(min)}+`;
  return `Up to ${money(max as number)}`;
}

/** "Posted 2 hours ago" style publication timestamp for listing cards. */
export function formatPosted(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 60) return "Posted just now";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Posted ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Posted ${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `Posted ${weeks} week${weeks === 1 ? "" : "s"} ago`;
  return `Posted ${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

export function formatDeadline(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `Closes ${date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

export function jobSummary(item: JobItem): string {
  return [
    item.job.employerName,
    formatLocation(item.location, item.job.workplaceType),
    formatSalary(item.job),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function canTransitionApplication(
  current: string,
  next: string,
): boolean {
  const transitions: Record<string, string[]> = {
    SUBMITTED: ["VIEWED", "SHORTLISTED", "REJECTED", "HIRED"],
    VIEWED: ["SHORTLISTED", "REJECTED", "HIRED"],
    SHORTLISTED: ["REJECTED", "HIRED"],
  };
  return transitions[current]?.includes(next) ?? false;
}
