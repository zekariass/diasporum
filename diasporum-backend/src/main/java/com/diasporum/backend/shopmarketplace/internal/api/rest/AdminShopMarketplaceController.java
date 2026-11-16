package com.diasporum.backend.shopmarketplace.internal.api.rest;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.shopmarketplace.internal.application.MarketplaceAdminService;
import com.diasporum.backend.shopmarketplace.internal.application.MarketplaceAdminService.CommissionRuleInput;
import com.diasporum.backend.shopmarketplace.internal.application.MarketplaceAdminService.CommissionRuleView;
import com.diasporum.backend.shopmarketplace.internal.application.MarketplaceAdminService.MarketSetting;
import com.diasporum.backend.shopmarketplace.internal.application.MarketplaceAdminService.MarketUpdate;
import com.diasporum.backend.shopmarketplace.internal.application.MarketplaceAdminService.PendingSeller;
import com.diasporum.backend.shopmarketplace.internal.application.MarketplaceAdminService.PendingShop;
import com.diasporum.backend.shopmarketplace.internal.domain.ShopModels.Page;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Scoped marketplace administration: markets, seller/shop moderation, commission rules. */
@RestController
@RequestMapping("/api/v1/admin/shop")
public class AdminShopMarketplaceController {
    private final MarketplaceAdminService admin;

    public AdminShopMarketplaceController(MarketplaceAdminService admin) {
        this.admin = admin;
    }

    @GetMapping("/markets")
    public List<MarketSetting> markets(@AuthenticationPrincipal DiasporumUserPrincipal p) {
        return admin.markets(p.userId());
    }

    @PutMapping("/markets/{countryId}")
    public MarketSetting updateMarket(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID countryId, @RequestBody MarketUpdate body) {
        return admin.updateMarket(p.userId(), countryId, body);
    }

    @GetMapping("/shops/pending")
    public Page<PendingShop> pendingShops(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return admin.pendingShops(p.userId(), cursor, size);
    }

    public record ModerationBody(@NotBlank String action, @NotBlank @Size(max = 1000) String reason) {
    }

    @PostMapping("/shops/{shopId}/moderation")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void moderateShop(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID shopId, @Valid @RequestBody ModerationBody body) {
        admin.moderateShop(p.userId(), shopId, body.action(), body.reason());
    }

    @GetMapping("/sellers/pending")
    public Page<PendingSeller> pendingSellers(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer size) {
        return admin.pendingSellers(p.userId(), cursor, size);
    }

    @PostMapping("/sellers/{sellerId}/moderation")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void moderateSeller(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID sellerId, @Valid @RequestBody ModerationBody body) {
        admin.moderateSeller(p.userId(), sellerId, body.action(), body.reason());
    }

    @GetMapping("/commission-rules")
    public List<CommissionRuleView> commissionRules(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) UUID shopId,
            @RequestParam(required = false) UUID categoryId) {
        return admin.commissionRules(p.userId(), shopId, categoryId);
    }

    @PostMapping("/commission-rules")
    public CommissionRuleView createCommissionRule(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestBody CommissionRuleInput body) {
        return admin.createCommissionRule(p.userId(), body);
    }

    @PostMapping("/commission-rules/{ruleId}/deactivate")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deactivateRule(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID ruleId) {
        admin.deactivateCommissionRule(p.userId(), ruleId);
    }
}
