package com.diasporum.backend.businessaccounts.internal.api.rest;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService;
import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService.AuditEventView;
import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService.BusinessAccountView;
import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService.BusinessWorkspaceView;
import com.diasporum.backend.businessaccounts.internal.application.BusinessBillingService;
import com.diasporum.backend.businessaccounts.internal.application.BusinessBillingService.BusinessBillingView;
import com.diasporum.backend.businessaccounts.internal.application.BusinessListingService;
import com.diasporum.backend.businessaccounts.internal.application.BusinessListingService.BusinessListingsView;
import com.diasporum.backend.businessaccounts.internal.application.BusinessListingService.BusinessOverviewView;
import com.diasporum.backend.businessaccounts.internal.application.BusinessTeamService;
import com.diasporum.backend.businessaccounts.internal.application.BusinessTeamService.MemberView;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Authenticated business workspace endpoints; no separate business identity. */
@RestController
@RequestMapping("/api/v1/business-accounts")
public class BusinessAccountController {

    private final BusinessAccountService service;
    private final BusinessTeamService team;
    private final BusinessBillingService billing;
    private final BusinessListingService listings;

    public BusinessAccountController(BusinessAccountService service,
            BusinessTeamService team, BusinessBillingService billing,
            BusinessListingService listings) {
        this.service = service;
        this.team = team;
        this.billing = billing;
        this.listings = listings;
    }

    @GetMapping
    public Map<String, Object> accounts(
            @AuthenticationPrincipal DiasporumUserPrincipal principal) {
        return Map.of("items", service.accountsOf(principal.userId()));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public BusinessAccountView create(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody CreateBusinessAccountRequest request) {
        return service.create(principal.userId(), request.accountName(),
                request.idempotencyKey());
    }

    @GetMapping("/{accountId}/workspace")
    public BusinessWorkspaceView workspace(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId) {
        return service.workspace(principal.userId(), accountId);
    }

    @PatchMapping("/{accountId}")
    public BusinessWorkspaceView rename(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId,
            @Valid @RequestBody RenameBusinessAccountRequest request) {
        return service.rename(principal.userId(), accountId, request.accountName());
    }

    @PostMapping("/{accountId}/close")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void close(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId,
            @Valid @RequestBody(required = false) CloseBusinessAccountRequest request) {
        service.close(principal.userId(), accountId,
                request == null ? null : request.reason());
    }

    @GetMapping("/{accountId}/audit-events")
    public Map<String, Object> auditEvents(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId) {
        List<AuditEventView> events = service.auditEvents(principal.userId(), accountId);
        return Map.of("items", events);
    }

    // ------------------------------------------------------------- team

    @GetMapping("/{accountId}/members")
    public Map<String, Object> members(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId) {
        return Map.of("items", team.members(principal.userId(), accountId));
    }

    @PostMapping("/{accountId}/invitations")
    @ResponseStatus(HttpStatus.CREATED)
    public MemberView invite(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId,
            @Valid @RequestBody InviteMemberRequest request) {
        return team.invite(principal.userId(), accountId, request.username(),
                request.role(), request.expiresInDays());
    }

    @DeleteMapping("/{accountId}/invitations/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revokeInvitation(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId, @PathVariable UUID userId) {
        team.revokeInvitation(principal.userId(), accountId, userId);
    }

    @PatchMapping("/{accountId}/members/{userId}")
    public MemberView changeRole(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId, @PathVariable UUID userId,
            @Valid @RequestBody ChangeRoleRequest request) {
        return team.changeRole(principal.userId(), accountId, userId, request.role());
    }

    @DeleteMapping("/{accountId}/members/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revokeMember(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId, @PathVariable UUID userId) {
        team.revokeMember(principal.userId(), accountId, userId);
    }

    @PostMapping("/{accountId}/transfer-ownership")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void transferOwnership(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId,
            @Valid @RequestBody TransferOwnershipRequest request) {
        team.transferOwnership(principal.userId(), accountId, request.newOwnerUserId());
    }

    // -------------------------------------------------- billing & listings

    @GetMapping("/{accountId}/billing")
    public BusinessBillingView billing(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId) {
        return billing.billing(principal.userId(), accountId);
    }

    @GetMapping("/{accountId}/listings")
    public BusinessListingsView listings(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId) {
        return listings.listings(principal.userId(), accountId);
    }

    @GetMapping("/{accountId}/overview")
    public BusinessOverviewView overview(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId,
            @RequestParam(defaultValue = "30") int days) {
        return listings.overview(principal.userId(), accountId, days);
    }

    // -------------------------------------------------------------- bodies

    public record CreateBusinessAccountRequest(
            @NotBlank @Size(max = 180) String accountName,
            @Size(max = 120) String idempotencyKey) {
    }

    public record RenameBusinessAccountRequest(
            @NotBlank @Size(max = 180) String accountName) {
    }

    public record CloseBusinessAccountRequest(@Size(max = 500) String reason) {
    }

    public record InviteMemberRequest(
            @NotBlank @Size(max = 60) String username,
            @NotBlank @Size(max = 30) String role,
            @Min(1) @Max(90) Integer expiresInDays) {
    }

    public record ChangeRoleRequest(@NotBlank @Size(max = 30) String role) {
    }

    public record TransferOwnershipRequest(@NotNull UUID newOwnerUserId) {
    }
}
