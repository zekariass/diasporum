package com.diasporum.backend.events.internal.api.rest;

import com.diasporum.backend.events.internal.application.ticketing.TicketCheckInService;
import com.diasporum.backend.events.internal.application.ticketing.TicketCheckInService.Scan;
import com.diasporum.backend.events.internal.application.ticketing.TicketCheckInService.ScanResult;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Door scanning (organiser/staff). Every result — including re-scans — is a 200 with scanResult. */
@RestController
@RequestMapping("/api/v1/tickets")
public class TicketCheckInController {

    private final TicketCheckInService checkIns;

    public TicketCheckInController(TicketCheckInService checkIns) {
        this.checkIns = checkIns;
    }

    public record BatchRequest(@NotEmpty @Size(max = 500) List<Scan> scans) {
    }

    @PostMapping("/check-in")
    public ScanResult checkIn(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestBody Scan body) {
        return checkIns.checkIn(p.userId(), body);
    }

    /** Offline scanner sync: scans carry their device scannedAt and are logged is_offline_scan. */
    @PostMapping("/check-in/batch")
    public Map<String, List<ScanResult>> batch(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody BatchRequest body) {
        return Map.of("items", checkIns.syncOffline(p.userId(), body.scans()));
    }
}
