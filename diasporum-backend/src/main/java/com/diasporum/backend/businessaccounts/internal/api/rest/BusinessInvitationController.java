package com.diasporum.backend.businessaccounts.internal.api.rest;

import com.diasporum.backend.businessaccounts.internal.application.BusinessTeamService;
import com.diasporum.backend.businessaccounts.internal.application.BusinessTeamService.MemberView;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The invitee-side inbox for Business Account invitations. */
@RestController
@RequestMapping("/api/v1/me/business-invitations")
public class BusinessInvitationController {

    private final BusinessTeamService team;

    public BusinessInvitationController(BusinessTeamService team) {
        this.team = team;
    }

    @GetMapping
    public Map<String, Object> invitations(
            @AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return Map.of("items", team.invitationsOf(principal.userId()));
    }

    @PostMapping("/{accountId}/accept")
    public MemberView accept(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId) {
        return team.accept(principal.userId(), accountId);
    }

    @PostMapping("/{accountId}/decline")
    public Map<String, Object> decline(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId) {
        team.decline(principal.userId(), accountId);
        return Map.of("declined", true);
    }
}
