package com.diasporum.backend.businessaccounts.internal.api.rest;

import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService;
import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService.BusinessAccountView;
import com.diasporum.backend.businessaccounts.internal.application.BusinessAccountService.BusinessWorkspaceView;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Authenticated business workspace endpoints; no separate business identity. */
@RestController
@RequestMapping("/api/v1/business-accounts")
public class BusinessAccountController {

    private final BusinessAccountService service;

    public BusinessAccountController(BusinessAccountService service) {
        this.service = service;
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
        return service.create(principal.userId(), request.accountName());
    }

    @GetMapping("/{accountId}/workspace")
    public BusinessWorkspaceView workspace(
            @AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID accountId) {
        return service.workspace(principal.userId(), accountId);
    }

    public record CreateBusinessAccountRequest(
            @NotBlank @Size(max = 180) String accountName) {
    }
}
