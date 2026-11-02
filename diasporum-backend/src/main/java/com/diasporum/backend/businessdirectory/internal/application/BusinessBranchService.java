package com.diasporum.backend.businessdirectory.internal.application;

import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.AddressView;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.BranchView;
import com.diasporum.backend.businessdirectory.internal.domain.DirectoryTypes.OpeningHourView;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Time;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Branch and weekday-hours management over the shared PUBLIC address model. */
@Service
public class BusinessBranchService extends DirectorySupport {

    private static final Pattern PHONE = Pattern.compile(
            "^\\+?[0-9][0-9 ()-]{6,24}$");
    private static final String SELECT = "SELECT bl.id,bl.business_id,bl.address_id,"
            + "bl.location_name,bl.phone,bl.is_primary,bl.is_active,bl.timezone,"
            + "a.address_line_1,a.address_line_2,a.city,a.region,a.postal_code,"
            + "a.formatted_address,ST_Y(a.discovery_location::geometry) AS discovery_lat,"
            + "ST_X(a.discovery_location::geometry) AS discovery_lon"
            + " FROM business_locations bl JOIN addresses a ON a.id=bl.address_id";

    private final BusinessDirectoryService directory;

    public BusinessBranchService(JdbcTemplate jdbc, BusinessDirectoryService directory) {
        super(jdbc);
        this.directory = directory;
    }

    public record AddressCommand(String addressLine1, String addressLine2, String city,
            String region, String postalCode, String formattedAddress, Double latitude,
            Double longitude, boolean clearCoordinates) {
    }

    public record BranchCommand(String locationName, String phone, Boolean primary,
            Boolean active, String timezone, AddressCommand address) {
    }

    public record HourCommand(int dayOfWeek, LocalTime openTime, LocalTime closeTime,
            boolean closed) {
    }

    private record BranchRow(BranchView branch) {
    }

    private static BranchRow branch(ResultSet rs, int rowNum) throws SQLException {
        var address = new AddressView(rs.getString("address_line_1"),
                rs.getString("address_line_2"), rs.getString("city"),
                rs.getString("region"), rs.getString("postal_code"),
                rs.getString("formatted_address"),
                rs.getObject("discovery_lat", Double.class),
                rs.getObject("discovery_lon", Double.class));
        return new BranchRow(new BranchView(rs.getObject("id", UUID.class),
                rs.getObject("business_id", UUID.class),
                rs.getObject("address_id", UUID.class), rs.getString("location_name"),
                rs.getString("phone"), rs.getBoolean("is_primary"),
                rs.getBoolean("is_active"), rs.getString("timezone"), address, List.of()));
    }

    public List<BranchView> list(UUID viewer, UUID businessId) {
        var business = directory.requireViewable(viewer, businessId);
        boolean managed = directory.canManage(viewer, business);
        String active = managed ? "" : " AND bl.is_active";
        var rows = jdbc.query(SELECT + " WHERE bl.business_id=?" + active
                        + " ORDER BY bl.is_primary DESC,bl.created_at,bl.id",
                BusinessBranchService::branch, businessId);
        if (rows.isEmpty()) {
            return List.of();
        }
        var ids = rows.stream().map(r -> r.branch().id()).toList();
        String placeholders = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        Map<UUID, List<OpeningHourView>> hours = new HashMap<>();
        jdbc.query("SELECT business_location_id,day_of_week,open_time,close_time,is_closed"
                        + " FROM business_hours WHERE business_location_id IN (" + placeholders + ")"
                        + " ORDER BY business_location_id,day_of_week",
                rs -> {
                    UUID id = rs.getObject("business_location_id", UUID.class);
                    Time open = rs.getTime("open_time");
                    Time close = rs.getTime("close_time");
                    hours.computeIfAbsent(id, ignored -> new ArrayList<>()).add(
                            new OpeningHourView(rs.getInt("day_of_week"),
                                    open == null ? null : open.toLocalTime(),
                                    close == null ? null : close.toLocalTime(),
                                    rs.getBoolean("is_closed")));
                }, ids.toArray());
        return rows.stream().map(r -> {
            var b = r.branch();
            return new BranchView(b.id(), b.businessId(), b.addressId(), b.locationName(),
                    b.phone(), b.primary(), b.active(), b.timezone(), b.address(),
                    hours.getOrDefault(b.id(), List.of()));
        }).toList();
    }

    @Transactional
    public BranchView create(UUID actor, UUID businessId, BranchCommand command) {
        var business = directory.requireManaged(actor, businessId);
        if (command.address() == null) {
            throw bad("ADDRESS_REQUIRED");
        }
        String timezone = timezone(command.timezone());
        validatePhone(command.phone());
        validateAddress(command.address(), true);
        UUID id = UUID.randomUUID();
        UUID addressId = UUID.randomUUID();
        insertAddress(actor, business.countryId(), addressId, command.address());
        boolean primary = Boolean.TRUE.equals(command.primary())
                || jdbc.queryForObject("SELECT count(*) FROM business_locations"
                        + " WHERE business_id=?", Integer.class, businessId) == 0;
        if (primary) {
            jdbc.update("UPDATE business_locations SET is_primary=false,updated_at=now()"
                    + " WHERE business_id=?", businessId);
        }
        boolean active = command.active() == null || command.active();
        jdbc.update("INSERT INTO business_locations(id,business_id,address_id,location_name,"
                        + "phone,is_primary,is_active,timezone) VALUES(?,?,?,?,?,?,?,?)",
                id, businessId, addressId, BusinessDirectoryService.clean(command.locationName()),
                BusinessDirectoryService.clean(command.phone()), primary, active, timezone);
        audit(actor, "BUSINESS_BRANCH_CREATED", "BUSINESS_LOCATION", id);
        return list(actor, businessId).stream().filter(b -> b.id().equals(id)).findFirst()
                .orElseThrow();
    }

    @Transactional
    public BranchView update(UUID actor, UUID businessId, UUID locationId,
            BranchCommand command) {
        var current = requireManagedBranch(actor, businessId, locationId);
        String timezone = command.timezone() == null ? current.timezone()
                : timezone(command.timezone());
        String phone = command.phone() == null ? current.phone()
                : BusinessDirectoryService.clean(command.phone());
        validatePhone(phone);
        boolean active = command.active() == null ? current.active() : command.active();
        boolean primary = command.primary() == null ? current.primary() : command.primary();
        if (!active) {
            primary = false;
        }
        if (primary) {
            jdbc.update("UPDATE business_locations SET is_primary=false,updated_at=now()"
                    + " WHERE business_id=? AND id<>?", businessId, locationId);
        }
        jdbc.update("UPDATE business_locations SET location_name=?,phone=?,is_primary=?,"
                        + "is_active=?,timezone=?,updated_at=now() WHERE id=?",
                command.locationName() == null ? current.locationName()
                        : BusinessDirectoryService.clean(command.locationName()),
                phone, primary, active, timezone, locationId);
        if (command.address() != null) {
            updateAddress(current.addressId(), current.address(), command.address());
        }
        audit(actor, "BUSINESS_BRANCH_UPDATED", "BUSINESS_LOCATION", locationId);
        return list(actor, businessId).stream().filter(b -> b.id().equals(locationId))
                .findFirst().orElseThrow();
    }

    @Transactional
    public void deactivate(UUID actor, UUID businessId, UUID locationId) {
        var current = requireManagedBranch(actor, businessId, locationId);
        jdbc.update("UPDATE business_locations SET is_active=false,is_primary=false,"
                + "updated_at=now() WHERE id=?", locationId);
        if (current.primary()) {
            jdbc.update("UPDATE business_locations SET is_primary=true,updated_at=now()"
                    + " WHERE id=(SELECT id FROM business_locations WHERE business_id=?"
                    + " AND is_active ORDER BY created_at,id LIMIT 1)", businessId);
        }
        audit(actor, "BUSINESS_BRANCH_DEACTIVATED", "BUSINESS_LOCATION", locationId);
    }

    @Transactional
    public List<OpeningHourView> replaceHours(UUID actor, UUID businessId,
            UUID locationId, List<HourCommand> commands) {
        requireManagedBranch(actor, businessId, locationId);
        if (commands == null || commands.size() > 7) {
            throw bad("INVALID_OPENING_HOURS");
        }
        Set<Integer> days = new HashSet<>();
        for (var hour : commands) {
            if (hour.dayOfWeek() < 1 || hour.dayOfWeek() > 7 || !days.add(hour.dayOfWeek())) {
                throw bad("INVALID_DAY_OF_WEEK");
            }
            if (!hour.closed() && (hour.openTime() == null || hour.closeTime() == null)) {
                throw bad("OPEN_CLOSE_TIME_REQUIRED");
            }
        }
        jdbc.update("DELETE FROM business_hours WHERE business_location_id=?", locationId);
        for (var hour : commands) {
            jdbc.update("INSERT INTO business_hours(business_location_id,day_of_week,"
                            + "open_time,close_time,is_closed) VALUES(?,?,?,?,?)",
                    locationId, hour.dayOfWeek(),
                    hour.closed() ? null : Time.valueOf(hour.openTime()),
                    hour.closed() ? null : Time.valueOf(hour.closeTime()), hour.closed());
        }
        audit(actor, "BUSINESS_HOURS_UPDATED", "BUSINESS_LOCATION", locationId);
        return jdbc.query("SELECT day_of_week,open_time,close_time,is_closed"
                        + " FROM business_hours WHERE business_location_id=? ORDER BY day_of_week",
                (rs, i) -> new OpeningHourView(rs.getInt("day_of_week"),
                        rs.getTime("open_time") == null ? null
                                : rs.getTime("open_time").toLocalTime(),
                        rs.getTime("close_time") == null ? null
                                : rs.getTime("close_time").toLocalTime(),
                        rs.getBoolean("is_closed")), locationId);
    }

    private BranchView requireManagedBranch(UUID actor, UUID businessId, UUID locationId) {
        directory.requireManaged(actor, businessId);
        return jdbc.query(SELECT + " WHERE bl.id=? AND bl.business_id=? FOR UPDATE OF bl",
                BusinessBranchService::branch, locationId, businessId).stream().findFirst()
                .map(BranchRow::branch).orElseThrow(() -> notFound("BRANCH_NOT_FOUND"));
    }

    private void insertAddress(UUID actor, UUID countryId, UUID id, AddressCommand a) {
        jdbc.update("INSERT INTO addresses(id,country_id,address_line_1,address_line_2,city,"
                        + "region,postal_code,formatted_address,latitude,longitude,"
                        + "discovery_location,visibility,owner_user_id) VALUES(?,?,?,?,?,?,?,?,?,"
                        + "?,ST_SetSRID(ST_MakePoint(?,?),4326)::geography,'PUBLIC',?)",
                id, countryId, clean(a.addressLine1()), clean(a.addressLine2()), clean(a.city()),
                clean(a.region()), clean(a.postalCode()), clean(a.formattedAddress()),
                a.latitude(), a.longitude(), a.longitude(), a.latitude(), actor);
    }

    private void updateAddress(UUID addressId, AddressView current, AddressCommand a) {
        validateAddress(a, false);
        jdbc.update("UPDATE addresses SET address_line_1=?,address_line_2=?,city=?,region=?,"
                        + "postal_code=?,formatted_address=?,updated_at=now() WHERE id=?",
                a.addressLine1() == null ? current.addressLine1() : clean(a.addressLine1()),
                a.addressLine2() == null ? current.addressLine2() : clean(a.addressLine2()),
                a.city() == null ? current.city() : clean(a.city()),
                a.region() == null ? current.region() : clean(a.region()),
                a.postalCode() == null ? current.postalCode() : clean(a.postalCode()),
                a.formattedAddress() == null ? current.formattedAddress()
                        : clean(a.formattedAddress()), addressId);
        if (a.clearCoordinates()) {
            jdbc.update("UPDATE addresses SET latitude=NULL,longitude=NULL,"
                    + "discovery_location=NULL,updated_at=now() WHERE id=?", addressId);
        } else if (a.latitude() != null || a.longitude() != null) {
            if (a.latitude() == null || a.longitude() == null) {
                throw bad("COORDINATES_REQUIRED");
            }
            jdbc.update("UPDATE addresses SET latitude=?,longitude=?,discovery_location="
                            + "ST_SetSRID(ST_MakePoint(?,?),4326)::geography,updated_at=now()"
                            + " WHERE id=?", a.latitude(), a.longitude(), a.longitude(),
                    a.latitude(), addressId);
        }
    }

    private static void validateAddress(AddressCommand a, boolean creating) {
        if (creating && clean(a.addressLine1()) == null && clean(a.city()) == null
                && clean(a.formattedAddress()) == null) {
            throw bad("ADDRESS_REQUIRED");
        }
        validateLength(a.addressLine1(), 240, "ADDRESS_LINE_INVALID");
        validateLength(a.addressLine2(), 240, "ADDRESS_LINE_INVALID");
        validateLength(a.city(), 120, "CITY_INVALID");
        validateLength(a.region(), 120, "REGION_INVALID");
        validateLength(a.postalCode(), 40, "POSTAL_CODE_INVALID");
        validateLength(a.formattedAddress(), 1000, "ADDRESS_INVALID");
        if (a.latitude() != null && (a.latitude() < -90 || a.latitude() > 90)
                || a.longitude() != null && (a.longitude() < -180 || a.longitude() > 180)) {
            throw bad("INVALID_COORDINATES");
        }
        if (!a.clearCoordinates() && (a.latitude() == null) != (a.longitude() == null)
                && creating) {
            throw bad("COORDINATES_REQUIRED");
        }
        if (a.clearCoordinates() && (a.latitude() != null || a.longitude() != null)) {
            throw bad("COORDINATES_CONFLICT");
        }
    }

    private static void validateLength(String value, int max, String code) {
        if (value != null && value.trim().length() > max) {
            throw bad(code);
        }
    }

    private static String timezone(String value) {
        String timezone = value == null || value.isBlank() ? "UTC" : value.trim();
        try {
            ZoneId.of(timezone);
            return timezone;
        } catch (RuntimeException e) {
            throw bad("INVALID_TIMEZONE");
        }
    }

    private static void validatePhone(String phone) {
        if (phone != null && !phone.isBlank() && !PHONE.matcher(phone.trim()).matches()) {
            throw bad("PHONE_INVALID");
        }
    }

    private static String clean(String value) {
        return BusinessDirectoryService.clean(value);
    }
}
