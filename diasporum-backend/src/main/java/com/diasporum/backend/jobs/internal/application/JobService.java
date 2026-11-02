package com.diasporum.backend.jobs.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.businessaccounts.BusinessAccountsApi.AccountMembershipView;
import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import com.diasporum.backend.taxonomy.TaxonomyApi.CommunityView;
import java.math.BigDecimal;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Jobs lifecycle, discovery, saves, media and moderation over v10.12 tables. */
@Service
public class JobService {

    static final int DEFAULT_PAGE = 20;
    static final int MAX_PAGE = 50;
    static final Set<String> VISIBILITIES = Set.of("COMMUNITY", "COUNTRY");
    static final Set<String> EMPLOYMENT_TYPES = Set.of("PERMANENT", "FIXED_TERM",
            "CONTRACT", "TEMPORARY", "CASUAL", "ZERO_HOURS", "SEASONAL",
            "APPRENTICESHIP", "INTERNSHIP", "VOLUNTEER", "FREELANCE",
            "COMMISSION", "SELF_EMPLOYED", "OTHER", "UNSPECIFIED");
    static final Set<String> WORK_HOURS = Set.of("FULL_TIME", "PART_TIME",
            "VARIABLE", "SHIFT_BASED", "FLEXIBLE", "UNSPECIFIED");
    static final Set<String> SCHEDULES = Set.of("DAY", "NIGHT", "ROTATING",
            "WEEKENDS", "MIXED", "OTHER");
    static final Set<String> WORKPLACES = Set.of("ONSITE", "HYBRID", "REMOTE",
            "MULTIPLE_LOCATIONS", "FIELD_BASED");
    static final Set<String> SOURCE_TYPES = Set.of("EMPLOYER_DIRECT", "RECRUITER",
            "COMMUNITY_SHARED", "COMMUNITY_ORGANIZATION");
    static final Set<String> REPORT_REASONS = Set.of("SPAM", "SCAM", "HARASSMENT",
            "HATE", "SEXUAL_MISCONDUCT", "MISINFORMATION", "IMPERSONATION",
            "PRIVACY", "OTHER");
    static final Set<String> APPLICATION_STATUSES = Set.of("SUBMITTED", "VIEWED",
            "SHORTLISTED", "REJECTED", "WITHDRAWN", "HIRED");

    private final JdbcTemplate jdbc;
    private final IdentityApi identity;
    private final CommunityApi community;
    private final TaxonomyApi taxonomy;
    private final MediaApi media;
    private final BusinessAccountsApi businessAccounts;

    public JobService(JdbcTemplate jdbc, IdentityApi identity,
            CommunityApi community, TaxonomyApi taxonomy, MediaApi media,
            BusinessAccountsApi businessAccounts) {
        this.jdbc = jdbc;
        this.identity = identity;
        this.community = community;
        this.taxonomy = taxonomy;
        this.media = media;
        this.businessAccounts = businessAccounts;
    }

    public record JobRow(UUID id, UUID countryId, UUID communityId,
            String visibilityScope, UUID employerUserId, UUID postedByUserId,
            UUID businessAccountId, UUID businessId, String sourceType,
            String sourceName, String sourceUrl, String employerName, String title,
            String description, String employmentType, String workHoursType,
            String workSchedule, String workplaceType, UUID workplaceAddressId,
            BigDecimal salaryMin, BigDecimal salaryMax, String salaryCurrency,
            String applicationMethod, String applicationUrl, Instant closesAt,
            String status, boolean verifiedEmployer, Instant createdAt,
            Instant updatedAt, Instant publishedAt, Instant deletedAt) {
    }

    public record JobCategory(UUID id, UUID countryId, UUID parentId,
            String categoryKey, String categoryType, String displayName,
            String description, int sortOrder) {
    }

    public record JobLocation(String city, String region, String formattedAddress) {
    }

    public record JobItem(JobRow job, List<JobCategory> categories,
            JobLocation location, List<UUID> mediaIds, boolean saved,
            boolean canManage, UUID myApplicationId, String myApplicationStatus) {
    }

    public record JobDetail(JobRow job, List<JobCategory> categories,
            JobLocation location, List<UUID> mediaIds, boolean saved,
            boolean canManage, UUID myApplicationId, String myApplicationStatus,
            ProfileSummary owner, String businessAccountName) {
    }

    public record JobPage(List<JobItem> items, String nextCursor) {
    }

    public record CreateJobCommand(UUID communityId, String visibilityScope,
            List<UUID> categoryIds, String employerName, String title,
            String description, String employmentType, String workHoursType,
            String workSchedule, String workplaceType, String city, String region,
            String formattedAddress, BigDecimal salaryMin, BigDecimal salaryMax,
            String salaryCurrency, String applicationMethod, String applicationUrl,
            Instant closesAt, UUID businessAccountId, String sourceType,
            String sourceName, String sourceUrl, List<UUID> mediaIds, boolean draft) {
    }

    public record UpdateJobCommand(String visibilityScope, List<UUID> categoryIds,
            String employerName, String title, String description,
            String employmentType, String workHoursType, String workSchedule,
            boolean clearWorkSchedule, String workplaceType, String city,
            String region, String formattedAddress, boolean clearLocation,
            BigDecimal salaryMin, BigDecimal salaryMax, String salaryCurrency,
            boolean clearSalary, String applicationMethod, String applicationUrl,
            Instant closesAt, boolean clearDeadline, String sourceType,
            String sourceName, String sourceUrl, List<UUID> mediaIds) {
    }

    public record JobFilters(UUID communityId, String scope, UUID categoryId,
            String employmentType, String workplaceType, String city,
            BigDecimal salaryMin, BigDecimal salaryMax, Instant publishedFrom,
            Instant publishedTo, String search, String sort) {
    }

    private static final String COLS = "j.id,j.country_id,j.community_id,"
            + "j.visibility_scope::text,j.employer_user_id,j.posted_by_user_id,"
            + "j.business_account_id,j.business_id,j.source_type::text,j.source_name,"
            + "j.source_url,j.employer_name,j.title,j.description,"
            + "j.employment_type::text,j.work_hours_type,j.work_schedule,"
            + "j.workplace_type,j.workplace_address_id,j.salary_min,j.salary_max,"
            + "j.salary_currency,j.application_method::text,j.application_url,"
            + "j.closes_at,j.status::text,j.is_verified_employer,j.created_at,"
            + "j.updated_at,j.published_at,j.deleted_at";

    private static JobRow job(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new JobRow(rs.getObject("id", UUID.class),
                rs.getObject("country_id", UUID.class),
                rs.getObject("community_id", UUID.class),
                rs.getString("visibility_scope"),
                rs.getObject("employer_user_id", UUID.class),
                rs.getObject("posted_by_user_id", UUID.class),
                rs.getObject("business_account_id", UUID.class),
                rs.getObject("business_id", UUID.class), rs.getString("source_type"),
                rs.getString("source_name"), rs.getString("source_url"),
                rs.getString("employer_name"), rs.getString("title"),
                rs.getString("description"), rs.getString("employment_type"),
                rs.getString("work_hours_type"), rs.getString("work_schedule"),
                rs.getString("workplace_type"),
                rs.getObject("workplace_address_id", UUID.class),
                rs.getBigDecimal("salary_min"), rs.getBigDecimal("salary_max"),
                rs.getString("salary_currency"), rs.getString("application_method"),
                rs.getString("application_url"), ts(rs, "closes_at"),
                rs.getString("status"), rs.getBoolean("is_verified_employer"),
                ts(rs, "created_at"), ts(rs, "updated_at"), ts(rs, "published_at"),
                ts(rs, "deleted_at"));
    }

    private static JobCategory category(java.sql.ResultSet rs, int i)
            throws java.sql.SQLException {
        return new JobCategory(rs.getObject("id", UUID.class),
                rs.getObject("country_id", UUID.class),
                rs.getObject("parent_id", UUID.class), rs.getString("category_key"),
                rs.getString("category_type"), rs.getString("display_name"),
                rs.getString("description"), rs.getInt("sort_order"));
    }

    static Instant ts(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        var value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    static ResponseStatusException forbidden(String code) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, code);
    }

    static ResponseStatusException conflict(String code) {
        return new ResponseStatusException(HttpStatus.CONFLICT, code);
    }

    static ResponseStatusException notFound(String code) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, code);
    }

    static int clamp(int size) {
        return size <= 0 ? DEFAULT_PAGE : Math.min(size, MAX_PAGE);
    }

    static String upper(String value) {
        return value == null ? null : value.trim().toUpperCase();
    }

    public List<JobCategory> categories(UUID countryId) {
        return jdbc.query("SELECT id,country_id,parent_id,category_key,category_type,"
                        + "display_name,description,sort_order FROM job_categories"
                        + " WHERE is_active AND (country_id IS NULL OR country_id=?)"
                        + " ORDER BY category_type,sort_order,display_name",
                JobService::category, countryId);
    }

    private List<JobCategory> requireCategories(List<UUID> ids, UUID countryId) {
        if (ids == null || ids.isEmpty() || ids.size() > 5) {
            throw bad("JOB_CATEGORIES_INVALID");
        }
        List<UUID> unique = new ArrayList<>(new LinkedHashSet<>(ids));
        if (unique.size() != ids.size()) {
            throw bad("JOB_CATEGORIES_DUPLICATE");
        }
        List<JobCategory> result = new ArrayList<>();
        for (UUID id : unique) {
            var found = jdbc.query("SELECT id,country_id,parent_id,category_key,"
                            + "category_type,display_name,description,sort_order"
                            + " FROM job_categories WHERE id=? AND is_active",
                    JobService::category, id).stream().findFirst()
                    .filter(c -> c.countryId() == null || c.countryId().equals(countryId))
                    .orElseThrow(() -> bad("INVALID_JOB_CATEGORY"));
            result.add(found);
        }
        return result;
    }

    public boolean canManage(UUID actor, JobRow job) {
        if (job.businessAccountId() == null) {
            return actor.equals(job.employerUserId());
        }
        return JobAuthorization.asActiveJobManager(businessAccounts.membership(actor,
                job.businessAccountId()).orElse(null)) != null;
    }

    public boolean canView(UUID viewer, JobRow job) {
        if (job.deletedAt() != null) {
            return false;
        }
        if (canManage(viewer, job)) {
            return true;
        }
        if (!"PUBLISHED".equals(job.status()) || expired(job)) {
            return false;
        }
        if ("COMMUNITY".equals(job.visibilityScope())) {
            return job.communityId() != null
                    && community.canAccess(viewer, job.communityId());
        }
        return identity.profileSummary(viewer).map(ProfileSummary::currentCountryId)
                .map(job.countryId()::equals).orElse(false);
    }

    private static boolean expired(JobRow job) {
        return job.closesAt() != null && !job.closesAt().isAfter(Instant.now());
    }

    JobRow requireJob(UUID id) {
        jdbc.update("UPDATE job_listings SET status='EXPIRED',updated_at=now()"
                + " WHERE id=? AND status='PUBLISHED' AND closes_at IS NOT NULL"
                + " AND closes_at<=now()", id);
        return jdbc.query("SELECT " + COLS + " FROM job_listings j WHERE j.id=?",
                JobService::job, id).stream().findFirst()
                .orElseThrow(() -> notFound("JOB_NOT_FOUND"));
    }

    Map<UUID, JobRow> jobsForIds(List<UUID> ids) {
        if (ids.isEmpty()) return Map.of();
        return jdbc.query("SELECT " + COLS + " FROM job_listings j WHERE j.id IN ("
                        + placeholders(ids.size()) + ")", JobService::job, ids.toArray())
                .stream().collect(Collectors.toMap(JobRow::id, j -> j));
    }

    JobRow requireViewable(UUID viewer, UUID id) {
        var job = requireJob(id);
        if (!canView(viewer, job)) {
            throw notFound("JOB_NOT_FOUND");
        }
        return job;
    }

    JobRow requireManaged(UUID actor, UUID id) {
        var job = requireJob(id);
        if (!canManage(actor, job)) {
            throw forbidden("NOT_JOB_MANAGER");
        }
        return job;
    }

    private JobRow requireManagedLocked(UUID actor, UUID id) {
        requireManaged(actor, id);
        var job = jdbc.query("SELECT " + COLS + " FROM job_listings j WHERE j.id=?"
                        + " FOR UPDATE", JobService::job, id).stream().findFirst()
                .orElseThrow(() -> notFound("JOB_NOT_FOUND"));
        if (!canManage(actor, job)) {
            throw forbidden("NOT_JOB_MANAGER");
        }
        return job;
    }

    @Transactional
    public JobDetail create(UUID actor, CreateJobCommand cmd) {
        if (cmd.communityId() == null || !community.isActiveMember(actor, cmd.communityId())) {
            throw forbidden("NOT_A_MEMBER");
        }
        CommunityView c = taxonomy.findCommunityById(cmd.communityId())
                .orElseThrow(() -> bad("COMMUNITY_NOT_FOUND"));
        if (!c.active() || c.destinationCountryId() == null) {
            throw bad("COMMUNITY_INACTIVE");
        }
        String scope = cmd.visibilityScope() == null ? "COMMUNITY" : upper(cmd.visibilityScope());
        String employment = cmd.employmentType() == null ? "UNSPECIFIED" : upper(cmd.employmentType());
        String hours = cmd.workHoursType() == null ? "UNSPECIFIED" : upper(cmd.workHoursType());
        String workplace = cmd.workplaceType() == null ? "ONSITE" : upper(cmd.workplaceType());
        String method = cmd.applicationMethod() == null ? "EXTERNAL" : upper(cmd.applicationMethod());
        String source = cmd.sourceType() == null ? "EMPLOYER_DIRECT" : upper(cmd.sourceType());
        String schedule = upper(cmd.workSchedule());
        validate(scope, VISIBILITIES, "INVALID_VISIBILITY");
        validate(employment, EMPLOYMENT_TYPES, "INVALID_EMPLOYMENT_TYPE");
        validate(hours, WORK_HOURS, "INVALID_WORK_HOURS");
        validate(workplace, WORKPLACES, "INVALID_WORKPLACE");
        validate(method, Set.of("INTERNAL", "EXTERNAL"), "INVALID_APPLICATION_METHOD");
        validate(source, SOURCE_TYPES, "INVALID_JOB_SOURCE");
        if (schedule != null) validate(schedule, SCHEDULES, "INVALID_WORK_SCHEDULE");
        validateText(cmd.employerName(), 180, "EMPLOYER_NAME_INVALID");
        validateText(cmd.title(), 220, "JOB_TITLE_INVALID");
        validateText(cmd.description(), 20000, "JOB_DESCRIPTION_INVALID");
        validateCompensation(cmd.salaryMin(), cmd.salaryMax(), cmd.salaryCurrency());
        validateApplication(method, cmd.applicationUrl());
        if (cmd.sourceUrl() != null && !cmd.sourceUrl().isBlank()) validateUrl(cmd.sourceUrl());
        if (cmd.sourceName() != null && cmd.sourceName().length() > 180) {
            throw bad("SOURCE_NAME_TOO_LONG");
        }
        if (cmd.closesAt() != null && !cmd.draft() && !cmd.closesAt().isAfter(Instant.now())) {
            throw bad("APPLICATION_DEADLINE_PAST");
        }
        var categories = requireCategories(cmd.categoryIds(), c.destinationCountryId());
        AccountMembershipView business = null;
        if (cmd.businessAccountId() != null) {
            business = JobAuthorization.asActiveJobManager(businessAccounts.membership(
                    actor, cmd.businessAccountId()).orElse(null));
            if (business == null) throw forbidden("BUSINESS_ROLE_REQUIRED");
        }
        UUID address = createLocation(actor, c.destinationCountryId(), cmd.city(),
                cmd.region(), cmd.formattedAddress(), workplace);
        List<UUID> mediaIds = validateMedia(cmd.mediaIds(), actor, "JOB");
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO job_listings(id,country_id,community_id,visibility_scope,"
                        + "employer_user_id,owner_user_id,posted_by_user_id,business_account_id,source_type,"
                        + "source_name,source_url,employer_name,title,description,employment_type,"
                        + "work_hours_type,work_schedule,workplace_type,workplace_address_id,"
                        + "salary_min,salary_max,salary_currency,application_method,application_url,"
                        + "closes_at,status,published_at) VALUES(?,?,?,?::visibility_scope,?,?,?,?,"
                        + "?::job_listing_source_type,?,?,?,?,?,?::job_employment_type,?,?,?,?,"
                        + "?,?,?,?::application_method,?,?,'DRAFT',NULL)",
                id, c.destinationCountryId(), cmd.communityId(), scope,
                business == null ? actor : null, business == null ? actor : null, actor,
                business == null ? null : business.accountId(), source,
                blankToNull(cmd.sourceName()), blankToNull(cmd.sourceUrl()),
                cmd.employerName().trim(), cmd.title().trim(), cmd.description().trim(),
                employment, hours, schedule, workplace, address, cmd.salaryMin(),
                cmd.salaryMax(), normalizedCurrency(cmd.salaryCurrency(), cmd.salaryMin(),
                        cmd.salaryMax()), method, blankToNull(cmd.applicationUrl()),
                cmd.closesAt() == null ? null : Timestamp.from(cmd.closesAt()));
        replaceCategories(id, categories);
        replaceMedia(id, mediaIds);
        return cmd.draft() ? detail(actor, id) : publish(actor, id);
    }

    @Transactional
    public JobDetail update(UUID actor, UUID id, UpdateJobCommand cmd) {
        JobRow old = requireManagedLocked(actor, id);
        if (old.deletedAt() != null) throw notFound("JOB_NOT_FOUND");
        if (!Set.of("DRAFT", "PUBLISHED", "PAUSED").contains(old.status())) {
            throw conflict("JOB_NOT_EDITABLE");
        }
        String scope = cmd.visibilityScope() == null ? old.visibilityScope() : upper(cmd.visibilityScope());
        String employment = cmd.employmentType() == null ? old.employmentType() : upper(cmd.employmentType());
        String hours = cmd.workHoursType() == null ? old.workHoursType() : upper(cmd.workHoursType());
        String workplace = cmd.workplaceType() == null ? old.workplaceType() : upper(cmd.workplaceType());
        String schedule = cmd.clearWorkSchedule() ? null : cmd.workSchedule() == null
                ? old.workSchedule() : upper(cmd.workSchedule());
        String method = cmd.applicationMethod() == null ? old.applicationMethod() : upper(cmd.applicationMethod());
        String source = cmd.sourceType() == null ? old.sourceType() : upper(cmd.sourceType());
        validate(scope, VISIBILITIES, "INVALID_VISIBILITY");
        validate(employment, EMPLOYMENT_TYPES, "INVALID_EMPLOYMENT_TYPE");
        validate(hours, WORK_HOURS, "INVALID_WORK_HOURS");
        validate(workplace, WORKPLACES, "INVALID_WORKPLACE");
        validate(method, Set.of("INTERNAL", "EXTERNAL"), "INVALID_APPLICATION_METHOD");
        validate(source, SOURCE_TYPES, "INVALID_JOB_SOURCE");
        if (schedule != null) validate(schedule, SCHEDULES, "INVALID_WORK_SCHEDULE");
        String employer = cmd.employerName() == null ? old.employerName() : cmd.employerName();
        String title = cmd.title() == null ? old.title() : cmd.title();
        String description = cmd.description() == null ? old.description() : cmd.description();
        validateText(employer, 180, "EMPLOYER_NAME_INVALID");
        validateText(title, 220, "JOB_TITLE_INVALID");
        validateText(description, 20000, "JOB_DESCRIPTION_INVALID");
        BigDecimal min = cmd.clearSalary() ? null : cmd.salaryMin() == null ? old.salaryMin() : cmd.salaryMin();
        BigDecimal max = cmd.clearSalary() ? null : cmd.salaryMax() == null ? old.salaryMax() : cmd.salaryMax();
        String currency = cmd.clearSalary() ? null : cmd.salaryCurrency() == null
                ? old.salaryCurrency() : cmd.salaryCurrency();
        validateCompensation(min, max, currency);
        String applicationUrl = cmd.applicationUrl() == null ? old.applicationUrl() : blankToNull(cmd.applicationUrl());
        if ("INTERNAL".equals(method)) applicationUrl = null;
        validateApplication(method, applicationUrl);
        Instant closesAt = cmd.clearDeadline() ? null : cmd.closesAt() == null ? old.closesAt() : cmd.closesAt();
        if ("PUBLISHED".equals(old.status()) && closesAt != null && !closesAt.isAfter(Instant.now())) {
            throw bad("APPLICATION_DEADLINE_PAST");
        }
        String sourceName = cmd.sourceName() == null ? old.sourceName() : blankToNull(cmd.sourceName());
        String sourceUrl = cmd.sourceUrl() == null ? old.sourceUrl() : blankToNull(cmd.sourceUrl());
        if (sourceName != null && sourceName.length() > 180) throw bad("SOURCE_NAME_TOO_LONG");
        if (sourceUrl != null) validateUrl(sourceUrl);
        UUID address = old.workplaceAddressId();
        if (cmd.clearLocation()) {
            address = null;
        } else if (cmd.city() != null || cmd.region() != null || cmd.formattedAddress() != null) {
            var oldLocation = location(old.workplaceAddressId());
            address = createLocation(actor, old.countryId(),
                    cmd.city() == null ? oldLocation.map(JobLocation::city).orElse(null) : cmd.city(),
                    cmd.region() == null ? oldLocation.map(JobLocation::region).orElse(null) : cmd.region(),
                    cmd.formattedAddress() == null ? oldLocation.map(JobLocation::formattedAddress).orElse(null)
                            : cmd.formattedAddress(), workplace);
        }
        if (address == null && !"REMOTE".equals(workplace)) {
            throw bad("JOB_LOCATION_REQUIRED");
        }
        if (cmd.categoryIds() != null) {
            if ("PUBLISHED".equals(old.status())) throw conflict("JOB_CATEGORIES_IMMUTABLE");
            requireCategories(cmd.categoryIds(), old.countryId());
        }
        List<UUID> mediaIds = cmd.mediaIds() == null ? null : validateMedia(cmd.mediaIds(), actor, "JOB");
        jdbc.update("UPDATE job_listings SET visibility_scope=?::visibility_scope,employer_name=?,"
                        + "title=?,description=?,employment_type=?::job_employment_type,work_hours_type=?,"
                        + "work_schedule=?,workplace_type=?,workplace_address_id=?,salary_min=?,salary_max=?,"
                        + "salary_currency=?,application_method=?::application_method,application_url=?,"
                        + "closes_at=?,source_type=?::job_listing_source_type,source_name=?,source_url=?,"
                        + "updated_at=now() WHERE id=?", scope, employer.trim(), title.trim(),
                description.trim(), employment, hours, schedule, workplace, address, min, max,
                normalizedCurrency(currency, min, max), method, applicationUrl,
                closesAt == null ? null : Timestamp.from(closesAt), source, sourceName, sourceUrl, id);
        if (cmd.categoryIds() != null) replaceCategories(id, requireCategories(cmd.categoryIds(), old.countryId()));
        if (mediaIds != null) replaceMedia(id, mediaIds);
        return detail(actor, id);
    }

    @Transactional
    public JobDetail publish(UUID actor, UUID id) {
        var job = requireManaged(actor, id);
        if (job.deletedAt() != null) throw notFound("JOB_NOT_FOUND");
        if (!Set.of("DRAFT", "PAUSED").contains(job.status())) throw conflict("JOB_NOT_PUBLISHABLE");
        if (expired(job) || job.closesAt() != null && !job.closesAt().isAfter(Instant.now())) {
            throw conflict("APPLICATION_DEADLINE_PAST");
        }
        jdbc.update("UPDATE job_listings SET status='PUBLISHED',published_at=now(),"
                + "updated_at=now() WHERE id=?", id);
        return detail(actor, id);
    }

    @Transactional
    public JobDetail close(UUID actor, UUID id) {
        var job = requireManaged(actor, id);
        if (job.deletedAt() != null) throw notFound("JOB_NOT_FOUND");
        if ("CLOSED".equals(job.status())) return detail(actor, id);
        if (!Set.of("PUBLISHED", "PAUSED").contains(job.status())) throw conflict("JOB_NOT_CLOSABLE");
        jdbc.update("UPDATE job_listings SET status='CLOSED',updated_at=now() WHERE id=?", id);
        return detail(actor, id);
    }

    @Transactional
    public void delete(UUID actor, UUID id) {
        var job = requireManaged(actor, id);
        if (job.deletedAt() != null) return;
        jdbc.update("UPDATE job_listings SET deleted_at=now(),updated_at=now() WHERE id=?", id);
    }

    @Transactional
    public JobDetail detail(UUID viewer, UUID id) {
        var job = requireViewable(viewer, id);
        var item = items(viewer, List.of(new Listed(job, isSaved(viewer, id),
                myApplication(viewer, id)))).get(0);
        ProfileSummary owner = job.employerUserId() == null ? null
                : identity.profileSummary(job.employerUserId()).orElse(null);
        String businessName = job.businessAccountId() == null ? null
                : businessAccounts.accountSummary(job.businessAccountId())
                        .map(BusinessAccountsApi.BusinessAccountSummary::accountName).orElse(null);
        return new JobDetail(item.job(), item.categories(), item.location(), item.mediaIds(),
                item.saved(), item.canManage(), item.myApplicationId(), item.myApplicationStatus(),
                owner, businessName);
    }

    public JobPage discover(UUID viewer, JobFilters filters, String cursor, int size) {
        int limit = clamp(size);
        String scope = filters.scope() == null ? null : upper(filters.scope());
        String sort = filters.sort() == null ? "NEWEST" : upper(filters.sort());
        if (scope != null) validate(scope, VISIBILITIES, "INVALID_VISIBILITY");
        validate(sort, Set.of("NEWEST", "CLOSING"), "INVALID_JOB_SORT");
        UUID country = identity.profileSummary(viewer).map(ProfileSummary::currentCountryId).orElse(null);
        UUID selectedCommunity = filters.communityId() != null ? filters.communityId()
                : community.activeCommunityId(viewer).orElse(null);
        if (selectedCommunity != null && !community.canAccess(viewer, selectedCommunity)) {
            if (filters.communityId() != null) throw forbidden("NOT_A_MEMBER");
            selectedCommunity = null;
        }
        var args = new ArrayList<Object>();
        args.add(viewer);
        args.add(viewer);
        String where = " WHERE j.deleted_at IS NULL AND j.status='PUBLISHED'"
                + " AND (j.closes_at IS NULL OR j.closes_at>now())";
        String countryPart = country == null ? "FALSE" : "(j.visibility_scope='COUNTRY' AND j.country_id=?)";
        if (country != null) args.add(country);
        String communityPart = selectedCommunity == null ? "FALSE"
                : "(j.visibility_scope='COMMUNITY' AND j.community_id=?)";
        if (selectedCommunity != null) args.add(selectedCommunity);
        where += " AND (" + countryPart + " OR " + communityPart + ")";
        if (filters.communityId() != null) {
            where += " AND j.community_id=?";
            args.add(filters.communityId());
        }
        if (scope != null) {
            where += " AND j.visibility_scope=?::visibility_scope";
            args.add(scope);
        }
        if (filters.categoryId() != null) {
            where += " AND EXISTS(SELECT 1 FROM job_listing_categories jc"
                    + " WHERE jc.job_id=j.id AND jc.category_id=?)";
            args.add(filters.categoryId());
        }
        if (filters.employmentType() != null) {
            String value = upper(filters.employmentType());
            validate(value, EMPLOYMENT_TYPES, "INVALID_EMPLOYMENT_TYPE");
            where += " AND j.employment_type=?::job_employment_type";
            args.add(value);
        }
        if (filters.workplaceType() != null) {
            String value = upper(filters.workplaceType());
            validate(value, WORKPLACES, "INVALID_WORKPLACE");
            where += " AND j.workplace_type=?";
            args.add(value);
        }
        if (filters.city() != null && !filters.city().isBlank()) {
            where += " AND EXISTS(SELECT 1 FROM addresses a WHERE a.id=j.workplace_address_id"
                    + " AND a.city ILIKE ?)";
            args.add(filters.city().trim());
        }
        if (filters.salaryMin() != null) {
            where += " AND COALESCE(j.salary_max,j.salary_min)>=?";
            args.add(filters.salaryMin());
        }
        if (filters.salaryMax() != null) {
            where += " AND COALESCE(j.salary_min,j.salary_max)<=?";
            args.add(filters.salaryMax());
        }
        if (filters.publishedFrom() != null) {
            where += " AND j.published_at>=?";
            args.add(Timestamp.from(filters.publishedFrom()));
        }
        if (filters.publishedTo() != null) {
            where += " AND j.published_at<=?";
            args.add(Timestamp.from(filters.publishedTo()));
        }
        if (filters.search() != null && !filters.search().isBlank()) {
            where += " AND to_tsvector('english',j.title||' '||j.employer_name||' '||j.description)"
                    + " @@ websearch_to_tsquery('english',?)";
            args.add(filters.search().trim());
        }
        String order;
        if ("CLOSING".equals(sort)) {
            where += " AND j.closes_at IS NOT NULL";
            if (cursor != null) {
                var c = decode(cursor);
                where += " AND (j.closes_at,j.id)>(?,?)";
                args.add(Timestamp.from(c.instant()));
                args.add(c.id());
            }
            order = " ORDER BY j.closes_at,j.id";
        } else {
            if (cursor != null) {
                var c = decode(cursor);
                where += " AND (j.published_at,j.id)<(?,?)";
                args.add(Timestamp.from(c.instant()));
                args.add(c.id());
            }
            order = " ORDER BY j.published_at DESC,j.id DESC";
        }
        args.add(limit + 1);
        var rows = jdbc.query(listSelect() + where + order + " LIMIT ?", JobService::listed, args.toArray());
        return page(viewer, rows, limit, sort);
    }

    public JobPage myJobs(UUID viewer, String cursor, int size) {
        int limit = clamp(size);
        var manageable = manageableAccounts(viewer);
        var args = new ArrayList<Object>();
        args.add(viewer);
        args.add(viewer);
        args.add(viewer);
        String businessPart = "FALSE";
        if (!manageable.isEmpty()) {
            businessPart = "j.business_account_id IN (" + placeholders(manageable.size()) + ")";
            manageable.forEach(args::add);
        }
        String where = " WHERE j.deleted_at IS NULL AND (j.employer_user_id=? OR " + businessPart + ")";
        if (cursor != null) {
            var c = decode(cursor);
            where += " AND (j.created_at,j.id)<(?,?)";
            args.add(Timestamp.from(c.instant()));
            args.add(c.id());
        }
        args.add(limit + 1);
        var rows = jdbc.query(listSelect() + where + " ORDER BY j.created_at DESC,j.id DESC LIMIT ?",
                JobService::listed, args.toArray());
        return page(viewer, rows, limit, "CREATED");
    }

    public JobPage savedJobs(UUID viewer, String cursor, int size) {
        int limit = clamp(size);
        UUID country = identity.profileSummary(viewer).map(ProfileSummary::currentCountryId).orElse(null);
        UUID active = community.activeCommunityId(viewer).filter(id -> community.canAccess(viewer, id)).orElse(null);
        var args = new ArrayList<Object>();
        args.add(viewer);
        args.add(viewer);
        String countryPart = country == null ? "FALSE" : "(j.visibility_scope='COUNTRY' AND j.country_id=?)";
        if (country != null) args.add(country);
        String communityPart = active == null ? "FALSE" : "(j.visibility_scope='COMMUNITY' AND j.community_id=?)";
        if (active != null) args.add(active);
        String where = " WHERE s.user_id=? AND j.deleted_at IS NULL AND j.status='PUBLISHED'"
                + " AND (j.closes_at IS NULL OR j.closes_at>now()) AND ("
                + countryPart + " OR " + communityPart + ")";
        if (cursor != null) {
            var c = decode(cursor);
            where += " AND (s.created_at,s.job_id)<(?,?)";
            args.add(Timestamp.from(c.instant()));
            args.add(c.id());
        }
        args.add(limit + 1);
        var rows = jdbc.query("SELECT " + COLS + ",a.id AS application_id,"
                + "a.status::text AS application_status,s.created_at AS saved_at FROM job_saves s"
                + " JOIN job_listings j ON j.id=s.job_id LEFT JOIN job_applications a"
                + " ON a.job_id=j.id AND a.applicant_id=?" + where
                + " ORDER BY s.created_at DESC,s.job_id DESC LIMIT ?", (rs, i) -> new SavedRow(
                        job(rs, i), application(rs), ts(rs, "saved_at")), args.toArray());
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            var last = rows.get(rows.size() - 1);
            next = encode(last.savedAt(), last.job().id());
        }
        var listedRows = rows.stream().map(r -> new Listed(r.job(), true, r.application())).toList();
        return new JobPage(items(viewer, listedRows), next);
    }

    @Transactional
    public void save(UUID viewer, UUID id) {
        requireViewable(viewer, id);
        try {
            jdbc.update("INSERT INTO job_saves(user_id,job_id) VALUES(?,?)", viewer, id);
        } catch (DuplicateKeyException ignored) {
            // Idempotent save.
        }
    }

    public void unsave(UUID viewer, UUID id) {
        jdbc.update("DELETE FROM job_saves WHERE user_id=? AND job_id=?", viewer, id);
    }

    @Transactional
    public UUID report(UUID reporter, UUID id, String reason, String details) {
        var job = requireViewable(reporter, id);
        reason = upper(reason);
        validate(reason, REPORT_REASONS, "INVALID_REPORT_REASON");
        if (details != null && details.length() > 4000) throw bad("REPORT_DETAILS_TOO_LONG");
        UUID reportId = UUID.randomUUID();
        try {
            jdbc.update("INSERT INTO reports(id,reporter_id,country_id,community_id,target_type,"
                            + "target_id,reason,details) VALUES(?,?,?,?,'JOB',?,?,?)",
                    reportId, reporter, job.countryId(), job.communityId(), id, reason, details);
        } catch (DuplicateKeyException e) {
            throw conflict("REPORT_DUPLICATE");
        }
        return reportId;
    }

    public String mediaDownloadUrl(UUID viewer, UUID jobId, UUID mediaId) {
        requireViewable(viewer, jobId);
        Integer count = jdbc.queryForObject("SELECT count(*) FROM job_media WHERE job_id=? AND media_id=?",
                Integer.class, jobId, mediaId);
        if (count == null || count == 0) throw notFound("JOB_MEDIA_NOT_FOUND");
        return media.authorizedDownloadUrl(mediaId);
    }

    private record ApplicationRef(UUID id, String status) {
    }

    private record Listed(JobRow job, boolean saved, ApplicationRef application) {
    }

    private record SavedRow(JobRow job, ApplicationRef application, Instant savedAt) {
    }

    private static ApplicationRef application(java.sql.ResultSet rs) throws java.sql.SQLException {
        UUID id = rs.getObject("application_id", UUID.class);
        return id == null ? null : new ApplicationRef(id, rs.getString("application_status"));
    }

    private static Listed listed(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Listed(job(rs, i), rs.getBoolean("saved"), application(rs));
    }

    private static String listSelect() {
        return "SELECT " + COLS + ",(s.user_id IS NOT NULL) AS saved,a.id AS application_id,"
                + "a.status::text AS application_status FROM job_listings j"
                + " LEFT JOIN job_saves s ON s.job_id=j.id AND s.user_id=?"
                + " LEFT JOIN job_applications a ON a.job_id=j.id AND a.applicant_id=?";
    }

    private JobPage page(UUID viewer, List<Listed> source, int limit, String sort) {
        var rows = source;
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            var last = rows.get(rows.size() - 1).job();
            Instant cursorValue = switch (sort) {
                case "CLOSING" -> last.closesAt();
                case "CREATED" -> last.createdAt();
                default -> last.publishedAt();
            };
            next = encode(cursorValue, last.id());
        }
        return new JobPage(items(viewer, rows), next);
    }

    private List<JobItem> items(UUID viewer, List<Listed> rows) {
        if (rows.isEmpty()) return List.of();
        var ids = rows.stream().map(r -> r.job().id()).toList();
        var categories = categoriesForJobs(ids);
        var mediaIds = mediaForJobs(ids);
        var accounts = manageableAccounts(viewer);
        return rows.stream().map(r -> {
            var job = r.job();
            boolean manage = job.businessAccountId() == null
                    ? viewer.equals(job.employerUserId()) : accounts.contains(job.businessAccountId());
            return new JobItem(job, categories.getOrDefault(job.id(), List.of()),
                    location(job.workplaceAddressId()).orElse(null),
                    mediaIds.getOrDefault(job.id(), List.of()), r.saved(), manage,
                    r.application() == null ? null : r.application().id(),
                    r.application() == null ? null : r.application().status());
        }).toList();
    }

    private Map<UUID, List<JobCategory>> categoriesForJobs(List<UUID> jobIds) {
        if (jobIds.isEmpty()) return Map.of();
        String sql = "SELECT c.id,c.country_id,c.parent_id,c.category_key,c.category_type,"
                + "c.display_name,c.description,c.sort_order,jc.job_id FROM job_listing_categories jc"
                + " JOIN job_categories c ON c.id=jc.category_id WHERE jc.job_id IN ("
                + placeholders(jobIds.size()) + ") ORDER BY jc.job_id,jc.sort_order";
        Map<UUID, List<JobCategory>> result = new LinkedHashMap<>();
        jdbc.query(sql, rs -> {
            UUID jobId = rs.getObject("job_id", UUID.class);
            result.computeIfAbsent(jobId, ignored -> new ArrayList<>()).add(category(rs, 0));
        }, jobIds.toArray());
        return result;
    }

    private Map<UUID, List<UUID>> mediaForJobs(List<UUID> jobIds) {
        if (jobIds.isEmpty()) return Map.of();
        Map<UUID, List<UUID>> result = new LinkedHashMap<>();
        jdbc.query("SELECT job_id,media_id FROM job_media WHERE job_id IN ("
                        + placeholders(jobIds.size()) + ") ORDER BY job_id,sort_order", rs -> {
                    result.computeIfAbsent(rs.getObject("job_id", UUID.class),
                            ignored -> new ArrayList<>()).add(rs.getObject("media_id", UUID.class));
                }, jobIds.toArray());
        return result;
    }

    private Optional<JobLocation> location(UUID addressId) {
        if (addressId == null) return Optional.empty();
        return jdbc.query("SELECT city,region,formatted_address FROM addresses WHERE id=?"
                        + " AND visibility='PUBLIC'", (rs, i) -> new JobLocation(rs.getString("city"),
                        rs.getString("region"), rs.getString("formatted_address")), addressId)
                .stream().findFirst();
    }

    Set<UUID> manageableAccounts(UUID viewer) {
        return businessAccounts.membershipsOf(viewer).stream()
                .filter(m -> JobAuthorization.asActiveJobManager(m) != null)
                .map(AccountMembershipView::accountId).collect(Collectors.toSet());
    }

    private boolean isSaved(UUID viewer, UUID id) {
        return Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM job_saves"
                + " WHERE user_id=? AND job_id=?)", Boolean.class, viewer, id));
    }

    private ApplicationRef myApplication(UUID viewer, UUID id) {
        return jdbc.query("SELECT id,status::text FROM job_applications WHERE job_id=? AND applicant_id=?",
                (rs, i) -> new ApplicationRef(rs.getObject("id", UUID.class), rs.getString("status")),
                id, viewer).stream().findFirst().orElse(null);
    }

    private void replaceCategories(UUID jobId, List<JobCategory> categories) {
        jdbc.update("DELETE FROM job_listing_categories WHERE job_id=?", jobId);
        for (int i = 0; i < categories.size(); i++) {
            jdbc.update("INSERT INTO job_listing_categories(job_id,category_id,is_primary,sort_order)"
                    + " VALUES(?,?,?,?)", jobId, categories.get(i).id(), i == 0, i);
        }
    }

    private void replaceMedia(UUID jobId, List<UUID> mediaIds) {
        jdbc.update("DELETE FROM job_media WHERE job_id=?", jobId);
        for (int i = 0; i < mediaIds.size(); i++) {
            jdbc.update("INSERT INTO job_media(job_id,media_id,sort_order) VALUES(?,?,?)",
                    jobId, mediaIds.get(i), i);
        }
    }

    private List<UUID> validateMedia(List<UUID> ids, UUID actor, String purpose) {
        if (ids == null) return List.of();
        if (ids.size() > 5) throw bad("TOO_MANY_JOB_MEDIA");
        List<UUID> unique = new ArrayList<>(new LinkedHashSet<>(ids));
        if (unique.size() != ids.size()) throw bad("DUPLICATE_JOB_MEDIA");
        for (UUID id : unique) {
            if (!media.validateForAttach(id, actor, purpose)) throw forbidden("MEDIA_NOT_ATTACHMENT_READY");
        }
        return unique;
    }

    private UUID createLocation(UUID actor, UUID countryId, String city, String region,
            String formattedAddress, String workplace) {
        city = blankToNull(city);
        region = blankToNull(region);
        formattedAddress = blankToNull(formattedAddress);
        if (city == null && formattedAddress == null) {
            if (!"REMOTE".equals(workplace)) throw bad("JOB_LOCATION_REQUIRED");
            return null;
        }
        if (city != null && city.length() > 120 || region != null && region.length() > 120
                || formattedAddress != null && formattedAddress.length() > 1000) {
            throw bad("JOB_LOCATION_INVALID");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO addresses(id,country_id,city,region,formatted_address,visibility,"
                + "owner_user_id) VALUES(?,?,?,?,?,'PUBLIC',?)", id, countryId, city, region,
                formattedAddress, actor);
        return id;
    }

    private static void validateCompensation(BigDecimal min, BigDecimal max, String currency) {
        if (min != null && (min.signum() < 0 || min.scale() > 2 || min.precision() > 12)
                || max != null && (max.signum() < 0 || max.scale() > 2 || max.precision() > 12)) {
            throw bad("SALARY_INVALID");
        }
        if (min != null && max != null && max.compareTo(min) < 0) throw bad("SALARY_RANGE_INVALID");
        if ((min != null || max != null) && (currency == null || !currency.trim().matches("(?i)[A-Z]{3}"))) {
            throw bad("SALARY_CURRENCY_REQUIRED");
        }
    }

    private static String normalizedCurrency(String currency, BigDecimal min, BigDecimal max) {
        return min == null && max == null ? null : currency.trim().toUpperCase();
    }

    private static void validateApplication(String method, String url) {
        if ("INTERNAL".equals(method)) {
            if (url != null && !url.isBlank()) throw bad("INTERNAL_APPLICATION_URL_FORBIDDEN");
        } else {
            if (url == null || url.isBlank()) throw bad("EXTERNAL_APPLICATION_URL_REQUIRED");
            validateUrl(url);
        }
    }

    private static void validateUrl(String value) {
        try {
            URI uri = URI.create(value.trim());
            if (!Set.of("http", "https").contains(uri.getScheme().toLowerCase())
                    || uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null) {
                throw bad("INVALID_EXTERNAL_URL");
            }
        } catch (IllegalArgumentException | NullPointerException e) {
            throw bad("INVALID_EXTERNAL_URL");
        }
    }

    private static void validateText(String value, int max, String code) {
        if (value == null || value.trim().isEmpty() || value.trim().length() > max) throw bad(code);
    }

    private static void validate(String value, Set<String> allowed, String code) {
        if (value == null || !allowed.contains(value)) throw bad(code);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String placeholders(int count) {
        return String.join(",", Collections.nCopies(count, "?"));
    }

    private record CursorParts(Instant instant, UUID id) {
    }

    private static String encode(Instant instant, UUID id) {
        if (instant == null) return null;
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
