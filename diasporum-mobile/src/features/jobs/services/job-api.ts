import type { ApiClient } from "@/core/api/api-client";
import { uploadMedia } from "@/shared/services/media-upload";
import type {
  ApplicationPage,
  ApplicationStatus,
  ApplyJobRequest,
  CreateJobRequest,
  JobApplication,
  JobCategory,
  JobDetail,
  JobDiscoveryFilters,
  JobPage,
  MediaUploadSelection,
  UpdateJobRequest,
} from "../types/job-types";

type QueryValue = string | number | undefined;

function query(params: [string, QueryValue][]): string {
  const value = params
    .filter(([, item]) => item !== undefined && item !== "")
    .map(([key, item]) => `${key}=${encodeURIComponent(String(item))}`)
    .join("&");
  return value ? `?${value}` : "";
}

export function createJobApi(client: ApiClient) {
  return {
    categories: (countryId?: string) =>
      client.get<{ items: JobCategory[] }>(
        `/api/v1/jobs/categories${query([["countryId", countryId]])}`,
        { authenticated: true },
      ),

    create: (request: CreateJobRequest) =>
      client.post<JobDetail>("/api/v1/jobs", request, { authenticated: true }),

    detail: (jobId: string) =>
      client.get<JobDetail>(`/api/v1/jobs/${jobId}`, { authenticated: true }),

    update: (jobId: string, request: UpdateJobRequest) =>
      client.patch<JobDetail>(`/api/v1/jobs/${jobId}`, request, {
        authenticated: true,
      }),

    publish: (jobId: string) =>
      client.post<JobDetail>(`/api/v1/jobs/${jobId}/publish`, undefined, {
        authenticated: true,
      }),

    close: (jobId: string) =>
      client.post<JobDetail>(`/api/v1/jobs/${jobId}/close`, undefined, {
        authenticated: true,
      }),

    remove: (jobId: string) =>
      client.delete(`/api/v1/jobs/${jobId}`, { authenticated: true }),

    discover: (
      filters: JobDiscoveryFilters = {},
      cursor?: string,
      size = 20,
    ) =>
      client.get<JobPage>(
        `/api/v1/jobs${query([
          ["communityId", filters.communityId],
          ["scope", filters.scope],
          ["categoryId", filters.categoryId],
          ["employmentType", filters.employmentType],
          ["workplaceType", filters.workplaceType],
          ["city", filters.city],
          ["salaryMin", filters.salaryMin],
          ["salaryMax", filters.salaryMax],
          ["publishedFrom", filters.publishedFrom],
          ["publishedTo", filters.publishedTo],
          ["search", filters.search],
          ["sort", filters.sort],
          ["cursor", cursor],
          ["size", size],
        ])}`,
        { authenticated: true },
      ),

    myJobs: (cursor?: string, size = 20) =>
      client.get<JobPage>(
        `/api/v1/me/jobs${query([["cursor", cursor], ["size", size]])}`,
        { authenticated: true },
      ),

    savedJobs: (cursor?: string, size = 20) =>
      client.get<JobPage>(
        `/api/v1/me/jobs/saved${query([["cursor", cursor], ["size", size]])}`,
        { authenticated: true },
      ),

    save: (jobId: string) =>
      client.put(`/api/v1/jobs/${jobId}/save`, {}, { authenticated: true }),

    unsave: (jobId: string) =>
      client.delete(`/api/v1/jobs/${jobId}/save`, { authenticated: true }),

    report: (jobId: string, reason: string, details?: string) =>
      client.post<{ id: string }>(
        `/api/v1/jobs/${jobId}/report`,
        { reason, ...(details ? { details } : {}) },
        { authenticated: true },
      ),

    mediaDownloadUrl: (jobId: string, mediaId: string) =>
      client.get<{ downloadUrl: string }>(
        `/api/v1/jobs/${jobId}/media/${mediaId}/download-url`,
        { authenticated: true },
      ),

    apply: (jobId: string, request: ApplyJobRequest = {}) =>
      client.post<JobApplication>(
        `/api/v1/jobs/${jobId}/applications`,
        request,
        { authenticated: true },
      ),

    jobApplications: (
      jobId: string,
      status?: ApplicationStatus,
      cursor?: string,
      size = 20,
    ) =>
      client.get<ApplicationPage>(
        `/api/v1/jobs/${jobId}/applications${query([
          ["status", status],
          ["cursor", cursor],
          ["size", size],
        ])}`,
        { authenticated: true },
      ),

    myApplications: (cursor?: string, size = 20) =>
      client.get<ApplicationPage>(
        `/api/v1/me/job-applications${query([
          ["cursor", cursor],
          ["size", size],
        ])}`,
        { authenticated: true },
      ),

    application: (applicationId: string) =>
      client.get<JobApplication>(`/api/v1/job-applications/${applicationId}`, {
        authenticated: true,
      }),

    updateApplicationStatus: (
      applicationId: string,
      status: Exclude<ApplicationStatus, "SUBMITTED" | "WITHDRAWN">,
    ) =>
      client.patch<JobApplication>(
        `/api/v1/job-applications/${applicationId}`,
        { status },
        { authenticated: true },
      ),

    withdraw: (applicationId: string) =>
      client.post<JobApplication>(
        `/api/v1/job-applications/${applicationId}/withdraw`,
        undefined,
        { authenticated: true },
      ),

    resumeDownloadUrl: (applicationId: string) =>
      client.get<{ downloadUrl: string }>(
        `/api/v1/job-applications/${applicationId}/resume/download-url`,
        { authenticated: true },
      ),
  };
}

export type JobApi = ReturnType<typeof createJobApi>;

/** Uploads a selected image or résumé through the existing media lifecycle. */
export async function uploadJobMedia(
  client: ApiClient,
  selection: MediaUploadSelection,
  purpose: "JOB" | "DOCUMENT",
): Promise<string> {
  return uploadMedia(client, selection, purpose);
}
