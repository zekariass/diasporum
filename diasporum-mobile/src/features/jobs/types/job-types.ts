export interface JobProfileSummary {
  id: string;
  username: string;
  displayName: string | null;
  accountStatus: string;
  profileCompleted: boolean;
  originCountryId: string | null;
  currentCountryId: string | null;
}

export type VisibilityScope = "COMMUNITY" | "COUNTRY";
export type JobStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "PUBLISHED"
  | "PAUSED"
  | "CLOSED"
  | "REJECTED"
  | "EXPIRED";
export type ApplicationMethod = "INTERNAL" | "EXTERNAL";
export type ApplicationStatus =
  | "SUBMITTED"
  | "VIEWED"
  | "SHORTLISTED"
  | "REJECTED"
  | "WITHDRAWN"
  | "HIRED";
export type EmploymentType =
  | "PERMANENT"
  | "FIXED_TERM"
  | "CONTRACT"
  | "TEMPORARY"
  | "CASUAL"
  | "ZERO_HOURS"
  | "SEASONAL"
  | "APPRENTICESHIP"
  | "INTERNSHIP"
  | "VOLUNTEER"
  | "FREELANCE"
  | "COMMISSION"
  | "SELF_EMPLOYED"
  | "OTHER"
  | "UNSPECIFIED";
export type WorkHoursType =
  | "FULL_TIME"
  | "PART_TIME"
  | "VARIABLE"
  | "SHIFT_BASED"
  | "FLEXIBLE"
  | "UNSPECIFIED";
export type WorkSchedule =
  | "DAY"
  | "NIGHT"
  | "ROTATING"
  | "WEEKENDS"
  | "MIXED"
  | "OTHER";
export type WorkplaceType =
  | "ONSITE"
  | "HYBRID"
  | "REMOTE"
  | "MULTIPLE_LOCATIONS"
  | "FIELD_BASED";
export type JobSourceType =
  | "EMPLOYER_DIRECT"
  | "RECRUITER"
  | "COMMUNITY_SHARED"
  | "COMMUNITY_ORGANIZATION";

export interface JobRow {
  id: string;
  countryId: string;
  communityId: string | null;
  visibilityScope: VisibilityScope;
  employerUserId: string | null;
  postedByUserId: string | null;
  businessAccountId: string | null;
  businessId: string | null;
  sourceType: JobSourceType;
  sourceName: string | null;
  sourceUrl: string | null;
  employerName: string;
  title: string;
  description: string;
  employmentType: EmploymentType;
  workHoursType: WorkHoursType;
  workSchedule: WorkSchedule | null;
  workplaceType: WorkplaceType;
  workplaceAddressId: string | null;
  salaryMin: string | null;
  salaryMax: string | null;
  salaryCurrency: string | null;
  applicationMethod: ApplicationMethod;
  applicationUrl: string | null;
  closesAt: string | null;
  status: JobStatus;
  verifiedEmployer: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
}

export interface JobCategory {
  id: string;
  countryId: string | null;
  parentId: string | null;
  categoryKey: string;
  categoryType: string;
  displayName: string;
  description: string | null;
  sortOrder: number;
}

export interface JobLocation {
  city: string | null;
  region: string | null;
  formattedAddress: string | null;
}

export interface JobItem {
  job: JobRow;
  categories: JobCategory[];
  location: JobLocation | null;
  mediaIds: string[];
  saved: boolean;
  canManage: boolean;
  myApplicationId: string | null;
  myApplicationStatus: ApplicationStatus | null;
}

export interface JobDetail extends JobItem {
  owner: JobProfileSummary | null;
  businessAccountName: string | null;
}

export interface JobPage {
  items: JobItem[];
  nextCursor: string | null;
}

export interface ApplicationRow {
  id: string;
  jobId: string;
  applicantId: string;
  resumeMediaId: string | null;
  coverLetter: string | null;
  status: ApplicationStatus;
  submittedAt: string;
  updatedAt: string;
}

export interface JobApplication {
  application: ApplicationRow;
  job: JobRow;
  applicant: JobProfileSummary | null;
  canManage: boolean;
  canWithdraw: boolean;
}

export interface ApplicationPage {
  items: JobApplication[];
  nextCursor: string | null;
}

export interface CreateJobRequest {
  communityId: string;
  visibilityScope?: VisibilityScope;
  categoryIds: string[];
  employerName: string;
  title: string;
  description: string;
  employmentType?: EmploymentType;
  workHoursType?: WorkHoursType;
  workSchedule?: WorkSchedule;
  workplaceType?: WorkplaceType;
  city?: string;
  region?: string;
  formattedAddress?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  applicationMethod?: ApplicationMethod;
  applicationUrl?: string;
  closesAt?: string;
  businessAccountId?: string;
  sourceType?: JobSourceType;
  sourceName?: string;
  sourceUrl?: string;
  mediaIds?: string[];
  draft?: boolean;
}

export interface UpdateJobRequest {
  visibilityScope?: VisibilityScope;
  categoryIds?: string[];
  employerName?: string;
  title?: string;
  description?: string;
  employmentType?: EmploymentType;
  workHoursType?: WorkHoursType;
  workSchedule?: WorkSchedule;
  clearWorkSchedule?: boolean;
  workplaceType?: WorkplaceType;
  city?: string;
  region?: string;
  formattedAddress?: string;
  clearLocation?: boolean;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  clearSalary?: boolean;
  applicationMethod?: ApplicationMethod;
  applicationUrl?: string;
  closesAt?: string;
  clearDeadline?: boolean;
  sourceType?: JobSourceType;
  sourceName?: string;
  sourceUrl?: string;
  mediaIds?: string[];
}

export interface JobDiscoveryFilters {
  communityId?: string;
  scope?: VisibilityScope;
  categoryId?: string;
  employmentType?: EmploymentType;
  workplaceType?: WorkplaceType;
  city?: string;
  salaryMin?: number;
  salaryMax?: number;
  publishedFrom?: string;
  publishedTo?: string;
  search?: string;
  sort?: "NEWEST" | "CLOSING";
}

export interface ApplyJobRequest {
  coverLetter?: string;
  resumeMediaId?: string;
}

export interface MediaUploadSelection {
  uri: string;
  mimeType: string;
  fileName?: string;
}
