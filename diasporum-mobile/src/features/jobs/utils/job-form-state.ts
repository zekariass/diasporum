import type {
  ApplicationMethod,
  CreateJobRequest,
  EmploymentType,
  JobDetail,
  JobSourceType,
  MediaUploadSelection,
  UpdateJobRequest,
  VisibilityScope,
  WorkHoursType,
  WorkSchedule,
  WorkplaceType,
} from "../types/job-types";

export const EMPLOYMENT_TYPES: EmploymentType[] = [
  "PERMANENT", "FIXED_TERM", "CONTRACT", "TEMPORARY", "CASUAL",
  "ZERO_HOURS", "SEASONAL", "APPRENTICESHIP", "INTERNSHIP", "VOLUNTEER",
  "FREELANCE", "COMMISSION", "SELF_EMPLOYED", "OTHER", "UNSPECIFIED",
];
export const WORK_HOURS_TYPES: WorkHoursType[] = [
  "FULL_TIME", "PART_TIME", "VARIABLE", "SHIFT_BASED", "FLEXIBLE", "UNSPECIFIED",
];
export const WORK_SCHEDULES: WorkSchedule[] = [
  "DAY", "NIGHT", "ROTATING", "WEEKENDS", "MIXED", "OTHER",
];
export const WORKPLACE_TYPES: WorkplaceType[] = [
  "ONSITE", "HYBRID", "REMOTE", "MULTIPLE_LOCATIONS", "FIELD_BASED",
];
export const SOURCE_TYPES: JobSourceType[] = [
  "EMPLOYER_DIRECT", "RECRUITER", "COMMUNITY_SHARED", "COMMUNITY_ORGANIZATION",
];
export const MANAGER_ROLES = new Set([
  "OWNER", "ADMINISTRATOR", "EDITOR", "LISTING_MANAGER",
]);

export interface JobFormState {
  communityId: string;
  visibilityScope: VisibilityScope;
  categoryIds: string[];
  businessAccountId: string | null;
  employerName: string;
  title: string;
  description: string;
  employmentType: EmploymentType;
  workHoursType: WorkHoursType;
  workSchedule: WorkSchedule | null;
  workplaceType: WorkplaceType;
  city: string;
  region: string;
  formattedAddress: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  applicationMethod: ApplicationMethod;
  applicationUrl: string;
  deadline: string;
  sourceType: JobSourceType;
  sourceName: string;
  sourceUrl: string;
  mediaIds: string[];
  image: MediaUploadSelection | null;
}

export function initialJobFormState(activeCommunityId = ""): JobFormState {
  return {
    communityId: activeCommunityId,
    visibilityScope: "COMMUNITY",
    categoryIds: [],
    businessAccountId: null,
    employerName: "",
    title: "",
    description: "",
    employmentType: "PERMANENT",
    workHoursType: "FULL_TIME",
    workSchedule: "DAY",
    workplaceType: "ONSITE",
    city: "",
    region: "",
    formattedAddress: "",
    salaryMin: "",
    salaryMax: "",
    salaryCurrency: "EUR",
    applicationMethod: "INTERNAL",
    applicationUrl: "",
    deadline: "",
    sourceType: "EMPLOYER_DIRECT",
    sourceName: "",
    sourceUrl: "",
    mediaIds: [],
    image: null,
  };
}

export function jobFormStateFromDetail(detail: JobDetail): JobFormState {
  const job = detail.job;
  return {
    ...initialJobFormState(job.communityId ?? ""),
    visibilityScope: job.visibilityScope,
    categoryIds: detail.categories.map((category) => category.id),
    businessAccountId: job.businessAccountId,
    employerName: job.employerName,
    title: job.title,
    description: job.description,
    employmentType: job.employmentType,
    workHoursType: job.workHoursType,
    workSchedule: job.workSchedule,
    workplaceType: job.workplaceType,
    city: detail.location?.city ?? "",
    region: detail.location?.region ?? "",
    formattedAddress: detail.location?.formattedAddress ?? "",
    salaryMin: job.salaryMin ?? "",
    salaryMax: job.salaryMax ?? "",
    salaryCurrency: job.salaryCurrency ?? "EUR",
    applicationMethod: job.applicationMethod,
    applicationUrl: job.applicationUrl ?? "",
    deadline: job.closesAt ? job.closesAt.slice(0, 10) : "",
    sourceType: job.sourceType,
    sourceName: job.sourceName ?? "",
    sourceUrl: job.sourceUrl ?? "",
    mediaIds: detail.mediaIds,
  };
}

function validWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function validateJobForm(
  form: JobFormState,
  publishing = true,
  now = new Date(),
): string | null {
  if (!form.communityId) return "Select an active community before posting a job.";
  if (form.categoryIds.length === 0) return "Select at least one job category.";
  if (form.categoryIds.length > 5) return "Select no more than five categories.";
  if (!form.employerName.trim()) return "Enter the employer name.";
  if (!form.title.trim()) return "Enter a job title.";
  if (!form.description.trim()) return "Enter a job description.";
  if (form.workplaceType !== "REMOTE" && !form.formattedAddress.trim() && !form.city.trim()) {
    return "Enter a public city or address, or choose Remote.";
  }
  const min = form.salaryMin.trim() ? Number(form.salaryMin) : null;
  const max = form.salaryMax.trim() ? Number(form.salaryMax) : null;
  if ((min !== null && (!Number.isFinite(min) || min < 0)) ||
      (max !== null && (!Number.isFinite(max) || max < 0))) {
    return "Salary values must be non-negative numbers.";
  }
  if (min !== null && max !== null && max < min) {
    return "Maximum salary cannot be lower than minimum salary.";
  }
  if ((min !== null || max !== null) && !/^[A-Za-z]{3}$/.test(form.salaryCurrency)) {
    return "Enter a three-letter salary currency.";
  }
  if (form.applicationMethod === "EXTERNAL" && !validWebUrl(form.applicationUrl.trim())) {
    return "Enter a valid HTTP(S) application URL without credentials or fragments.";
  }
  if (form.sourceUrl.trim() && !validWebUrl(form.sourceUrl.trim())) {
    return "Enter a valid HTTP(S) source URL without credentials or fragments.";
  }
  if (form.deadline) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.deadline)) {
      return "Deadline must use YYYY-MM-DD.";
    }
    const deadline = new Date(`${form.deadline}T23:59:59.999Z`);
    if (Number.isNaN(deadline.getTime()) || deadline.toISOString().slice(0, 10) !== form.deadline) {
      return "Enter a valid deadline.";
    }
    if (publishing && deadline.getTime() <= now.getTime()) {
      return "The application deadline must be in the future.";
    }
  }
  return null;
}

export const JOB_STEP_TITLES = [
  "Post as",
  "Job details",
  "Role & location",
  "Pay & deadline",
  "Applying & image",
  "Review",
] as const;

export const JOB_STEP_HINTS = [
  "Choose whether this job is yours or a business account's, and who can see it.",
  "The essentials applicants read first — title, employer, description and categories.",
  "How the role works and the public location applicants see. No exact coordinates.",
  "Optional pay range and the last day candidates can apply.",
  "How applications reach you, where the listing came from, and an optional image.",
  "Check everything before publishing — you can still edit afterwards.",
] as const;

/** Validates only the fields owned by one wizard step — submission still runs validateJobForm. */
export function validateJobStep(form: JobFormState, step: number): string | null {
  if (step === 0) {
    return form.communityId ? null : "Select an active community before posting a job.";
  }
  if (step === 1) {
    if (!form.employerName.trim()) return "Enter the employer name.";
    if (!form.title.trim()) return "Enter a job title.";
    if (!form.description.trim()) return "Enter a job description.";
    if (form.categoryIds.length === 0) return "Select at least one job category.";
    if (form.categoryIds.length > 5) return "Select no more than five categories.";
    return null;
  }
  if (step === 2) {
    if (form.workplaceType !== "REMOTE" && !form.formattedAddress.trim() && !form.city.trim()) {
      return "Enter a public city or address, or choose Remote.";
    }
    return null;
  }
  if (step === 3) {
    const min = form.salaryMin.trim() ? Number(form.salaryMin) : null;
    const max = form.salaryMax.trim() ? Number(form.salaryMax) : null;
    if ((min !== null && (!Number.isFinite(min) || min < 0)) ||
        (max !== null && (!Number.isFinite(max) || max < 0))) {
      return "Salary values must be non-negative numbers.";
    }
    if (min !== null && max !== null && max < min) {
      return "Maximum salary cannot be lower than minimum salary.";
    }
    if ((min !== null || max !== null) && !/^[A-Za-z]{3}$/.test(form.salaryCurrency)) {
      return "Enter a three-letter salary currency.";
    }
    if (form.deadline) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.deadline)) return "Deadline must use YYYY-MM-DD.";
      const deadline = new Date(`${form.deadline}T23:59:59.999Z`);
      if (Number.isNaN(deadline.getTime()) || deadline.toISOString().slice(0, 10) !== form.deadline) {
        return "Enter a valid deadline.";
      }
    }
    return null;
  }
  if (step === 4) {
    if (form.applicationMethod === "EXTERNAL" && !validWebUrl(form.applicationUrl.trim())) {
      return "Enter a valid HTTP(S) application URL without credentials or fragments.";
    }
    if (form.sourceUrl.trim() && !validWebUrl(form.sourceUrl.trim())) {
      return "Enter a valid HTTP(S) source URL without credentials or fragments.";
    }
    return null;
  }
  return null;
}

function optional(value: string): string | undefined {
  return value.trim() || undefined;
}

function deadline(value: string): string | undefined {
  return value ? new Date(`${value}T23:59:59.999Z`).toISOString() : undefined;
}

function salary(value: string): number | undefined {
  return value.trim() ? Number(value) : undefined;
}

export function toCreateJobRequest(
  form: JobFormState,
  draft: boolean,
  mediaIds = form.mediaIds,
): CreateJobRequest {
  return {
    communityId: form.communityId,
    visibilityScope: form.visibilityScope,
    categoryIds: form.categoryIds,
    employerName: form.employerName.trim(),
    title: form.title.trim(),
    description: form.description.trim(),
    employmentType: form.employmentType,
    workHoursType: form.workHoursType,
    ...(form.workSchedule ? { workSchedule: form.workSchedule } : {}),
    workplaceType: form.workplaceType,
    ...(form.workplaceType === "REMOTE" ? {} : {
      city: optional(form.city),
      region: optional(form.region),
      formattedAddress: optional(form.formattedAddress),
    }),
    salaryMin: salary(form.salaryMin),
    salaryMax: salary(form.salaryMax),
    salaryCurrency: salary(form.salaryMin) !== undefined || salary(form.salaryMax) !== undefined
      ? form.salaryCurrency.toUpperCase()
      : undefined,
    applicationMethod: form.applicationMethod,
    applicationUrl: form.applicationMethod === "EXTERNAL"
      ? form.applicationUrl.trim()
      : undefined,
    closesAt: deadline(form.deadline),
    businessAccountId: form.businessAccountId ?? undefined,
    sourceType: form.sourceType,
    sourceName: optional(form.sourceName),
    sourceUrl: optional(form.sourceUrl),
    mediaIds,
    draft,
  };
}

export function toUpdateJobRequest(
  form: JobFormState,
  published: boolean,
  mediaIds = form.mediaIds,
): UpdateJobRequest {
  const create = toCreateJobRequest(form, false, mediaIds);
  return {
    visibilityScope: create.visibilityScope,
    ...(published ? {} : { categoryIds: create.categoryIds }),
    employerName: create.employerName,
    title: create.title,
    description: create.description,
    employmentType: create.employmentType,
    workHoursType: create.workHoursType,
    workSchedule: create.workSchedule,
    clearWorkSchedule: !form.workSchedule,
    workplaceType: create.workplaceType,
    city: create.city,
    region: create.region,
    formattedAddress: create.formattedAddress,
    clearLocation: form.workplaceType === "REMOTE",
    salaryMin: create.salaryMin,
    salaryMax: create.salaryMax,
    salaryCurrency: create.salaryCurrency,
    clearSalary: create.salaryMin === undefined && create.salaryMax === undefined,
    applicationMethod: create.applicationMethod,
    applicationUrl: create.applicationUrl,
    closesAt: create.closesAt,
    clearDeadline: !form.deadline,
    sourceType: create.sourceType,
    sourceName: create.sourceName,
    sourceUrl: create.sourceUrl,
    mediaIds,
  };
}
