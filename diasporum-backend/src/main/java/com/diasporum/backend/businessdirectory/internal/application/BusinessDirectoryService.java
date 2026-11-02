package com.diasporum.backend.businessdirectory.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.businessaccounts.BusinessAccountsApi.AccountMembershipView;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.BusinessView;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.CategoryView;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.MediaView;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.Page;
import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.messaging.MessagingApi;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import java.math.BigDecimal;
import java.net.URI;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Directory profiles, discovery, media, and BUSINESS_PROFILE contact integration. */
@Service
public class BusinessDirectoryService extends DirectorySupport {

    private static final Set<String> VISIBILITIES = Set.of(
            "COUNTRY", "COMMUNITY", "SELECTED_COMMUNITIES");
    private static final Pattern EMAIL = Pattern.compile(
            "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    private static final Pattern PHONE = Pattern.compile(
            "^\\+?[0-9][0-9 ()-]{6,24}$");
    private static final String COLS = "b.id,b.country_id,b.owner_user_id,"
            + "b.business_account_id,b.created_by_user_id,b.category_id,b.name,"
            + "b.slug,b.description,b.phone,b.email,b.website_url,"
            + "b.verification_status::text AS verification_status,"
            + "b.status::text AS status,b.visibility_scope::text AS visibility_scope,"
            + "b.community_id,b.average_rating,b.review_count,b.is_sponsored,"
            + "b.created_at,b.updated_at,b.deleted_at";
    private static final String ENRICHED = COLS + ",c.id AS cat_id,"
            + "c.country_id AS cat_country_id,c.name AS cat_name,c.slug AS cat_slug,"
            + "c.icon_key AS cat_icon_key,c.is_active AS cat_active,"
            + "(SELECT bm.media_id FROM business_media bm"
            + " WHERE bm.business_id=b.id AND bm.is_logo LIMIT 1) AS logo_media_id,"
            + "(SELECT bm.media_id FROM business_media bm"
            + " WHERE bm.business_id=b.id AND bm.is_cover LIMIT 1) AS cover_media_id";

    private final BusinessAccountsApi businessAccounts;
    private final CommunityApi community;
    private final IdentityApi identity;
    private final TaxonomyApi taxonomy;
    private final MediaApi media;
    private final MessagingApi messaging;

    public BusinessDirectoryService(JdbcTemplate jdbc,
            BusinessAccountsApi businessAccounts, CommunityApi community,
            IdentityApi identity, TaxonomyApi taxonomy, MediaApi media,
            MessagingApi messaging) {
        super(jdbc);
        this.businessAccounts = businessAccounts;
        this.community = community;
        this.identity = identity;
        this.taxonomy = taxonomy;
        this.media = media;
        this.messaging = messaging;
    }

    public record CreateCommand(UUID countryId, UUID businessAccountId,
            UUID categoryId, String name, String description, String phone,
            String email, String websiteUrl, String visibilityScope,
            UUID communityId, List<UUID> selectedCommunityIds) {
    }

    public record UpdateCommand(UUID categoryId, boolean clearCategory, String name,
            String description, String phone, String email, String websiteUrl,
            String visibilityScope, UUID communityId,
            List<UUID> selectedCommunityIds) {
    }

    public record SearchCommand(UUID countryId, UUID communityId, UUID categoryId,
            String city, String search, Boolean verifiedOnly, Double latitude,
            Double longitude, Integer radiusMeters, String sort, String cursor,
            int size) {
    }

    record ListingRow(UUID id, UUID countryId, UUID ownerUserId,
            UUID businessAccountId, UUID createdByUserId, UUID categoryId,
            String name, String slug, String description, String phone, String email,
            String websiteUrl, String verificationStatus, String status,
            String visibilityScope, UUID communityId, BigDecimal averageRating,
            int reviewCount, boolean sponsored, Instant createdAt, Instant updatedAt,
            Instant deletedAt) {
    }

    private record Listed(ListingRow listing, CategoryView category, boolean saved,
            UUID logoMediaId, UUID coverMediaId, Double distanceMeters) {
    }

    private record SavedListed(Listed item, Instant savedAt) {
    }

    private static ListingRow listing(ResultSet rs) throws SQLException {
        return new ListingRow(rs.getObject("id", UUID.class),
                rs.getObject("country_id", UUID.class),
                rs.getObject("owner_user_id", UUID.class),
                rs.getObject("business_account_id", UUID.class),
                rs.getObject("created_by_user_id", UUID.class),
                rs.getObject("category_id", UUID.class), rs.getString("name"),
                rs.getString("slug"), rs.getString("description"),
                rs.getString("phone"), rs.getString("email"),
                rs.getString("website_url"), rs.getString("verification_status"),
                rs.getString("status"), rs.getString("visibility_scope"),
                rs.getObject("community_id", UUID.class),
                rs.getBigDecimal("average_rating"), rs.getInt("review_count"),
                rs.getBoolean("is_sponsored"), ts(rs, "created_at"),
                ts(rs, "updated_at"), ts(rs, "deleted_at"));
    }

    private static Listed listed(ResultSet rs, int rowNum) throws SQLException {
        CategoryView category = null;
        if (rs.getObject("cat_id", UUID.class) != null) {
            category = new CategoryView(rs.getObject("cat_id", UUID.class),
                    rs.getObject("cat_country_id", UUID.class),
                    rs.getString("cat_name"), rs.getString("cat_slug"),
                    rs.getString("cat_icon_key"), rs.getBoolean("cat_active"));
        }
        return new Listed(listing(rs), category, rs.getBoolean("saved"),
                rs.getObject("logo_media_id", UUID.class),
                rs.getObject("cover_media_id", UUID.class),
                rs.getObject("distance_m", Double.class));
    }

    private BusinessView view(Listed item, boolean canManage, String accountName) {
        var b = item.listing();
        return new BusinessView(b.id(), b.countryId(), item.category(), b.name(),
                b.slug(), b.description(), b.phone(), b.email(), b.websiteUrl(),
                b.verificationStatus(), b.status(), b.visibilityScope(), b.communityId(),
                b.averageRating(), b.reviewCount(), b.sponsored(), b.createdAt(),
                b.updatedAt(), item.saved(), canManage, accountName, item.logoMediaId(),
                item.coverMediaId(), item.distanceMeters());
    }

    // =================== categories ===================

    public List<CategoryView> categories(UUID countryId) {
        return jdbc.query("SELECT id,country_id,name,slug,icon_key,is_active"
                        + " FROM business_categories WHERE is_active"
                        + " AND (?::uuid IS NULL OR country_id IS NULL OR country_id=?)"
                        + " ORDER BY name,slug",
                (rs, i) -> new CategoryView(rs.getObject("id", UUID.class),
                        rs.getObject("country_id", UUID.class), rs.getString("name"),
                        rs.getString("slug"), rs.getString("icon_key"),
                        rs.getBoolean("is_active")), countryId, countryId);
    }

    private CategoryView requireCategory(UUID id, UUID countryId) {
        return jdbc.query("SELECT id,country_id,name,slug,icon_key,is_active"
                        + " FROM business_categories WHERE id=? AND is_active",
                (rs, i) -> new CategoryView(rs.getObject("id", UUID.class),
                        rs.getObject("country_id", UUID.class), rs.getString("name"),
                        rs.getString("slug"), rs.getString("icon_key"),
                        rs.getBoolean("is_active")), id).stream().findFirst()
                .filter(c -> c.countryId() == null || c.countryId().equals(countryId))
                .orElseThrow(() -> bad("INVALID_CATEGORY"));
    }

    // =================== authorization and visibility ===================

    public boolean canManage(UUID actor, ListingRow b) {
        if (actor.equals(b.ownerUserId())) {
            return true;
        }
        if (b.businessAccountId() == null) {
            return false;
        }
        return DirectoryAuthorization.isActiveManager(
                businessAccounts.membership(actor, b.businessAccountId()).orElse(null));
    }

    public boolean canView(UUID viewer, ListingRow b) {
        if (b.deletedAt() != null || "DELETED".equals(b.status())) {
            return false;
        }
        if (canManage(viewer, b)) {
            return true;
        }
        if (!"PUBLISHED".equals(b.status())) {
            return false;
        }
        if ("COMMUNITY".equals(b.visibilityScope())) {
            return b.communityId() != null && community.canAccess(viewer, b.communityId());
        }
        if ("SELECTED_COMMUNITIES".equals(b.visibilityScope())) {
            Set<UUID> memberships = new HashSet<>();
            community.membershipsOf(viewer).forEach(m -> memberships.add(m.communityId()));
            if (memberships.isEmpty()) {
                return false;
            }
            String placeholders = String.join(",", java.util.Collections.nCopies(
                    memberships.size(), "?"));
            var args = new ArrayList<Object>();
            args.add(b.id());
            args.addAll(memberships);
            Integer count = jdbc.queryForObject(
                    "SELECT count(*) FROM business_listing_communities"
                            + " WHERE business_listing_id=? AND community_id IN ("
                            + placeholders + ")", Integer.class, args.toArray());
            return count != null && count > 0;
        }
        var profile = identity.profileSummary(viewer).orElse(null);
        return profile != null && b.countryId().equals(profile.currentCountryId());
    }

    ListingRow requireListing(UUID id) {
        return jdbc.query("SELECT " + COLS + " FROM business_listings b WHERE b.id=?",
                        (rs, i) -> listing(rs), id).stream().findFirst()
                .orElseThrow(() -> notFound("BUSINESS_NOT_FOUND"));
    }

    public ListingRow requireViewable(UUID viewer, UUID id) {
        var b = requireListing(id);
        if (!canView(viewer, b)) {
            throw notFound("BUSINESS_NOT_FOUND");
        }
        return b;
    }

    public ListingRow requirePubliclyViewable(UUID viewer, UUID id) {
        var b = requireViewable(viewer, id);
        if (!"PUBLISHED".equals(b.status())) {
            throw notFound("BUSINESS_NOT_FOUND");
        }
        return b;
    }

    public ListingRow requireManaged(UUID actor, UUID id) {
        var b = requireListing(id);
        if (b.deletedAt() != null || "DELETED".equals(b.status())) {
            throw notFound("BUSINESS_NOT_FOUND");
        }
        if (!canManage(actor, b)) {
            throw forbidden("NOT_BUSINESS_MANAGER");
        }
        return b;
    }

    private Set<UUID> manageableAccounts(UUID actor) {
        Set<UUID> ids = new HashSet<>();
        businessAccounts.membershipsOf(actor).stream()
                .filter(DirectoryAuthorization::isActiveManager)
                .forEach(m -> ids.add(m.accountId()));
        return ids;
    }

    // =================== profile lifecycle ===================

    @Transactional
    public BusinessView create(UUID actor, CreateCommand command) {
        UUID countryId = command.countryId() != null ? command.countryId()
                : identity.profileSummary(actor).map(ProfileSummary::currentCountryId)
                        .orElseThrow(() -> bad("COUNTRY_REQUIRED"));
        if (!taxonomy.isCountryActive(countryId)) {
            throw bad("INVALID_COUNTRY");
        }
        validateProfile(command.name(), command.description(), command.phone(),
                command.email(), command.websiteUrl());
        requireCategory(command.categoryId(), countryId);
        AccountMembershipView membership = null;
        if (command.businessAccountId() != null) {
            membership = businessAccounts.membership(actor, command.businessAccountId())
                    .orElse(null);
            if (!DirectoryAuthorization.isActiveManager(membership)) {
                throw forbidden("BUSINESS_ROLE_REQUIRED");
            }
        }
        String visibility = command.visibilityScope() == null ? "COUNTRY"
                : command.visibilityScope();
        validateVisibility(actor, countryId, visibility, command.communityId(),
                command.selectedCommunityIds());
        UUID id = UUID.randomUUID();
        String slug = slug(command.name(), id);
        jdbc.update("INSERT INTO business_listings(id,country_id,owner_user_id,"
                        + "business_account_id,created_by_user_id,category_id,name,slug,"
                        + "description,phone,email,website_url,status,visibility_scope,"
                        + "community_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',"
                        + "?::visibility_scope,?)",
                id, countryId, membership == null ? actor : null,
                membership == null ? null : membership.accountId(), actor,
                command.categoryId(), command.name().trim(), slug,
                command.description().trim(), clean(command.phone()), clean(command.email()),
                clean(command.websiteUrl()), visibility,
                "COMMUNITY".equals(visibility) ? command.communityId() : null);
        replaceSelectedCommunities(id, visibility, command.selectedCommunityIds());
        audit(actor, "BUSINESS_PROFILE_CREATED", "BUSINESS", id);
        return detail(actor, id);
    }

    @Transactional
    public BusinessView update(UUID actor, UUID id, UpdateCommand command) {
        var b = requireManaged(actor, id);
        String name = command.name() == null ? b.name() : command.name();
        String description = command.description() == null ? b.description()
                : command.description();
        String phone = command.phone() == null ? b.phone() : clean(command.phone());
        String email = command.email() == null ? b.email() : clean(command.email());
        String website = command.websiteUrl() == null ? b.websiteUrl()
                : clean(command.websiteUrl());
        validateProfile(name, description, phone, email, website);
        UUID category = command.clearCategory() ? null
                : command.categoryId() == null ? b.categoryId() : command.categoryId();
        if (category != null) {
            requireCategory(category, b.countryId());
        }
        String visibility = command.visibilityScope() == null ? b.visibilityScope()
                : command.visibilityScope();
        UUID communityId = command.visibilityScope() == null && command.communityId() == null
                ? b.communityId() : command.communityId();
        List<UUID> selected = command.selectedCommunityIds();
        if (selected == null && "SELECTED_COMMUNITIES".equals(visibility)) {
            selected = jdbc.queryForList("SELECT community_id"
                            + " FROM business_listing_communities WHERE business_listing_id=?",
                    UUID.class, id);
        }
        validateVisibility(actor, b.countryId(), visibility, communityId, selected);
        jdbc.update("UPDATE business_listings SET category_id=?,name=?,description=?,"
                        + "phone=?,email=?,website_url=?,visibility_scope=?::visibility_scope,"
                        + "community_id=?,updated_at=now() WHERE id=?",
                category, name.trim(), description.trim(), phone, email, website,
                visibility, "COMMUNITY".equals(visibility) ? communityId : null, id);
        if (selected != null || !"SELECTED_COMMUNITIES".equals(visibility)) {
            replaceSelectedCommunities(id, visibility, selected);
        }
        audit(actor, "BUSINESS_PROFILE_UPDATED", "BUSINESS", id);
        return detail(actor, id);
    }

    @Transactional
    public BusinessView publish(UUID actor, UUID id) {
        var b = requireManaged(actor, id);
        if (!"DRAFT".equals(b.status())) {
            throw conflict("BUSINESS_NOT_DRAFT");
        }
        if (b.categoryId() == null) {
            throw bad("CATEGORY_REQUIRED");
        }
        requireCategory(b.categoryId(), b.countryId());
        jdbc.update("UPDATE business_listings SET status='PUBLISHED',updated_at=now()"
                + " WHERE id=?", id);
        audit(actor, "BUSINESS_PROFILE_PUBLISHED", "BUSINESS", id);
        return detail(actor, id);
    }

    @Transactional
    public BusinessView unpublish(UUID actor, UUID id) {
        var b = requireManaged(actor, id);
        if (!"PUBLISHED".equals(b.status())) {
            throw conflict("BUSINESS_NOT_PUBLISHED");
        }
        jdbc.update("UPDATE business_listings SET status='DRAFT',updated_at=now()"
                + " WHERE id=?", id);
        audit(actor, "BUSINESS_PROFILE_UNPUBLISHED", "BUSINESS", id);
        return detail(actor, id);
    }

    @Transactional
    public void delete(UUID actor, UUID id) {
        requireManaged(actor, id);
        jdbc.update("UPDATE business_listings SET status='DELETED',deleted_at=now(),"
                + "updated_at=now() WHERE id=?", id);
        audit(actor, "BUSINESS_PROFILE_DELETED", "BUSINESS", id);
    }

    private void validateProfile(String name, String description, String phone,
            String email, String website) {
        if (name == null || name.trim().isEmpty() || name.trim().length() > 180) {
            throw bad("NAME_INVALID");
        }
        if (description == null || description.trim().isEmpty()
                || description.trim().length() > 8000) {
            throw bad("DESCRIPTION_INVALID");
        }
        if (phone != null && !phone.isBlank() && !PHONE.matcher(phone.trim()).matches()) {
            throw bad("PHONE_INVALID");
        }
        if (email != null && !email.isBlank()
                && (email.length() > 320 || !EMAIL.matcher(email.trim()).matches())) {
            throw bad("EMAIL_INVALID");
        }
        if (website != null && !website.isBlank()) {
            try {
                URI uri = URI.create(website.trim());
                if (!("http".equalsIgnoreCase(uri.getScheme())
                        || "https".equalsIgnoreCase(uri.getScheme()))
                        || uri.getHost() == null) {
                    throw bad("WEBSITE_INVALID");
                }
            } catch (IllegalArgumentException e) {
                throw bad("WEBSITE_INVALID");
            }
        }
    }

    static String clean(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String slug(String name, UUID id) {
        String base = name.trim().toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
        if (base.isEmpty()) {
            base = "business";
        }
        return base.substring(0, Math.min(base.length(), 150)) + "-"
                + id.toString().substring(0, 8);
    }

    private void validateVisibility(UUID actor, UUID countryId, String visibility,
            UUID communityId, List<UUID> selected) {
        if (!VISIBILITIES.contains(visibility)) {
            throw bad("INVALID_VISIBILITY");
        }
        if ("COMMUNITY".equals(visibility)) {
            if (communityId == null || !community.canAccess(actor, communityId)) {
                throw forbidden("NOT_A_MEMBER");
            }
            validateCommunityCountry(communityId, countryId);
        } else if (communityId != null) {
            throw bad("COMMUNITY_NOT_ALLOWED");
        }
        if ("SELECTED_COMMUNITIES".equals(visibility)) {
            if (selected == null || selected.isEmpty()) {
                throw bad("COMMUNITIES_REQUIRED");
            }
            for (UUID id : new LinkedHashSet<>(selected)) {
                if (!community.canAccess(actor, id)) {
                    throw forbidden("NOT_A_MEMBER");
                }
                validateCommunityCountry(id, countryId);
            }
        }
    }

    private void validateCommunityCountry(UUID communityId, UUID countryId) {
        var c = taxonomy.findCommunityById(communityId)
                .orElseThrow(() -> bad("COMMUNITY_NOT_FOUND"));
        if (!c.active() || !countryId.equals(c.destinationCountryId())) {
            throw bad("COMMUNITY_COUNTRY_MISMATCH");
        }
    }

    private void replaceSelectedCommunities(UUID id, String visibility,
            List<UUID> selected) {
        jdbc.update("DELETE FROM business_listing_communities WHERE business_listing_id=?", id);
        if (!"SELECTED_COMMUNITIES".equals(visibility) || selected == null) {
            return;
        }
        for (UUID communityId : new LinkedHashSet<>(selected)) {
            jdbc.update("INSERT INTO business_listing_communities(business_listing_id,"
                    + "community_id) VALUES(?,?)", id, communityId);
        }
    }

    // =================== detail and managed profiles ===================

    public BusinessView detail(UUID viewer, UUID id) {
        var b = requireViewable(viewer, id);
        var item = jdbc.query("SELECT " + ENRICHED + ",(s.user_id IS NOT NULL) AS saved,"
                        + "NULL::double precision AS distance_m FROM business_listings b"
                        + " LEFT JOIN business_categories c ON c.id=b.category_id"
                        + " LEFT JOIN business_saves s ON s.business_id=b.id AND s.user_id=?"
                        + " WHERE b.id=?", BusinessDirectoryService::listed, viewer, id)
                .stream().findFirst().orElseThrow(() -> notFound("BUSINESS_NOT_FOUND"));
        String accountName = b.businessAccountId() == null ? null
                : businessAccounts.accountSummary(b.businessAccountId())
                        .map(BusinessAccountsApi.BusinessAccountSummary::accountName)
                        .orElse(null);
        return view(item, canManage(viewer, b), accountName);
    }

    public Page<BusinessView> managed(UUID actor, UUID businessAccountId,
            String cursor, int size) {
        int limit = clamp(size);
        Set<UUID> accounts = manageableAccounts(actor);
        if (businessAccountId != null) {
            if (!accounts.contains(businessAccountId)) {
                throw forbidden("BUSINESS_ROLE_REQUIRED");
            }
            accounts = Set.of(businessAccountId);
        }
        var args = new ArrayList<Object>();
        args.add(actor);
        args.add(actor);
        String accountFilter = "FALSE";
        if (!accounts.isEmpty()) {
            accountFilter = "b.business_account_id IN ("
                    + String.join(",", java.util.Collections.nCopies(accounts.size(), "?")) + ")";
            accounts.forEach(args::add);
        }
        String where = " WHERE b.deleted_at IS NULL AND b.status<>'DELETED'"
                + " AND (b.owner_user_id=? OR " + accountFilter + ")";
        if (cursor != null) {
            var c = decodeTimeCursor(cursor);
            where += " AND (b.created_at,b.id) < (?,?)";
            args.add(Timestamp.from(c.createdAt()));
            args.add(c.id());
        }
        args.add(limit + 1);
        var rows = jdbc.query("SELECT " + ENRICHED + ",(s.user_id IS NOT NULL) AS saved,"
                        + "NULL::double precision AS distance_m FROM business_listings b"
                        + " LEFT JOIN business_categories c ON c.id=b.category_id"
                        + " LEFT JOIN business_saves s ON s.business_id=b.id AND s.user_id=?"
                        + where + " ORDER BY b.created_at DESC,b.id DESC LIMIT ?",
                BusinessDirectoryService::listed, args.toArray());
        return businessPage(rows, actor, accounts, limit, false);
    }

    // =================== discovery ===================

    public Page<BusinessView> discover(UUID viewer, SearchCommand command) {
        int limit = clamp(command.size());
        boolean distance = "distance".equalsIgnoreCase(command.sort());
        boolean hasLatitude = command.latitude() != null;
        boolean hasLongitude = command.longitude() != null;
        if (hasLatitude != hasLongitude || (distance && !hasLatitude)
                || (command.radiusMeters() != null && !hasLatitude)) {
            throw bad("COORDINATES_REQUIRED");
        }
        if (hasLatitude && (command.latitude() < -90 || command.latitude() > 90
                || command.longitude() < -180 || command.longitude() > 180)) {
            throw bad("INVALID_COORDINATES");
        }
        if (command.radiusMeters() != null && (command.radiusMeters() <= 0
                || command.radiusMeters() > 100000)) {
            throw bad("INVALID_RADIUS");
        }
        if (command.sort() != null && !distance && !"newest".equalsIgnoreCase(command.sort())) {
            throw bad("INVALID_SORT");
        }
        Set<UUID> manageable = manageableAccounts(viewer);
        var memberships = community.membershipsOf(viewer);
        var args = new ArrayList<Object>();
        args.add(viewer);
        String lateral;
        if (hasLatitude) {
            lateral = " LEFT JOIN LATERAL (SELECT MIN(ST_Distance(a.discovery_location,"
                    + "ST_SetSRID(ST_MakePoint(?,?),4326)::geography)) AS distance_m"
                    + " FROM business_locations bl JOIN addresses a ON a.id=bl.address_id"
                    + " WHERE bl.business_id=b.id AND bl.is_active"
                    + " AND a.discovery_location IS NOT NULL) d ON TRUE";
            args.add(command.longitude());
            args.add(command.latitude());
        } else {
            lateral = " CROSS JOIN (SELECT NULL::double precision AS distance_m) d";
        }
        String where = " WHERE b.status='PUBLISHED' AND b.deleted_at IS NULL";
        if (command.communityId() != null) {
            if (!community.canAccess(viewer, command.communityId())) {
                throw forbidden("NOT_A_MEMBER");
            }
            where += " AND ((b.visibility_scope='COMMUNITY' AND b.community_id=?)"
                    + " OR (b.visibility_scope='SELECTED_COMMUNITIES' AND EXISTS"
                    + " (SELECT 1 FROM business_listing_communities bc"
                    + " WHERE bc.business_listing_id=b.id AND bc.community_id=?)))";
            args.add(command.communityId());
            args.add(command.communityId());
        } else {
            var profileCountry = identity.profileSummary(viewer)
                    .map(ProfileSummary::currentCountryId).orElse(null);
            String countryVisibility = profileCountry == null ? "FALSE"
                    : "(b.visibility_scope='COUNTRY' AND b.country_id=?)";
            if (profileCountry != null) {
                args.add(profileCountry);
            }
            String communityVisibility = "FALSE";
            if (!memberships.isEmpty()) {
                String ph = String.join(",", java.util.Collections.nCopies(
                        memberships.size(), "?"));
                communityVisibility = "((b.visibility_scope='COMMUNITY' AND b.community_id IN ("
                        + ph + ")) OR (b.visibility_scope='SELECTED_COMMUNITIES' AND EXISTS"
                        + " (SELECT 1 FROM business_listing_communities bc"
                        + " WHERE bc.business_listing_id=b.id AND bc.community_id IN (" + ph + "))))";
                memberships.forEach(m -> args.add(m.communityId()));
                memberships.forEach(m -> args.add(m.communityId()));
            }
            where += " AND (" + countryVisibility + " OR " + communityVisibility + ")";
        }
        if (command.countryId() != null) {
            where += " AND b.country_id=?";
            args.add(command.countryId());
        }
        if (command.categoryId() != null) {
            where += " AND b.category_id=?";
            args.add(command.categoryId());
        }
        if (command.city() != null && !command.city().isBlank()) {
            where += " AND EXISTS (SELECT 1 FROM business_locations bl"
                    + " JOIN addresses a ON a.id=bl.address_id WHERE bl.business_id=b.id"
                    + " AND bl.is_active AND lower(a.city)=lower(?))";
            args.add(command.city().trim());
        }
        if (Boolean.TRUE.equals(command.verifiedOnly())) {
            where += " AND b.verification_status='VERIFIED'";
        }
        if (command.search() != null && !command.search().isBlank()) {
            String q = command.search().trim();
            where += " AND (to_tsvector('english',b.name||' '||b.description)"
                    + " @@ websearch_to_tsquery('english',?) OR b.name ILIKE ?)";
            args.add(q);
            args.add("%" + q + "%");
        }
        if (command.radiusMeters() != null) {
            where += " AND EXISTS (SELECT 1 FROM business_locations bl"
                    + " JOIN addresses a ON a.id=bl.address_id WHERE bl.business_id=b.id"
                    + " AND bl.is_active AND a.discovery_location IS NOT NULL"
                    + " AND ST_DWithin(a.discovery_location,ST_SetSRID(ST_MakePoint(?,?),"
                    + "4326)::geography,?))";
            args.add(command.longitude());
            args.add(command.latitude());
            args.add(command.radiusMeters());
        }
        if (distance) {
            where += " AND d.distance_m IS NOT NULL";
            if (command.cursor() != null) {
                var c = decodeDistanceCursor(command.cursor());
                where += " AND (d.distance_m,b.id) > (?,?)";
                args.add(c.distance());
                args.add(c.id());
            }
        } else if (command.cursor() != null) {
            var c = decodeTimeCursor(command.cursor());
            where += " AND (b.created_at,b.id) < (?,?)";
            args.add(Timestamp.from(c.createdAt()));
            args.add(c.id());
        }
        args.add(limit + 1);
        String order = distance ? "d.distance_m,b.id" : "b.created_at DESC,b.id DESC";
        var rows = jdbc.query("SELECT " + ENRICHED + ",(s.user_id IS NOT NULL) AS saved,"
                        + "d.distance_m FROM business_listings b"
                        + " LEFT JOIN business_categories c ON c.id=b.category_id"
                        + " LEFT JOIN business_saves s ON s.business_id=b.id AND s.user_id=?"
                        + lateral + where + " ORDER BY " + order + " LIMIT ?",
                BusinessDirectoryService::listed, args.toArray());
        return businessPage(rows, viewer, manageable, limit, distance);
    }

    private Page<BusinessView> businessPage(List<Listed> source, UUID viewer,
            Set<UUID> manageable, int limit, boolean distance) {
        var rows = new ArrayList<>(source);
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            var last = rows.get(rows.size() - 1);
            next = distance ? encodeDistanceCursor(last.distanceMeters(), last.listing().id())
                    : encodeTimeCursor(last.listing().createdAt(), last.listing().id());
        }
        var items = rows.stream().map(item -> {
            var b = item.listing();
            boolean canManage = viewer.equals(b.ownerUserId())
                    || b.businessAccountId() != null
                    && manageable.contains(b.businessAccountId());
            return view(item, canManage, null);
        }).toList();
        return new Page<>(items, next);
    }

    /** Saved listings with the same current public visibility policy as discovery. */
    public Page<BusinessView> saved(UUID viewer, String cursor, int size) {
        int limit = clamp(size);
        var manageable = manageableAccounts(viewer);
        var memberships = community.membershipsOf(viewer);
        var args = new ArrayList<Object>();
        args.add(viewer);
        String where = " WHERE sv.user_id=? AND b.status='PUBLISHED'"
                + " AND b.deleted_at IS NULL";
        var profileCountry = identity.profileSummary(viewer)
                .map(ProfileSummary::currentCountryId).orElse(null);
        String countryVisibility = profileCountry == null ? "FALSE"
                : "(b.visibility_scope='COUNTRY' AND b.country_id=?)";
        if (profileCountry != null) {
            args.add(profileCountry);
        }
        String communityVisibility = "FALSE";
        if (!memberships.isEmpty()) {
            String ph = String.join(",", java.util.Collections.nCopies(
                    memberships.size(), "?"));
            communityVisibility = "((b.visibility_scope='COMMUNITY' AND b.community_id IN ("
                    + ph + ")) OR (b.visibility_scope='SELECTED_COMMUNITIES' AND EXISTS"
                    + " (SELECT 1 FROM business_listing_communities bc"
                    + " WHERE bc.business_listing_id=b.id AND bc.community_id IN (" + ph + "))))";
            memberships.forEach(m -> args.add(m.communityId()));
            memberships.forEach(m -> args.add(m.communityId()));
        }
        where += " AND (" + countryVisibility + " OR " + communityVisibility + ")";
        if (cursor != null) {
            var c = decodeTimeCursor(cursor);
            where += " AND (sv.created_at,b.id) < (?,?)";
            args.add(Timestamp.from(c.createdAt()));
            args.add(c.id());
        }
        args.add(limit + 1);
        var rows = new ArrayList<>(jdbc.query("SELECT " + ENRICHED + ",TRUE AS saved,"
                        + "NULL::double precision AS distance_m,sv.created_at AS saved_at"
                        + " FROM business_saves sv JOIN business_listings b ON b.id=sv.business_id"
                        + " LEFT JOIN business_categories c ON c.id=b.category_id" + where
                        + " ORDER BY sv.created_at DESC,b.id DESC LIMIT ?",
                (rs, i) -> new SavedListed(listed(rs, i), ts(rs, "saved_at")),
                args.toArray()));
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            var last = rows.get(rows.size() - 1);
            next = encodeTimeCursor(last.savedAt(), last.item().listing().id());
        }
        return new Page<>(rows.stream().map(row -> {
            var item = row.item();
            var b = item.listing();
            boolean canManage = viewer.equals(b.ownerUserId())
                    || b.businessAccountId() != null && manageable.contains(b.businessAccountId());
            return view(item, canManage, null);
        }).toList(), next);
    }

    // =================== media ===================

    public List<MediaView> media(UUID viewer, UUID businessId) {
        requireViewable(viewer, businessId);
        return jdbc.query("SELECT media_id,sort_order,is_cover,is_logo FROM business_media"
                        + " WHERE business_id=? ORDER BY sort_order,media_id",
                (rs, i) -> new MediaView(rs.getObject("media_id", UUID.class),
                        rs.getInt("sort_order"), role(rs.getBoolean("is_cover"),
                                rs.getBoolean("is_logo"))), businessId);
    }

    @Transactional
    public MediaView attachMedia(UUID actor, UUID businessId, UUID mediaId,
            int sortOrder, String requestedRole) {
        requireManaged(actor, businessId);
        if (sortOrder < 0 || sortOrder > 10000) {
            throw bad("INVALID_SORT_ORDER");
        }
        String role = requestedRole == null ? "GALLERY" : requestedRole;
        validateRole(role);
        validateBusinessMedia(actor, mediaId);
        if (!"GALLERY".equals(role)) {
            jdbc.update("UPDATE business_media SET is_cover=false,is_logo=false"
                            + " WHERE business_id=? AND media_id<>? AND "
                            + ("COVER".equals(role) ? "is_cover" : "is_logo"),
                    businessId, mediaId);
        }
        jdbc.update("INSERT INTO business_media(business_id,media_id,sort_order,is_cover,"
                        + "is_logo) VALUES(?,?,?,?,?) ON CONFLICT(business_id,media_id)"
                        + " DO UPDATE SET sort_order=EXCLUDED.sort_order,"
                        + "is_cover=EXCLUDED.is_cover,is_logo=EXCLUDED.is_logo",
                businessId, mediaId, sortOrder, "COVER".equals(role), "LOGO".equals(role));
        audit(actor, "BUSINESS_MEDIA_ATTACHED", "BUSINESS", businessId);
        return new MediaView(mediaId, sortOrder, role);
    }

    @Transactional
    public MediaView updateMedia(UUID actor, UUID businessId, UUID mediaId,
            Integer sortOrder, String requestedRole) {
        requireManaged(actor, businessId);
        var current = media(actor, businessId).stream()
                .filter(m -> m.mediaId().equals(mediaId)).findFirst()
                .orElseThrow(() -> notFound("BUSINESS_MEDIA_NOT_FOUND"));
        int order = sortOrder == null ? current.sortOrder() : sortOrder;
        String role = requestedRole == null ? current.role() : requestedRole;
        if (order < 0 || order > 10000) {
            throw bad("INVALID_SORT_ORDER");
        }
        validateRole(role);
        if (!"GALLERY".equals(role)) {
            jdbc.update("UPDATE business_media SET is_cover=false,is_logo=false"
                            + " WHERE business_id=? AND media_id<>? AND "
                            + ("COVER".equals(role) ? "is_cover" : "is_logo"),
                    businessId, mediaId);
        }
        jdbc.update("UPDATE business_media SET sort_order=?,is_cover=?,is_logo=?"
                        + " WHERE business_id=? AND media_id=?", order, "COVER".equals(role),
                "LOGO".equals(role), businessId, mediaId);
        audit(actor, "BUSINESS_MEDIA_UPDATED", "BUSINESS", businessId);
        return new MediaView(mediaId, order, role);
    }

    @Transactional
    public void detachMedia(UUID actor, UUID businessId, UUID mediaId) {
        requireManaged(actor, businessId);
        var asset = media.asset(mediaId).orElseThrow(() -> notFound("MEDIA_NOT_FOUND"));
        if (jdbc.update("DELETE FROM business_media WHERE business_id=? AND media_id=?",
                businessId, mediaId) == 0) {
            throw notFound("BUSINESS_MEDIA_NOT_FOUND");
        }
        if (actor.equals(asset.ownerId())) {
            media.deleteAsset(actor, mediaId);
        }
        audit(actor, "BUSINESS_MEDIA_DETACHED", "BUSINESS", businessId);
    }

    public String mediaDownloadUrl(UUID viewer, UUID businessId, UUID mediaId) {
        requireViewable(viewer, businessId);
        Integer count = jdbc.queryForObject("SELECT count(*) FROM business_media"
                + " WHERE business_id=? AND media_id=?", Integer.class, businessId, mediaId);
        if (count == null || count == 0) {
            throw notFound("BUSINESS_MEDIA_NOT_FOUND");
        }
        return media.authorizedDownloadUrl(mediaId);
    }

    private void validateBusinessMedia(UUID actor, UUID mediaId) {
        var asset = media.asset(mediaId).orElseThrow(() -> bad("MEDIA_NOT_FOUND"));
        if (!actor.equals(asset.ownerId())) {
            throw forbidden("MEDIA_NOT_OWNED");
        }
        if (!"READY".equals(asset.status())) {
            throw bad("MEDIA_NOT_READY");
        }
        if (!"BUSINESS".equals(asset.purpose())) {
            throw bad("MEDIA_WRONG_PURPOSE");
        }
    }

    private static void validateRole(String role) {
        if (!Set.of("LOGO", "COVER", "GALLERY").contains(role)) {
            throw bad("INVALID_MEDIA_ROLE");
        }
    }

    private static String role(boolean cover, boolean logo) {
        return cover ? "COVER" : logo ? "LOGO" : "GALLERY";
    }

    // =================== messaging ===================

    public UUID contact(UUID actor, UUID businessId) {
        var b = requirePubliclyViewable(actor, businessId);
        if (canManage(actor, b)) {
            throw conflict("CANNOT_CONTACT_OWN_BUSINESS");
        }
        return messaging.ensureContextConversation(actor, null, "BUSINESS_PROFILE",
                businessId, b.ownerUserId(), b.businessAccountId());
    }
}
