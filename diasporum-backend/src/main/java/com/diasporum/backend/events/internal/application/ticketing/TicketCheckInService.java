package com.diasporum.backend.events.internal.application.ticketing;

import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.bad;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.forbidden;

import com.diasporum.backend.events.internal.application.ticketing.TicketingAccess.TicketedEvent;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Door scanning. Every attempt against a known ticket is logged in
 * {@code ticket_check_ins} with its scan_result — a re-scan is a recorded
 * ALREADY_CHECKED_IN result, not an error. The VALID → CHECKED_IN flip is one
 * conditional UPDATE, so two scanners racing on the same ticket produce exactly
 * one VALID. Offline batches are applied in device scan order (earliest wins).
 * Unknown codes return INVALID but cannot be logged (issued_ticket_id is NOT NULL).
 */
@Service
public class TicketCheckInService {

    private static final String FIND = "SELECT id,event_id,status FROM issued_tickets"
            + " WHERE qr_payload=? OR ticket_code=? LIMIT 1";
    private static final String CHECK_IN = "UPDATE issued_tickets SET status='CHECKED_IN',"
            + "checked_in_at=?,checked_in_by_user_id=?,updated_at=now() WHERE id=? AND status='VALID'";
    private static final String LOG = "INSERT INTO ticket_check_ins(issued_ticket_id,"
            + "scanned_by_user_id,scan_result,scanned_at,device_id,latitude,longitude,"
            + "is_offline_scan,synced_at,notes) VALUES(?,?,?,?,?,?,?,?,?,?)";

    private final JdbcTemplate jdbc;
    private final TicketingAccess access;

    public TicketCheckInService(JdbcTemplate jdbc, TicketingAccess access) {
        this.jdbc = jdbc;
        this.access = access;
    }

    public record Scan(String qrPayload, String ticketCode, UUID eventId, String deviceId,
            BigDecimal latitude, BigDecimal longitude, Instant scannedAt, String notes) {
    }

    public record ScanResult(String scanResult, UUID ticketId, UUID eventId, String ticketCode,
            String holderName, String ticketTypeName, Instant checkedInAt, boolean logged) {
    }

    @Transactional
    public ScanResult checkIn(UUID actor, Scan scan) {
        return apply(actor, scan, false);
    }

    /** Offline scanner sync: applied in scannedAt order; each scan logged with synced_at. */
    @Transactional
    public List<ScanResult> syncOffline(UUID actor, List<Scan> scans) {
        if (scans == null || scans.isEmpty() || scans.size() > 500) {
            throw bad("SCAN_BATCH_INVALID");
        }
        List<Scan> ordered = new ArrayList<>(scans);
        ordered.sort(Comparator.comparing(s -> s.scannedAt() == null ? Instant.now() : s.scannedAt()));
        List<ScanResult> out = new ArrayList<>();
        for (Scan s : ordered) {
            out.add(apply(actor, s, true));
        }
        return out;
    }

    private ScanResult apply(UUID actor, Scan scan, boolean offline) {
        String code = scan.qrPayload() != null && !scan.qrPayload().isBlank() ? scan.qrPayload().trim()
                : scan.ticketCode() == null ? null : scan.ticketCode().trim();
        if (code == null || code.isEmpty()) {
            throw bad("TICKET_CODE_REQUIRED");
        }
        Object[] ticket = jdbc.query(FIND, rs -> rs.next() ? new Object[]{rs.getObject(1, UUID.class),
            rs.getObject(2, UUID.class), rs.getString(3)} : null, code, code.toUpperCase());
        if (ticket == null) {
            if (scan.eventId() != null) {
                access.requireManager(actor, scan.eventId());
            }
            return new ScanResult("INVALID", null, scan.eventId(), null, null, null, null, false);
        }
        UUID ticketId = (UUID) ticket[0];
        UUID eventId = (UUID) ticket[1];
        TicketedEvent e = access.requireEvent(eventId);
        if (!access.canManage(actor, e) && !access.isPlatformAdmin(actor)) {
            throw forbidden("NOT_EVENT_ORGANIZER");
        }
        Instant scannedAt = offline && scan.scannedAt() != null ? scan.scannedAt() : Instant.now();
        String result;
        if (scan.eventId() != null && !scan.eventId().equals(eventId)) {
            result = "INVALID"; // valid ticket presented at the wrong event
        } else if (jdbc.update(CHECK_IN, Timestamp.from(scannedAt), actor, ticketId) == 1) {
            result = "VALID";
        } else {
            String status = jdbc.queryForObject("SELECT status FROM issued_tickets WHERE id=?",
                    String.class, ticketId);
            result = switch (status) {
                case "CHECKED_IN" -> "ALREADY_CHECKED_IN";
                case "REFUNDED", "CANCELLED", "EXPIRED", "TRANSFERRED" -> status;
                default -> "INVALID";
            };
        }
        jdbc.update(LOG, ticketId, actor, result, Timestamp.from(scannedAt), scan.deviceId(),
                scan.latitude(), scan.longitude(), offline, offline ? Timestamp.from(Instant.now()) : null,
                scan.notes());
        var details = jdbc.queryForMap("SELECT t.ticket_code,t.holder_name,t.checked_in_at,"
                + "tt.name FROM issued_tickets t JOIN event_ticket_types tt ON tt.id=t.ticket_type_id"
                + " WHERE t.id=?", ticketId);
        Timestamp checkedIn = (Timestamp) details.get("checked_in_at");
        return new ScanResult(result, ticketId, eventId, (String) details.get("ticket_code"),
                (String) details.get("holder_name"), (String) details.get("name"),
                checkedIn == null ? null : checkedIn.toInstant(), true);
    }
}
