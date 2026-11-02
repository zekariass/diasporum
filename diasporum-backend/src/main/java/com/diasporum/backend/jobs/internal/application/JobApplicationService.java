package com.diasporum.backend.jobs.internal.application;

import static com.diasporum.backend.jobs.internal.application.JobService.APPLICATION_STATUSES;
import static com.diasporum.backend.jobs.internal.application.JobService.bad;
import static com.diasporum.backend.jobs.internal.application.JobService.clamp;
import static com.diasporum.backend.jobs.internal.application.JobService.conflict;
import static com.diasporum.backend.jobs.internal.application.JobService.forbidden;
import static com.diasporum.backend.jobs.internal.application.JobService.notFound;
import static com.diasporum.backend.jobs.internal.application.JobService.upper;

import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.jobs.internal.application.JobService.JobRow;
import com.diasporum.backend.media.MediaApi;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Internal applications, applicant withdrawal and employer review workflow. */
@Service
public class JobApplicationService {

    private static final String COLS = "a.id,a.job_id,a.applicant_id,a.resume_media_id,"
            + "a.cover_letter,a.status::text,a.submitted_at,a.updated_at";
    private static final Set<String> ACTIVE = Set.of("SUBMITTED", "VIEWED", "SHORTLISTED");
    private static final Map<String, Set<String>> TRANSITIONS = Map.of(
            "SUBMITTED", Set.of("VIEWED", "SHORTLISTED", "REJECTED", "HIRED"),
            "VIEWED", Set.of("SHORTLISTED", "REJECTED", "HIRED"),
            "SHORTLISTED", Set.of("REJECTED", "HIRED"));

    private final JdbcTemplate jdbc;
    private final JobService jobs;
    private final IdentityApi identity;
    private final MediaApi media;

    public JobApplicationService(JdbcTemplate jdbc, JobService jobs,
            IdentityApi identity, MediaApi media) {
        this.jdbc = jdbc;
        this.jobs = jobs;
        this.identity = identity;
        this.media = media;
    }

    public record ApplicationRow(UUID id, UUID jobId, UUID applicantId,
            UUID resumeMediaId, String coverLetter, String status,
            Instant submittedAt, Instant updatedAt) {
    }

    public record ApplicationItem(ApplicationRow application, JobRow job,
            ProfileSummary applicant, boolean canManage, boolean canWithdraw) {
    }

    public record ApplicationPage(List<ApplicationItem> items, String nextCursor) {
    }

    private static ApplicationRow application(java.sql.ResultSet rs, int i)
            throws java.sql.SQLException {
        return new ApplicationRow(rs.getObject("id", UUID.class),
                rs.getObject("job_id", UUID.class), rs.getObject("applicant_id", UUID.class),
                rs.getObject("resume_media_id", UUID.class), rs.getString("cover_letter"),
                rs.getString("status"), JobService.ts(rs, "submitted_at"),
                JobService.ts(rs, "updated_at"));
    }

    @Transactional
    public ApplicationItem apply(UUID applicant, UUID jobId, String coverLetter,
            UUID resumeMediaId) {
        JobRow job = jobs.requireViewable(applicant, jobId);
        if (jobs.canManage(applicant, job)) throw conflict("CANNOT_APPLY_TO_OWN_JOB");
        if (!"PUBLISHED".equals(job.status())) throw conflict("JOB_NOT_ACCEPTING_APPLICATIONS");
        if (!"INTERNAL".equals(job.applicationMethod())) throw bad("JOB_USES_EXTERNAL_APPLICATION");
        if (coverLetter != null && coverLetter.length() > 12000) throw bad("COVER_LETTER_TOO_LONG");
        if (resumeMediaId != null && !media.validateForAttach(resumeMediaId, applicant, "DOCUMENT")) {
            throw forbidden("RESUME_NOT_ATTACHMENT_READY");
        }
        UUID id = UUID.randomUUID();
        try {
            jdbc.update("INSERT INTO job_applications(id,job_id,applicant_id,resume_media_id,"
                            + "cover_letter) VALUES(?,?,?,?,?)", id, jobId, applicant,
                    resumeMediaId, coverLetter);
        } catch (DuplicateKeyException e) {
            throw conflict("JOB_APPLICATION_DUPLICATE");
        }
        return detail(applicant, id);
    }

    public ApplicationItem detail(UUID viewer, UUID applicationId) {
        ApplicationRow application = requireApplication(applicationId);
        JobRow job = jobs.requireJob(application.jobId());
        boolean manager = jobs.canManage(viewer, job);
        if (!viewer.equals(application.applicantId()) && !manager) {
            throw notFound("JOB_APPLICATION_NOT_FOUND");
        }
        return item(viewer, application, job, manager);
    }

    public ApplicationPage myApplications(UUID viewer, String cursor, int size) {
        int limit = clamp(size);
        var args = new ArrayList<Object>();
        args.add(viewer);
        String where = " WHERE a.applicant_id=?";
        if (cursor != null) {
            var c = decode(cursor);
            where += " AND (a.submitted_at,a.id)<(?,?)";
            args.add(java.sql.Timestamp.from(c.instant()));
            args.add(c.id());
        }
        args.add(limit + 1);
        var rows = jdbc.query("SELECT " + COLS + " FROM job_applications a" + where
                + " ORDER BY a.submitted_at DESC,a.id DESC LIMIT ?",
                JobApplicationService::application, args.toArray());
        return page(viewer, rows, limit);
    }

    public ApplicationPage forJob(UUID manager, UUID jobId, String status,
            String cursor, int size) {
        JobRow job = jobs.requireManaged(manager, jobId);
        int limit = clamp(size);
        var args = new ArrayList<Object>();
        args.add(jobId);
        String where = " WHERE a.job_id=?";
        if (status != null && !status.isBlank()) {
            status = upper(status);
            if (!APPLICATION_STATUSES.contains(status)) throw bad("INVALID_APPLICATION_STATUS");
            where += " AND a.status=?::job_application_status";
            args.add(status);
        }
        if (cursor != null) {
            var c = decode(cursor);
            where += " AND (a.submitted_at,a.id)<(?,?)";
            args.add(java.sql.Timestamp.from(c.instant()));
            args.add(c.id());
        }
        args.add(limit + 1);
        var rows = jdbc.query("SELECT " + COLS + " FROM job_applications a" + where
                + " ORDER BY a.submitted_at DESC,a.id DESC LIMIT ?",
                JobApplicationService::application, args.toArray());
        return page(manager, rows, limit, job);
    }

    @Transactional
    public ApplicationItem updateStatus(UUID manager, UUID applicationId, String status) {
        status = upper(status);
        if (status == null || !Set.of("VIEWED", "SHORTLISTED", "REJECTED", "HIRED").contains(status)) {
            throw bad("INVALID_APPLICATION_STATUS");
        }
        ApplicationRow application = requireApplication(applicationId);
        JobRow job = jobs.requireManaged(manager, application.jobId());
        application = lockApplication(applicationId);
        Set<String> allowed = TRANSITIONS.getOrDefault(application.status(), Set.of());
        if (!allowed.contains(status)) throw conflict("INVALID_APPLICATION_TRANSITION");
        jdbc.update("UPDATE job_applications SET status=?::job_application_status,updated_at=now()"
                + " WHERE id=?", status, applicationId);
        return detail(manager, applicationId);
    }

    @Transactional
    public ApplicationItem withdraw(UUID applicant, UUID applicationId) {
        ApplicationRow application = requireApplication(applicationId);
        if (!applicant.equals(application.applicantId())) throw notFound("JOB_APPLICATION_NOT_FOUND");
        application = lockApplication(applicationId);
        if (!ACTIVE.contains(application.status())) throw conflict("APPLICATION_NOT_WITHDRAWABLE");
        jdbc.update("UPDATE job_applications SET status='WITHDRAWN',updated_at=now() WHERE id=?",
                applicationId);
        return detail(applicant, applicationId);
    }

    public String resumeDownloadUrl(UUID viewer, UUID applicationId) {
        ApplicationItem item = detail(viewer, applicationId);
        UUID resume = item.application().resumeMediaId();
        if (resume == null) throw notFound("RESUME_NOT_FOUND");
        return media.authorizedDownloadUrl(resume);
    }

    private ApplicationItem item(UUID viewer, ApplicationRow application, JobRow job,
            boolean manager) {
        ProfileSummary profile = identity.profileSummary(application.applicantId()).orElse(null);
        return new ApplicationItem(application, job, profile, manager,
                viewer.equals(application.applicantId()) && ACTIVE.contains(application.status()));
    }

    private ApplicationPage page(UUID viewer, List<ApplicationRow> source, int limit) {
        return page(viewer, source, limit, null);
    }

    private ApplicationPage page(UUID viewer, List<ApplicationRow> source, int limit,
            JobRow knownJob) {
        var rows = source;
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            var last = rows.get(rows.size() - 1);
            next = encode(last.submittedAt(), last.id());
        }
        Map<UUID, JobRow> jobMap = knownJob == null
                ? jobs.jobsForIds(rows.stream().map(ApplicationRow::jobId).distinct().toList())
                : Map.of(knownJob.id(), knownJob);
        var profiles = identity.profileSummaries(rows.stream().map(ApplicationRow::applicantId)
                        .collect(Collectors.toSet())).stream()
                .collect(Collectors.toMap(ProfileSummary::id, Function.identity(), (a, b) -> a));
        var manageableAccounts = jobs.manageableAccounts(viewer);
        var items = rows.stream().map(application -> {
            JobRow job = jobMap.get(application.jobId());
            boolean manager = job != null && (job.businessAccountId() == null
                    ? viewer.equals(job.employerUserId())
                    : manageableAccounts.contains(job.businessAccountId()));
            return new ApplicationItem(application, job, profiles.get(application.applicantId()),
                    manager, viewer.equals(application.applicantId()) && ACTIVE.contains(application.status()));
        }).toList();
        return new ApplicationPage(items, next);
    }

    private ApplicationRow requireApplication(UUID id) {
        return jdbc.query("SELECT " + COLS + " FROM job_applications a WHERE a.id=?",
                JobApplicationService::application, id).stream().findFirst()
                .orElseThrow(() -> notFound("JOB_APPLICATION_NOT_FOUND"));
    }

    private ApplicationRow lockApplication(UUID id) {
        return jdbc.query("SELECT " + COLS + " FROM job_applications a WHERE a.id=? FOR UPDATE",
                JobApplicationService::application, id).stream().findFirst()
                .orElseThrow(() -> notFound("JOB_APPLICATION_NOT_FOUND"));
    }

    private record CursorParts(Instant instant, UUID id) {
    }

    private static String encode(Instant instant, UUID id) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (instant + "|" + id).getBytes(StandardCharsets.UTF_8));
    }

    private static CursorParts decode(String cursor) {
        try {
            String[] parts = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8)
                    .split("\\|");
            if (parts.length != 2) throw bad("INVALID_CURSOR");
            return new CursorParts(Instant.parse(parts[0]), UUID.fromString(parts[1]));
        } catch (IllegalArgumentException | NullPointerException e) {
            throw bad("INVALID_CURSOR");
        }
    }
}
