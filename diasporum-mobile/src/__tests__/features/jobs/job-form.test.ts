import {
  initialJobFormState,
  toCreateJobRequest,
  toUpdateJobRequest,
  validateJobForm,
  type JobFormState,
} from "@/features/jobs/utils/job-form-state";
import { canTransitionApplication } from "@/features/jobs/utils/job-format";

jest.mock("@/global.css", () => ({}));
jest.mock("@/core/session/session-provider", () => ({
  useSession: () => ({ apiClient: {} }),
}));

const NOW = new Date("2026-11-01T12:00:00Z");

function validForm(overrides: Partial<JobFormState> = {}): JobFormState {
  return {
    ...initialJobFormState("community-1"),
    categoryIds: ["category-1"],
    employerName: "Diasporum",
    title: "Backend engineer",
    description: "Build community services",
    city: "Frankfurt",
    deadline: "2026-12-31",
    ...overrides,
  };
}

describe("job form validation", () => {
  it("accepts a complete internal job and maps its create payload", () => {
    const form = validForm({ salaryMin: "3000", salaryMax: "4500", salaryCurrency: "eur" });
    expect(validateJobForm(form, true, NOW)).toBeNull();
    expect(toCreateJobRequest(form, false)).toEqual(expect.objectContaining({
      communityId: "community-1",
      categoryIds: ["category-1"],
      applicationMethod: "INTERNAL",
      salaryMin: 3000,
      salaryMax: 4500,
      salaryCurrency: "EUR",
      closesAt: "2026-12-31T23:59:59.999Z",
      draft: false,
    }));
  });

  it("requires active community, categories, employer, title, and description", () => {
    expect(validateJobForm(validForm({ communityId: "" }), true, NOW)).toMatch(/active community/i);
    expect(validateJobForm(validForm({ categoryIds: [] }), true, NOW)).toMatch(/category/i);
    expect(validateJobForm(validForm({ employerName: " " }), true, NOW)).toMatch(/employer/i);
    expect(validateJobForm(validForm({ title: "" }), true, NOW)).toMatch(/title/i);
    expect(validateJobForm(validForm({ description: "" }), true, NOW)).toMatch(/description/i);
  });

  it("requires public location except for remote jobs", () => {
    expect(validateJobForm(validForm({ city: "", formattedAddress: "" }), true, NOW)).toMatch(/location|city/i);
    expect(validateJobForm(validForm({ city: "", workplaceType: "REMOTE" }), true, NOW)).toBeNull();
  });

  it("rejects negative and reversed salaries", () => {
    expect(validateJobForm(validForm({ salaryMin: "-1" }), true, NOW)).toMatch(/non-negative/i);
    expect(validateJobForm(validForm({ salaryMin: "5000", salaryMax: "4000" }), true, NOW)).toMatch(/maximum/i);
  });

  it("accepts only safe HTTP(S) external application URLs", () => {
    for (const applicationUrl of ["javascript:alert(1)", "ftp://example.com/apply",
      "https://user:pass@example.com/apply", "https://example.com/apply#form"]) {
      expect(validateJobForm(validForm({ applicationMethod: "EXTERNAL", applicationUrl }), true, NOW))
        .toMatch(/valid HTTP/i);
    }
    expect(validateJobForm(validForm({ applicationMethod: "EXTERNAL",
      applicationUrl: "https://example.com/apply" }), true, NOW)).toBeNull();
  });

  it("rejects malformed, impossible, and past publication deadlines", () => {
    expect(validateJobForm(validForm({ deadline: "31/12/2026" }), true, NOW)).toMatch(/YYYY-MM-DD/);
    expect(validateJobForm(validForm({ deadline: "2026-02-31" }), true, NOW)).toMatch(/valid deadline/i);
    expect(validateJobForm(validForm({ deadline: "2026-10-31" }), true, NOW)).toMatch(/future/i);
    expect(validateJobForm(validForm({ deadline: "2026-10-31" }), false, NOW)).toBeNull();
  });

  it("omits immutable categories and clears remote/salary/deployment fields on update", () => {
    const request = toUpdateJobRequest(validForm({
      workplaceType: "REMOTE",
      city: "",
      deadline: "",
    }), true, ["media-1"]);

    expect(request).not.toHaveProperty("categoryIds");
    expect(request).toEqual(expect.objectContaining({
      clearLocation: true,
      clearSalary: true,
      clearDeadline: true,
      mediaIds: ["media-1"],
    }));
  });
});

describe("application transitions", () => {
  it("allows only active employer transitions", () => {
    expect(canTransitionApplication("SUBMITTED", "VIEWED")).toBe(true);
    expect(canTransitionApplication("VIEWED", "SHORTLISTED")).toBe(true);
    expect(canTransitionApplication("SHORTLISTED", "HIRED")).toBe(true);
    expect(canTransitionApplication("VIEWED", "SUBMITTED")).toBe(false);
    expect(canTransitionApplication("WITHDRAWN", "VIEWED")).toBe(false);
    expect(canTransitionApplication("HIRED", "REJECTED")).toBe(false);
  });
});
