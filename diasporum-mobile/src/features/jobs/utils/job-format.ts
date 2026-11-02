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
  const currency = job.salaryCurrency ?? "";
  const min = job.salaryMin === null ? null : Number(job.salaryMin);
  const max = job.salaryMax === null ? null : Number(job.salaryMax);
  const amount = (value: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  if (min !== null && max !== null)
    return `${currency} ${amount(min)}–${amount(max)}`.trim();
  if (min !== null) return `${currency} ${amount(min)}+`.trim();
  return `Up to ${currency} ${amount(max as number)}`.trim();
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
