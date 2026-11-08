package com.diasporum.backend.propertylistings.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.BrowseOptions;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.Listed;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.PropertyPage;
import com.diasporum.backend.propertylistings.internal.application.PropertyModels.SearchCriteria;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Audience-aware discovery, owner management lists and saved properties. */
@Service
public class PropertyDiscoveryService {

    private static final int DEFAULT_PAGE = 20;
    private static final int MAX_PAGE = 50;
    private static final Set<String> MANAGER_ROLES = Set.of("OWNER", "ADMINISTRATOR",
            "LISTING_MANAGER");
    private static final Set<String> STATUSES = Set.of("DRAFT", "PENDING_REVIEW",
            "PUBLISHED", "PAUSED", "SOLD", "RENTED", "EXPIRED", "REJECTED",
            "REMOVED", "CLOSED");

    private final JdbcTemplate jdbc;
    private final PropertyRepository repository;
    private final PropertyAuthorization authorization;
    private final IdentityApi identity;
    private final CommunityApi community;
    private final BusinessAccountsApi businessAccounts;

    public PropertyDiscoveryService(JdbcTemplate jdbc, PropertyRepository repository,
            PropertyAuthorization authorization, IdentityApi identity,
            CommunityApi community, BusinessAccountsApi businessAccounts) {
        this.jdbc = jdbc;
        this.repository = repository;
        this.authorization = authorization;
        this.identity = identity;
        this.community = community;
        this.businessAccounts = businessAccounts;
    }

    public PropertyPage discover(UUID viewer, SearchCriteria criteria, String cursor,
            int size) {
        return discover(viewer, criteria, cursor, size, BrowseOptions.defaults());
    }

    public PropertyPage discover(UUID viewer, SearchCriteria criteria, String cursor,
            int size, BrowseOptions options) {
        SearchCriteria c = criteria == null ? emptyCriteria() : criteria;
        validate(c);
        validateOptions(options);
        String sort = options.sort() == null ? "NEWEST" : options.sort();
        boolean priceSort = !"NEWEST".equals(sort);
        String direction = "PRICE_ASC".equals(sort) ? "ASC" : "DESC";
        String column = priceSort ? "p.price_amount" : "COALESCE(p.published_at,p.created_at)";
        int limit = clamp(size);
        var args = new ArrayList<Object>();
        args.add(viewer);
        StringBuilder where = new StringBuilder(" WHERE p.status='PUBLISHED'"
                + " AND (p.expires_at IS NULL OR p.expires_at>now())");
        Audience audience = audience(viewer, c.communityId());
        where.append(" AND (").append(audience.sql()).append(')');
        args.addAll(audience.args());
        if (c.countryId() != null) {
            where.append(" AND p.country_id=?");
            args.add(c.countryId());
        }
        addFilters(where, args, c);
        addOptions(where, args, options);
        Long total = jdbc.queryForObject("SELECT count(*)" + PropertyRepository.LIST_FROM
                + where, Long.class, args.subList(1, args.size()).toArray());
        if (cursor != null) {
            var decoded = PropertyCursors.decodeBrowse(cursor, sort);
            where.append(" AND (").append(column).append(",p.id)")
                    .append("ASC".equals(direction) ? ">(?,?)" : "<(?,?)");
            args.add(priceSort ? new BigDecimal(decoded.value())
                    : Timestamp.from(java.time.Instant.parse(decoded.value())));
            args.add(decoded.id());
        }
        args.add(limit + 1);
        List<Listed> rows = jdbc.query("SELECT " + PropertyRepository.LIST_COLS
                        + ",EXISTS(SELECT 1 FROM property_listing_saves s"
                        + " WHERE s.property_listing_id=p.id AND s.user_id=?) AS saved,"
                        + "COALESCE(p.published_at,p.created_at) AS cursor_time" + PropertyRepository.LIST_FROM
                        + where + " ORDER BY " + column + " " + direction + ",p.id " + direction + " LIMIT ?",
                repository::listed, args.toArray());
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            Listed last = rows.get(rows.size() - 1);
            next = PropertyCursors.encodeBrowse(sort, priceSort
                    ? last.property().priceAmount().toPlainString() : last.cursorTime().toString(),
                    last.property().id());
        }
        return new PropertyPage(rows.stream().map(row -> repository.item(viewer, row)).toList(), next, total);
    }

    public PropertyPage mine(UUID viewer, String status, UUID businessAccountId,
            UUID businessListingId, String cursor, int size) {
        if (status != null && !STATUSES.contains(status)) {
            throw bad("INVALID_PROPERTY_STATUS");
        }
        int limit = clamp(size);
        List<UUID> accountIds = businessAccounts.membershipsOf(viewer).stream()
                .filter(m -> "ACTIVE".equals(m.status()))
                .filter(m -> MANAGER_ROLES.contains(m.role()))
                .map(BusinessAccountsApi.AccountMembershipView::accountId).toList();
        var args = new ArrayList<Object>();
        args.add(viewer);
        StringBuilder where = new StringBuilder(" WHERE (p.owner_user_id=?");
        args.add(viewer);
        if (!accountIds.isEmpty()) {
            where.append(" OR p.business_account_id IN (")
                    .append(placeholders(accountIds.size())).append(')');
            args.addAll(accountIds);
        }
        where.append(") AND p.status<>'REMOVED'");
        if (businessAccountId != null) {
            authorization.requireBusinessManager(viewer, businessAccountId);
            where.append(" AND p.business_account_id=?");
            args.add(businessAccountId);
        }
        if (businessListingId != null) {
            where.append(" AND p.business_listing_id=?");
            args.add(businessListingId);
        }
        if (status != null) {
            where.append(" AND p.status=?");
            args.add(status);
        }
        if (cursor != null) {
            var decoded = PropertyCursors.decode(cursor);
            where.append(" AND (p.updated_at,p.id)<(?,?)");
            args.add(Timestamp.from(decoded.time()));
            args.add(decoded.id());
        }
        args.add(limit + 1);
        List<Listed> rows = jdbc.query("SELECT " + PropertyRepository.LIST_COLS
                        + ",EXISTS(SELECT 1 FROM property_listing_saves s"
                        + " WHERE s.property_listing_id=p.id AND s.user_id=?) AS saved,"
                        + "p.updated_at AS cursor_time" + PropertyRepository.LIST_FROM
                        + where + " ORDER BY p.updated_at DESC,p.id DESC LIMIT ?",
                repository::listed, args.toArray());
        return page(viewer, rows, limit);
    }

    public PropertyPage saved(UUID viewer, String cursor, int size) {
        int limit = clamp(size);
        var args = new ArrayList<Object>();
        StringBuilder where = new StringBuilder(" WHERE sv.user_id=?"
                + " AND p.status='PUBLISHED' AND (p.expires_at IS NULL OR p.expires_at>now())");
        args.add(viewer);
        Audience audience = audience(viewer, null);
        where.append(" AND (").append(audience.sql()).append(')');
        args.addAll(audience.args());
        if (cursor != null) {
            var decoded = PropertyCursors.decode(cursor);
            where.append(" AND (sv.created_at,sv.property_listing_id)<(?,?)");
            args.add(Timestamp.from(decoded.time()));
            args.add(decoded.id());
        }
        args.add(limit + 1);
        List<Listed> rows = jdbc.query("SELECT " + PropertyRepository.LIST_COLS
                        + ",TRUE AS saved,sv.created_at AS cursor_time"
                        + " FROM property_listing_saves sv JOIN property_listings p"
                        + " ON p.id=sv.property_listing_id JOIN property_types t"
                        + " ON t.id=p.property_type_id LEFT JOIN country_property_types cpt"
                        + " ON cpt.country_id=p.country_id AND cpt.property_type_id=p.property_type_id"
                        + " LEFT JOIN addresses a ON a.id=p.address_id" + where
                        + " ORDER BY sv.created_at DESC,sv.property_listing_id DESC LIMIT ?",
                repository::listed, args.toArray());
        return page(viewer, rows, limit);
    }

    private Audience audience(UUID viewer, UUID communityId) {
        var args = new ArrayList<Object>();
        UUID country = identity.profileSummary(viewer).map(ProfileSummary::currentCountryId)
                .orElse(null);
        if (country == null) return new Audience("FALSE", args);
        args.add(country);
        if (communityId != null) {
            if (!community.canAccess(viewer, communityId)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "NOT_A_MEMBER");
            }
            args.add(communityId);
            args.add(communityId);
            return new Audience("p.country_id=? AND (p.visibility_scope='COUNTRY'"
                    + " OR (p.visibility_scope='COMMUNITY' AND p.community_id=?)"
                    + " OR (p.visibility_scope='SELECTED_COMMUNITIES' AND EXISTS(SELECT 1"
                    + " FROM property_listing_communities pc"
                    + " WHERE pc.property_listing_id=p.id AND pc.community_id=?)))", args);
        }
        List<UUID> memberships = community.membershipsOf(viewer).stream()
                .map(CommunityApi.MembershipView::communityId)
                .filter(id -> community.canAccess(viewer, id)).toList();
        List<String> clauses = new ArrayList<>();
        clauses.add("p.visibility_scope='COUNTRY'");
        if (!memberships.isEmpty()) {
            String placeholders = placeholders(memberships.size());
            clauses.add("((p.visibility_scope='COMMUNITY' AND p.community_id IN (" + placeholders
                    + ")) OR (p.visibility_scope='SELECTED_COMMUNITIES' AND EXISTS(SELECT 1"
                    + " FROM property_listing_communities pc"
                    + " WHERE pc.property_listing_id=p.id AND pc.community_id IN ("
                    + placeholders + "))))");
            args.addAll(memberships);
            args.addAll(memberships);
        }
        return new Audience("p.country_id=? AND (" + String.join(" OR ", clauses) + ")", args);
    }

    private static void addFilters(StringBuilder where, List<Object> args, SearchCriteria c) {
        if (c.businessListingId() != null) {
            where.append(" AND p.business_listing_id=?");
            args.add(c.businessListingId());
        }
        if (c.propertyTypeId() != null) {
            where.append(" AND p.property_type_id=?");
            args.add(c.propertyTypeId());
        }
        if (c.listingPurpose() != null) {
            where.append(" AND p.listing_purpose=?");
            args.add(c.listingPurpose());
        }
        if (c.minPrice() != null) {
            where.append(" AND p.price_amount>=?");
            args.add(c.minPrice());
        }
        if (c.maxPrice() != null) {
            where.append(" AND p.price_amount<=?");
            args.add(c.maxPrice());
        }
        if (c.minBedrooms() != null) {
            where.append(" AND p.bedrooms>=?");
            args.add(c.minBedrooms());
        }
        if (c.maxBedrooms() != null) {
            where.append(" AND p.bedrooms<=?");
            args.add(c.maxBedrooms());
        }
        if (c.bathrooms() != null) {
            where.append(" AND p.bathrooms>=?");
            args.add(c.bathrooms());
        }
        if (c.furnishedStatus() != null) {
            where.append(" AND p.furnished_status=?");
            args.add(c.furnishedStatus());
        }
        if (c.city() != null && !c.city().isBlank()) {
            where.append(" AND (a.city ILIKE ? OR a.region ILIKE ?)");
            args.add("%" + c.city().trim() + "%");
            args.add("%" + c.city().trim() + "%");
        }
        if (c.search() != null && !c.search().isBlank()) {
            where.append(" AND (p.title ILIKE ? OR p.description ILIKE ? OR a.city ILIKE ? OR a.region ILIKE ?)");
            String query = "%" + c.search().trim() + "%";
            args.add(query);
            args.add(query);
            args.add(query);
            args.add(query);
        }
        if (c.latitude() != null) {
            where.append(" AND ST_DWithin(a.discovery_location,"
                    + "ST_SetSRID(ST_MakePoint(?,?),4326)::geography,?)");
            args.add(c.longitude());
            args.add(c.latitude());
            args.add(c.radiusKm() * 1000.0);
        }
    }

    private static void addOptions(StringBuilder where, List<Object> args, BrowseOptions o) {
        option(where, args, "p.currency_code=?", o.currencyCode());
        option(where, args, "p.price_period=?", o.pricePeriod());
        option(where, args, "p.floor_area>=?", o.minFloorArea());
        option(where, args, "p.floor_area<=?", o.maxFloorArea());
        option(where, args, "p.floor_area_unit=?", o.floorAreaUnit());
        option(where, args, "p.availability_date<=?", o.availableBy());
        option(where, args, "p.rental_deposit<=?", o.maxDeposit());
        option(where, args, "p.bills_included=?", o.billsIncluded());
        option(where, args, "p.minimum_tenancy_months<=?", o.maxTenancyMonths());
        option(where, args, "lower(p.tenure)=lower(?)", o.tenure());
        option(where, args, "p.condition_key=?", o.conditionKey());
        option(where, args, "p.bathrooms<=?", o.maxBathrooms());
    }

    private static void option(StringBuilder where, List<Object> args, String sql, Object value) {
        if (value != null) { where.append(" AND ").append(sql); args.add(value); }
    }

    private static void validateOptions(BrowseOptions o) {
        if (o.sort() != null && !Set.of("NEWEST", "PRICE_ASC", "PRICE_DESC").contains(o.sort()))
            throw bad("INVALID_PROPERTY_SORT");
        if (o.currencyCode() != null && !o.currencyCode().matches("[A-Z]{3}"))
            throw bad("INVALID_CURRENCY");
        if (o.pricePeriod() != null && !Set.of("WEEK", "MONTH", "YEAR", "TOTAL").contains(o.pricePeriod()))
            throw bad("INVALID_PRICE_PERIOD");
        if (o.floorAreaUnit() != null && !Set.of("SQM", "SQFT").contains(o.floorAreaUnit()))
            throw bad("INVALID_AREA_UNIT");
        if (negative(o.minFloorArea()) || negative(o.maxFloorArea()) || negative(o.maxDeposit())
                || negative(o.maxTenancyMonths()) || negative(o.maxBathrooms())
                || (o.minFloorArea() != null && o.maxFloorArea() != null
                && o.minFloorArea().compareTo(o.maxFloorArea()) > 0))
            throw bad("INVALID_PROPERTY_FILTER");
        if ((o.minFloorArea() != null || o.maxFloorArea() != null) && o.floorAreaUnit() == null)
            throw bad("AREA_UNIT_REQUIRED");
        if (o.conditionKey() != null && !Set.of("NEW", "EXCELLENT", "GOOD", "FAIR",
                "NEEDS_RENOVATION", "UNSPECIFIED").contains(o.conditionKey()))
            throw bad("INVALID_PROPERTY_CONDITION");
    }

    private static void validate(SearchCriteria c) {
        if (c.listingPurpose() != null && !Set.of("SALE", "RENT").contains(c.listingPurpose())) {
            throw bad("INVALID_LISTING_PURPOSE");
        }
        if ((c.latitude() == null) != (c.longitude() == null)
                || (c.latitude() != null && (!Double.isFinite(c.latitude())
                || !Double.isFinite(c.longitude()) || c.latitude() < -90 || c.latitude() > 90
                || c.longitude() < -180 || c.longitude() > 180))) {
            throw bad("INVALID_COORDINATES");
        }
        if (c.latitude() != null && (c.radiusKm() == null || !Double.isFinite(c.radiusKm())
                || c.radiusKm() <= 0 || c.radiusKm() > 100)) {
            throw bad("INVALID_RADIUS");
        }
        if (negative(c.minPrice()) || negative(c.maxPrice())
                || (c.minPrice() != null && c.maxPrice() != null
                && c.minPrice().compareTo(c.maxPrice()) > 0)) {
            throw bad("INVALID_PRICE_RANGE");
        }
        if (negative(c.minBedrooms()) || negative(c.maxBedrooms()) || negative(c.bathrooms())
                || (c.minBedrooms() != null && c.maxBedrooms() != null
                && c.minBedrooms() > c.maxBedrooms())) {
            throw bad("INVALID_ROOM_RANGE");
        }
    }

    private PropertyPage page(UUID viewer, List<Listed> rows, int limit) {
        String next = null;
        if (rows.size() > limit) {
            rows = new ArrayList<>(rows.subList(0, limit));
            Listed last = rows.get(rows.size() - 1);
            next = PropertyCursors.encode(last.cursorTime(), last.property().id());
        }
        return new PropertyPage(rows.stream().map(row -> repository.item(viewer, row)).toList(),
                next);
    }

    private static SearchCriteria emptyCriteria() {
        return new SearchCriteria(null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null);
    }

    private static String placeholders(int size) {
        return String.join(",", Collections.nCopies(size, "?"));
    }

    private static int clamp(int size) {
        return size <= 0 ? DEFAULT_PAGE : Math.min(size, MAX_PAGE);
    }

    private static boolean negative(BigDecimal value) {
        return value != null && value.signum() < 0;
    }

    private static boolean negative(Integer value) {
        return value != null && value < 0;
    }

    private static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    private record Audience(String sql, List<Object> args) {
    }
}
