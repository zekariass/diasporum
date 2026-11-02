import { createJobApi } from "@/features/jobs/services/job-api";

const client = {
  get: jest.fn(() => Promise.resolve({})),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({})),
  patch: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({})),
};
const api = createJobApi(client as never);

beforeEach(() => jest.clearAllMocks());

describe("jobApi", () => {
  it("builds discovery filters, cursor, and bounded page size", async () => {
    await api.discover({
      scope: "COUNTRY",
      categoryId: "category 1",
      employmentType: "CONTRACT",
      workplaceType: "REMOTE",
      city: "Addis Ababa",
      salaryMin: 1000,
      salaryMax: 2000,
      publishedFrom: "2026-01-01T00:00:00Z",
      search: "nurse & midwife",
      sort: "CLOSING",
    }, "cursor/1", 10);

    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/jobs?scope=COUNTRY&categoryId=category%201&employmentType=CONTRACT&workplaceType=REMOTE&city=Addis%20Ababa&salaryMin=1000&salaryMax=2000&publishedFrom=2026-01-01T00%3A00%3A00Z&search=nurse%20%26%20midwife&sort=CLOSING&cursor=cursor%2F1&size=10",
      { authenticated: true },
    );
  });

  it("omits empty discovery filters", async () => {
    await api.discover();
    expect(client.get).toHaveBeenCalledWith("/api/v1/jobs?size=20", { authenticated: true });
  });

  it("creates and updates jobs through authenticated endpoints", async () => {
    await api.create({ communityId: "community-1", categoryIds: ["category-1"],
      employerName: "Diasporum", title: "Engineer", description: "Build services" });
    expect(client.post).toHaveBeenCalledWith("/api/v1/jobs", expect.objectContaining({
      communityId: "community-1", title: "Engineer",
    }), { authenticated: true });

    await api.update("job-1", { title: "Senior engineer", mediaIds: ["media-1"] });
    expect(client.patch).toHaveBeenCalledWith("/api/v1/jobs/job-1", {
      title: "Senior engineer", mediaIds: ["media-1"],
    }, { authenticated: true });
  });

  it("supports lifecycle, detail, categories, deletion, and media URLs", async () => {
    await api.categories("country-1");
    await api.detail("job-1");
    await api.publish("job-1");
    await api.close("job-1");
    await api.remove("job-1");
    await api.mediaDownloadUrl("job-1", "media-1");

    expect(client.get).toHaveBeenCalledWith("/api/v1/jobs/categories?countryId=country-1", { authenticated: true });
    expect(client.get).toHaveBeenCalledWith("/api/v1/jobs/job-1", { authenticated: true });
    expect(client.post).toHaveBeenCalledWith("/api/v1/jobs/job-1/publish", undefined, { authenticated: true });
    expect(client.post).toHaveBeenCalledWith("/api/v1/jobs/job-1/close", undefined, { authenticated: true });
    expect(client.delete).toHaveBeenCalledWith("/api/v1/jobs/job-1", { authenticated: true });
    expect(client.get).toHaveBeenCalledWith("/api/v1/jobs/job-1/media/media-1/download-url", { authenticated: true });
  });

  it("lists owned and saved jobs and saves idempotently", async () => {
    await api.myJobs("mine", 5);
    await api.savedJobs("saved", 6);
    await api.save("job-1");
    await api.unsave("job-1");

    expect(client.get).toHaveBeenCalledWith("/api/v1/me/jobs?cursor=mine&size=5", { authenticated: true });
    expect(client.get).toHaveBeenCalledWith("/api/v1/me/jobs/saved?cursor=saved&size=6", { authenticated: true });
    expect(client.put).toHaveBeenCalledWith("/api/v1/jobs/job-1/save", {}, { authenticated: true });
    expect(client.delete).toHaveBeenCalledWith("/api/v1/jobs/job-1/save", { authenticated: true });
  });

  it("reports jobs with reason and optional details", async () => {
    await api.report("job-1", "SCAM", "Requested payment");
    expect(client.post).toHaveBeenCalledWith("/api/v1/jobs/job-1/report", {
      reason: "SCAM", details: "Requested payment",
    }, { authenticated: true });
  });

  it("submits internal applications and lists both application collections", async () => {
    await api.apply("job-1", { coverLetter: "Hello", resumeMediaId: "resume-1" });
    await api.jobApplications("job-1", "SHORTLISTED", "employer", 8);
    await api.myApplications("mine", 9);

    expect(client.post).toHaveBeenCalledWith("/api/v1/jobs/job-1/applications", {
      coverLetter: "Hello", resumeMediaId: "resume-1",
    }, { authenticated: true });
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/jobs/job-1/applications?status=SHORTLISTED&cursor=employer&size=8",
      { authenticated: true },
    );
    expect(client.get).toHaveBeenCalledWith("/api/v1/me/job-applications?cursor=mine&size=9", { authenticated: true });
  });

  it("reads, advances, withdraws, and authorizes résumé downloads", async () => {
    await api.application("application-1");
    await api.updateApplicationStatus("application-1", "VIEWED");
    await api.withdraw("application-1");
    await api.resumeDownloadUrl("application-1");

    expect(client.get).toHaveBeenCalledWith("/api/v1/job-applications/application-1", { authenticated: true });
    expect(client.patch).toHaveBeenCalledWith("/api/v1/job-applications/application-1", {
      status: "VIEWED",
    }, { authenticated: true });
    expect(client.post).toHaveBeenCalledWith("/api/v1/job-applications/application-1/withdraw", undefined, { authenticated: true });
    expect(client.get).toHaveBeenCalledWith(
      "/api/v1/job-applications/application-1/resume/download-url", { authenticated: true },
    );
  });
});
