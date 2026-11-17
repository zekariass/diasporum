package com.diasporum.backend.sparebag.internal.application.v2;

import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.bad;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.conflict;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.forbidden;
import static com.diasporum.backend.sparebag.internal.application.v2.SpareBagV2Support.notFound;

import com.diasporum.backend.notifications.NotificationsApi;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Page;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.RegularRoute;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.TravellerProfile;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.TravellerProfileInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagV2Types.TravellerProfileView;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.JourneyRepository;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2.TravellerProfileRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reusable traveller profile (one per user) and its verification flow.
 *
 * <p>{@code status}: ACTIVE &lt;-&gt; PAUSED (owner), ACTIVE/PAUSED -&gt; CLOSED
 * (owner, terminal; closes the profile's open journeys). SUSPENDED is reserved
 * for admins and not set here.
 *
 * <p>{@code verification_status} (independent of status):
 * NOT_VERIFIED/REJECTED/REVOKED -&gt; PENDING (owner submit, profile ACTIVE);
 * PENDING -&gt; VERIFIED | REJECTED, VERIFIED -&gt; REVOKED (platform admin).
 * Verification is a trust badge only - it does not gate publishing.
 */
@Service
public class TravellerProfileService {

    private static final int MAX_ROUTES = 20;

    private final TravellerProfileRepository profiles;
    private final JourneyRepository journeys;
    private final SpareBagReferenceService reference;
    private final SpareBagModeration moderation;
    private final SpareBagOwners owners;
    private final NotificationsApi notifications;

    public TravellerProfileService(TravellerProfileRepository profiles,
            JourneyRepository journeys, SpareBagReferenceService reference,
            SpareBagModeration moderation, SpareBagOwners owners,
            NotificationsApi notifications) {
        this.profiles = profiles;
        this.journeys = journeys;
        this.reference = reference;
        this.moderation = moderation;
        this.owners = owners;
        this.notifications = notifications;
    }

    @Transactional(readOnly = true)
    public TravellerProfileView mine(UUID actor) {
        return view(actor, profiles.byUser(actor)
                .orElseThrow(() -> notFound("TRAVELLER_PROFILE_NOT_FOUND")));
    }

    @Transactional(readOnly = true)
    public TravellerProfileView detail(UUID actor, UUID profileId) {
        TravellerProfile p = profiles.find(profileId)
                .orElseThrow(() -> notFound("TRAVELLER_PROFILE_NOT_FOUND"));
        if (!p.userId().equals(actor) && !"ACTIVE".equals(p.status())
                && !"PAUSED".equals(p.status())) {
            throw notFound("TRAVELLER_PROFILE_NOT_FOUND");
        }
        return view(actor, p);
    }

    /** Creates or updates the caller's profile. */
    @Transactional
    public TravellerProfileView upsert(UUID actor, TravellerProfileInput in) {
        String displayName = SpareBagV2Support.trimToNull(in.displayName());
        String bio = SpareBagV2Support.trimToNull(in.bio());
        List<String> categories = reference.validCategories(in.acceptedItemCategories());
        List<RegularRoute> routes = validRoutes(in.regularRoutes());
        try {
            var existing = profiles.byUserForUpdate(actor);
            if (existing.isEmpty()) {
                profiles.insertIfAbsent(actor, displayName, bio, categories, routes);
            } else {
                TravellerProfile p = existing.get();
                if ("CLOSED".equals(p.status())) throw conflict("TRAVELLER_PROFILE_CLOSED");
                if ("SUSPENDED".equals(p.status())) {
                    throw forbidden("TRAVELLER_PROFILE_SUSPENDED");
                }
                profiles.update(p.id(), displayName, bio, categories, routes);
            }
        } catch (DataIntegrityViolationException e) {
            throw SpareBagV2Support.translate(e, "TRAVELLER_PROFILE_INVALID");
        }
        return mine(actor);
    }

    @Transactional
    public TravellerProfileView pause(UUID actor) {
        return setStatus(actor, Set.of("ACTIVE"), "PAUSED");
    }

    @Transactional
    public TravellerProfileView activate(UUID actor) {
        return setStatus(actor, Set.of("PAUSED"), "ACTIVE");
    }

    @Transactional
    public TravellerProfileView close(UUID actor) {
        TravellerProfileView view = setStatus(actor, Set.of("ACTIVE", "PAUSED"), "CLOSED");
        journeys.closeOpenForProfile(view.profile().id());
        return view;
    }

    @Transactional
    public TravellerProfileView submitVerification(UUID actor) {
        TravellerProfile p = profiles.byUserForUpdate(actor)
                .orElseThrow(() -> notFound("TRAVELLER_PROFILE_NOT_FOUND"));
        if (!"ACTIVE".equals(p.status())) {
            throw conflict("TRAVELLER_PROFILE_NOT_ACTIVE");
        }
        if (profiles.setVerification(p.id(), Set.of("NOT_VERIFIED", "REJECTED", "REVOKED"),
                "PENDING") == 0) {
            throw conflict("VERIFICATION_NOT_SUBMITTABLE");
        }
        return mine(actor);
    }

    // =================== admin ===================

    @Transactional(readOnly = true)
    public Page<TravellerProfileView> pendingVerifications(UUID actor, String cursor,
            Integer size) {
        moderation.requirePlatformAdmin(actor);
        int limit = SpareBagV2Support.pageSize(size);
        var c = SpareBagV2Support.decode(cursor);
        List<TravellerProfile> rows = profiles.pendingVerifications(
                SpareBagV2Support.cursorInstant(c), c == null ? null : c.id(), limit + 1);
        String next = null;
        if (rows.size() > limit) {
            rows = rows.subList(0, limit);
            TravellerProfile last = rows.get(limit - 1);
            next = SpareBagV2Support.cursor(last.updatedAt(), last.id());
        }
        List<TravellerProfileView> items = new ArrayList<>();
        for (TravellerProfile p : rows) {
            items.add(view(actor, p));
        }
        return new Page<>(items, next);
    }

    @Transactional
    public TravellerProfileView decideVerification(UUID actor, UUID profileId,
            String decision, String reason) {
        moderation.requirePlatformAdmin(actor);
        String d = SpareBagV2Support.upper(decision);
        String why = SpareBagV2Support.trimToNull(reason);
        Set<String> from;
        String actionType;
        switch (d == null ? "" : d) {
            case "VERIFIED" -> {
                from = Set.of("PENDING");
                actionType = "APPROVE_CONTENT";
            }
            case "REJECTED" -> {
                from = Set.of("PENDING");
                actionType = "REJECT_LISTING";
            }
            case "REVOKED" -> {
                from = Set.of("VERIFIED");
                actionType = "REVOKE_VERIFICATION";
            }
            default -> throw bad("INVALID_VERIFICATION_DECISION");
        }
        if (!"VERIFIED".equals(d) && why == null) {
            throw bad("VERIFICATION_REASON_REQUIRED");
        }
        TravellerProfile p = profiles.findForUpdate(profileId)
                .orElseThrow(() -> notFound("TRAVELLER_PROFILE_NOT_FOUND"));
        if (p.userId().equals(actor)) {
            throw forbidden("CANNOT_VERIFY_OWN_PROFILE");
        }
        if (profiles.setVerification(p.id(), from, d) == 0) {
            throw conflict("INVALID_VERIFICATION_TRANSITION");
        }
        moderation.recordVerification(actor, p.userId(), p.id(), d, actionType, why);
        notifications.notify(p.userId(), "SPARE_BAG_LISTING_UPDATE",
                "Traveller verification " + d.toLowerCase(),
                why == null ? "Your Spare Bag traveller profile is now verified." : why,
                "SPARE_BAG_TRAVELLER_PROFILE", p.id(),
                "spare-bag-traveller-verification:" + p.id() + ":" + UUID.randomUUID());
        return view(actor, profiles.find(p.id()).orElseThrow());
    }

    // =================== shared ===================

    /** The actor's profile, which must be ACTIVE to post or match journeys. */
    public TravellerProfile requireActiveProfile(UUID actor) {
        TravellerProfile p = profiles.byUser(actor)
                .orElseThrow(() -> conflict("TRAVELLER_PROFILE_REQUIRED"));
        if (!"ACTIVE".equals(p.status())) {
            throw conflict("TRAVELLER_PROFILE_NOT_ACTIVE");
        }
        return p;
    }

    private TravellerProfileView setStatus(UUID actor, Set<String> from, String to) {
        TravellerProfile p = profiles.byUserForUpdate(actor)
                .orElseThrow(() -> notFound("TRAVELLER_PROFILE_NOT_FOUND"));
        if (profiles.setStatus(p.id(), from, to) == 0) {
            throw conflict("INVALID_PROFILE_TRANSITION");
        }
        return mine(actor);
    }

    private List<RegularRoute> validRoutes(List<RegularRoute> routes) {
        if (routes == null) {
            return null;
        }
        if (routes.size() > MAX_ROUTES) {
            throw bad("TOO_MANY_ROUTES");
        }
        for (RegularRoute r : routes) {
            if (r == null || r.fromCountryId() == null || r.toCountryId() == null) {
                throw bad("INVALID_ROUTE");
            }
            reference.requireActiveCountry(r.fromCountryId());
            reference.requireActiveCountry(r.toCountryId());
        }
        return routes;
    }

    private TravellerProfileView view(UUID actor, TravellerProfile p) {
        return new TravellerProfileView(p, owners.owner(p.userId()), p.verified(),
                p.userId().equals(actor));
    }
}
