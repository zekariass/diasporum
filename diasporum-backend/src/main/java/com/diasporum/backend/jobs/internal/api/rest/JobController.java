package com.diasporum.backend.jobs.internal.api.rest;

import com.diasporum.backend.jobs.internal.application.JobApplicationService;
import com.diasporum.backend.jobs.internal.application.JobApplicationService.ApplicationItem;
import com.diasporum.backend.jobs.internal.application.JobApplicationService.ApplicationPage;
import com.diasporum.backend.jobs.internal.application.JobService;
import com.diasporum.backend.jobs.internal.application.JobService.CreateJobCommand;
import com.diasporum.backend.jobs.internal.application.JobService.JobDetail;
import com.diasporum.backend.jobs.internal.application.JobService.JobFilters;
import com.diasporum.backend.jobs.internal.application.JobService.JobPage;
import com.diasporum.backend.jobs.internal.application.JobService.UpdateJobCommand;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Versioned Jobs API. Actor and ownership always come from the JWT/backend. */
@RestController
@RequestMapping("/api/v1")
public class JobController {

    private final JobService jobs;
    private final JobApplicationService applications;

    public JobController(JobService jobs, JobApplicationService applications) {
        this.jobs = jobs;
        this.applications = applications;
    }

    public record CreateJobRequest(@NotNull UUID communityId, String visibilityScope,
            @NotEmpty @Size(max = 5) List<UUID> categoryIds,
            @NotBlank @Size(max = 180) String employerName,
            @NotBlank @Size(max = 220) String title,
            @NotBlank @Size(max = 20000) String description,
            String employmentType, String workHoursType, String workSchedule,
            String workplaceType, @Size(max = 120) String city,
            @Size(max = 120) String region, @Size(max = 1000) String formattedAddress,
            @DecimalMin("0.0") BigDecimal salaryMin, @DecimalMin("0.0") BigDecimal salaryMax,
            @Size(min = 3, max = 3) String salaryCurrency, String applicationMethod,
            @Size(max = 2000) String applicationUrl, Instant closesAt,
            UUID businessAccountId, String sourceType, @Size(max = 180) String sourceName,
            @Size(max = 2000) String sourceUrl, @Size(max = 5) List<UUID> mediaIds,
            Boolean draft) {
    }

    public record UpdateJobRequest(String visibilityScope, @Size(max = 5) List<UUID> categoryIds,
            @Size(max = 180) String employerName, @Size(max = 220) String title,
            @Size(max = 20000) String description, String employmentType,
            String workHoursType, String workSchedule, Boolean clearWorkSchedule,
            String workplaceType, @Size(max = 120) String city,
            @Size(max = 120) String region, @Size(max = 1000) String formattedAddress,
            Boolean clearLocation, @DecimalMin("0.0") BigDecimal salaryMin,
            @DecimalMin("0.0") BigDecimal salaryMax, @Size(min = 3, max = 3) String salaryCurrency,
            Boolean clearSalary, String applicationMethod, @Size(max = 2000) String applicationUrl,
            Instant closesAt, Boolean clearDeadline, String sourceType,
            @Size(max = 180) String sourceName, @Size(max = 2000) String sourceUrl,
            @Size(max = 5) List<UUID> mediaIds) {
    }

    public record ApplyRequest(@Size(max = 12000) String coverLetter, UUID resumeMediaId) {
    }

    public record StatusRequest(@NotBlank String status) {
    }

    public record ReportRequest(@NotBlank String reason, @Size(max = 4000) String details) {
    }

    @GetMapping("/jobs/categories")
    public Map<String, Object> categories(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID countryId) {
        principal.userId();
        return Map.of("items", jobs.categories(countryId));
    }

    @PostMapping("/jobs")
    public ResponseEntity<JobDetail> create(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody CreateJobRequest r) {
        var command = new CreateJobCommand(r.communityId(), r.visibilityScope(), r.categoryIds(),
                r.employerName(), r.title(), r.description(), r.employmentType(), r.workHoursType(),
                r.workSchedule(), r.workplaceType(), r.city(), r.region(), r.formattedAddress(),
                r.salaryMin(), r.salaryMax(), r.salaryCurrency(), r.applicationMethod(),
                r.applicationUrl(), r.closesAt(), r.businessAccountId(), r.sourceType(),
                r.sourceName(), r.sourceUrl(), r.mediaIds(), Boolean.TRUE.equals(r.draft()));
        return ResponseEntity.status(HttpStatus.CREATED).body(jobs.create(principal.userId(), command));
    }

    @GetMapping("/jobs")
    public JobPage discover(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID communityId,
            @RequestParam(required = false) String scope,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) String employmentType,
            @RequestParam(required = false) String workplaceType,
            @RequestParam(required = false) String city,
            @RequestParam(required = false) BigDecimal salaryMin,
            @RequestParam(required = false) BigDecimal salaryMax,
            @RequestParam(required = false) Instant publishedFrom,
            @RequestParam(required = false) Instant publishedTo,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return jobs.discover(principal.userId(), new JobFilters(communityId, scope, categoryId,
                employmentType, workplaceType, city, salaryMin, salaryMax, publishedFrom,
                publishedTo, search, sort), cursor, size);
    }

    @GetMapping("/jobs/{jobId}")
    public JobDetail detail(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID jobId) {
        return jobs.detail(principal.userId(), jobId);
    }

    @PatchMapping("/jobs/{jobId}")
    public JobDetail update(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID jobId, @Valid @RequestBody UpdateJobRequest r) {
        return jobs.update(principal.userId(), jobId, new UpdateJobCommand(r.visibilityScope(),
                r.categoryIds(), r.employerName(), r.title(), r.description(), r.employmentType(),
                r.workHoursType(), r.workSchedule(), Boolean.TRUE.equals(r.clearWorkSchedule()),
                r.workplaceType(), r.city(), r.region(), r.formattedAddress(),
                Boolean.TRUE.equals(r.clearLocation()), r.salaryMin(), r.salaryMax(),
                r.salaryCurrency(), Boolean.TRUE.equals(r.clearSalary()), r.applicationMethod(),
                r.applicationUrl(), r.closesAt(), Boolean.TRUE.equals(r.clearDeadline()),
                r.sourceType(), r.sourceName(), r.sourceUrl(), r.mediaIds()));
    }

    @PostMapping("/jobs/{jobId}/publish")
    public JobDetail publish(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID jobId) {
        return jobs.publish(principal.userId(), jobId);
    }

    @PostMapping("/jobs/{jobId}/close")
    public JobDetail close(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID jobId) {
        return jobs.close(principal.userId(), jobId);
    }

    @DeleteMapping("/jobs/{jobId}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID jobId) {
        jobs.delete(principal.userId(), jobId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/jobs/{jobId}/media/{mediaId}/download-url")
    public Map<String, String> mediaUrl(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID jobId, @PathVariable UUID mediaId) {
        return Map.of("downloadUrl", jobs.mediaDownloadUrl(principal.userId(), jobId, mediaId));
    }

    @PutMapping("/jobs/{jobId}/save")
    public ResponseEntity<Void> save(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID jobId) {
        jobs.save(principal.userId(), jobId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/jobs/{jobId}/save")
    public ResponseEntity<Void> unsave(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID jobId) {
        jobs.unsave(principal.userId(), jobId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me/jobs")
    public JobPage myJobs(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return jobs.myJobs(principal.userId(), cursor, size);
    }

    @GetMapping("/me/jobs/saved")
    public JobPage saved(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return jobs.savedJobs(principal.userId(), cursor, size);
    }

    @PostMapping("/jobs/{jobId}/report")
    public ResponseEntity<Map<String, Object>> report(
            @AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID jobId,
            @Valid @RequestBody ReportRequest request) {
        UUID id = jobs.report(principal.userId(), jobId, request.reason(), request.details());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id));
    }

    @PostMapping("/jobs/{jobId}/applications")
    public ResponseEntity<ApplicationItem> apply(
            @AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID jobId,
            @Valid @RequestBody(required = false) ApplyRequest request) {
        var item = applications.apply(principal.userId(), jobId,
                request == null ? null : request.coverLetter(),
                request == null ? null : request.resumeMediaId());
        return ResponseEntity.status(HttpStatus.CREATED).body(item);
    }

    @GetMapping("/jobs/{jobId}/applications")
    public ApplicationPage jobApplications(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID jobId, @RequestParam(required = false) String status,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return applications.forJob(principal.userId(), jobId, status, cursor, size);
    }

    @GetMapping("/me/job-applications")
    public ApplicationPage myApplications(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return applications.myApplications(principal.userId(), cursor, size);
    }

    @GetMapping("/job-applications/{applicationId}")
    public ApplicationItem application(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID applicationId) {
        return applications.detail(principal.userId(), applicationId);
    }

    @PatchMapping("/job-applications/{applicationId}")
    public ApplicationItem applicationStatus(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID applicationId, @Valid @RequestBody StatusRequest request) {
        return applications.updateStatus(principal.userId(), applicationId, request.status());
    }

    @PostMapping("/job-applications/{applicationId}/withdraw")
    public ApplicationItem withdraw(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID applicationId) {
        return applications.withdraw(principal.userId(), applicationId);
    }

    @GetMapping("/job-applications/{applicationId}/resume/download-url")
    public Map<String, String> resumeUrl(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID applicationId) {
        return Map.of("downloadUrl", applications.resumeDownloadUrl(principal.userId(), applicationId));
    }
}
