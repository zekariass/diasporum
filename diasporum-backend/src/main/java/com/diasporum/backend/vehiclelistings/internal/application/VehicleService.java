package com.diasporum.backend.vehiclelistings.internal.application;

import com.diasporum.backend.billing.BillingApi;
import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.identity.IdentityApi.ProfileSummary;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.messaging.MessagingApi;
import com.diasporum.backend.moderation.ModerationApi;
import com.diasporum.backend.social.SocialApi;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleCursor;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleInput;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleListing;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleMedia;
import com.diasporum.backend.vehiclelistings.internal.domain.VehiclePage;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleQueryResult;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleSearch;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleSeller;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleView;
import com.diasporum.backend.vehiclelistings.internal.infrastructure.persistence.VehicleRepository;
import com.diasporum.backend.vehiclelistings.internal.infrastructure.persistence.VehicleRepository.Attachment;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Vehicle lifecycle, authorization, discovery, collections and integrations. */
@Service
public class VehicleService {

    private static final int DEFAULT_PAGE = 20;
    private static final int MAX_PAGE = 50;
    private static final int MAX_MEDIA = 5;
    private static final Set<String> MANAGER_ROLES = Set.of("OWNER", "ADMINISTRATOR",
            "EDITOR", "LISTING_MANAGER");
    private static final Set<String> EDITABLE = Set.of("DRAFT", "PUBLISHED", "PAUSED", "EXPIRED");
    private static final Set<String> TERMINAL = Set.of("SOLD", "RENTED", "REMOVED");
    private static final Set<String> PURPOSES = Set.of("SALE", "RENT");
    private static final Set<String> VISIBILITIES = Set.of("COMMUNITY", "COUNTRY",
            "SELECTED_COMMUNITIES");
    private static final Set<String> MILEAGE_UNITS = Set.of("MILES", "KM");
    private static final Set<String> FUEL = Set.of("PETROL", "DIESEL", "ELECTRIC", "HYBRID",
            "PLUG_IN_HYBRID", "HYDROGEN", "OTHER", "UNKNOWN");
    private static final Set<String> TRANSMISSION = Set.of("MANUAL", "AUTOMATIC",
            "SEMI_AUTOMATIC", "OTHER", "UNKNOWN");
    private static final Set<String> DRIVE = Set.of("FWD", "RWD", "AWD", "FOUR_WD",
            "OTHER", "UNKNOWN");
    private static final Set<String> BODY = Set.of("HATCHBACK", "SALOON", "ESTATE", "SUV",
            "COUPE", "CONVERTIBLE", "MPV", "VAN", "PICKUP", "MOTORCYCLE", "MOTORHOME",
            "TRUCK", "OTHER", "UNKNOWN");
    private static final Set<String> CONDITION = Set.of("NEW", "EXCELLENT", "GOOD", "FAIR",
            "POOR", "UNSPECIFIED");
    private static final Set<String> SERVICE_HISTORY = Set.of("FULL", "PARTIAL", "NONE", "UNKNOWN");
    private static final Set<String> SORTS = Set.of("NEWEST", "PRICE_ASC", "PRICE_DESC", "DISTANCE");

    private final VehicleRepository repository;
    private final IdentityApi identity;
    private final CommunityApi community;
    private final TaxonomyApi taxonomy;
    private final MediaApi media;
    private final BusinessAccountsApi businesses;
    private final SocialApi social;
    private final MessagingApi messaging;
    private final BillingApi billing;
    private final ModerationApi moderation;
    private final VehiclePolicies policies;
    private final ObjectMapper mapper;

    public VehicleService(VehicleRepository repository, IdentityApi identity,
            CommunityApi community, TaxonomyApi taxonomy, MediaApi media,
            BusinessAccountsApi businesses, SocialApi social, MessagingApi messaging,
            BillingApi billing, ModerationApi moderation, VehiclePolicies policies,
            ObjectMapper mapper) {
        this.repository = repository;
        this.identity = identity;
        this.community = community;
        this.taxonomy = taxonomy;
        this.media = media;
        this.businesses = businesses;
        this.social = social;
        this.messaging = messaging;
        this.billing = billing;
        this.moderation = moderation;
        this.policies = policies;
        this.mapper = mapper;
    }

    @Transactional
    public VehicleView create(UUID actor, VehicleInput input) {
        ProfileSummary profile = requireActor(actor);
        requireManager(actor, input.businessAccountId());
        VehicleInput value = defaults(input);
        UUID country = requireCountry(profile.currentCountryId());
        validate(actor, country, value);
        UUID addressId = createAddress(actor, country, value.location());
        VehicleListing listing = new VehicleListing(UUID.randomUUID(), country,
                "COMMUNITY".equals(value.visibilityScope()) ? value.communityId() : null,
                input.businessAccountId() == null ? actor : null, input.businessAccountId(), actor,
                value.visibilityScope(), value.listingPurpose(), value.categoryId(), value.makeId(),
                value.modelId(), value.variantId(), null, null, null, null, null, value.title().trim(),
                value.description().trim(), value.modelYear(), value.mileage(), value.mileageUnit(),
                value.fuelType(), value.transmission(), value.driveType(), value.bodyType(),
                value.engineSizeCc(), trim(value.colour()), value.doors(), value.seats(), value.condition(),
                value.registrationYear(), value.previousOwners(), value.additionalAttributes(),
                value.motExpiry(), value.serviceHistory(), value.priceAmount(), value.currencyCode(),
                value.pricePeriod(), value.rentalDeposit(), value.mileageAllowance(),
                trim(value.rentalConditions()), addressId, "DRAFT", value.expiresAt(), null,
                Instant.now(), Instant.now(), false, null, null);
        repository.insert(listing);
        replaceJoins(listing.id(), value);
        return detail(actor, listing.id());
    }

    @Transactional
    public VehicleView update(UUID actor, UUID id, VehicleInput patch) {
        VehicleListing existing = requireManaged(actor, id, true);
        if (!EDITABLE.contains(existing.status())) throw conflict("VEHICLE_NOT_EDITABLE");
        VehicleInput value = merge(existing, patch);
        ProfileSummary profile = requireActor(actor);
        UUID country = requireCountry(profile.currentCountryId());
        if (!country.equals(existing.countryId())) throw forbidden("VEHICLE_COUNTRY_CHANGED");
        validate(actor, country, value);
        UUID addressId = patch.clearLocation() ? null : patch.location() != null
                ? createAddress(actor, country, patch.location()) : existing.addressId();
        VehicleListing updated = copyForUpdate(existing, value, country, addressId);
        repository.update(updated);
        replaceJoins(id, value);
        return detail(actor, id);
    }

    @Transactional
    public VehicleView publish(UUID actor, UUID id) {
        VehicleListing listing = lazyExpire(requireManaged(actor, id, true));
        if (!Set.of("DRAFT", "PAUSED", "EXPIRED").contains(listing.status())) {
            throw conflict("INVALID_VEHICLE_TRANSITION");
        }
        VehicleInput value = inputOf(listing);
        validate(actor, listing.countryId(), value);
        if (!hasGeneralLocation(listing)) throw bad("PUBLIC_LOCATION_REQUIRED");
        if (listing.expiresAt() != null && !listing.expiresAt().isAfter(Instant.now())) {
            throw bad("VEHICLE_EXPIRY_MUST_BE_FUTURE");
        }
        billing.consume(new BillingApi.ConsumptionCommand(listing.ownerUserId(),
                listing.businessAccountId(), "VEHICLE_LISTING_PUBLISH", 1,
                "VEHICLE_LISTING", id, "vehicle-publish:" + id));
        repository.transition(id, "PUBLISHED");
        return detail(actor, id);
    }

    @Transactional
    public VehicleView pause(UUID actor, UUID id) {
        VehicleListing listing = lazyExpire(requireManaged(actor, id, true));
        if (!"PUBLISHED".equals(listing.status())) throw conflict("INVALID_VEHICLE_TRANSITION");
        repository.transition(id, "PAUSED");
        return detail(actor, id);
    }

    @Transactional
    public VehicleView sold(UUID actor, UUID id) {
        return terminalSaleState(actor, id, "SALE", "SOLD");
    }

    @Transactional
    public VehicleView rented(UUID actor, UUID id) {
        return terminalSaleState(actor, id, "RENT", "RENTED");
    }

    private VehicleView terminalSaleState(UUID actor, UUID id, String purpose, String status) {
        VehicleListing listing = lazyExpire(requireManaged(actor, id, true));
        if (!purpose.equals(listing.listingPurpose())
                || !Set.of("PUBLISHED", "PAUSED").contains(listing.status())) {
            throw conflict("INVALID_VEHICLE_TRANSITION");
        }
        repository.transition(id, status);
        return detail(actor, id);
    }

    @Transactional
    public void remove(UUID actor, UUID id) {
        VehicleListing listing = lazyExpire(requireManaged(actor, id, true));
        if (TERMINAL.contains(listing.status())) throw conflict("INVALID_VEHICLE_TRANSITION");
        repository.transition(id, "REMOVED");
    }

    public VehicleView detail(UUID actor, UUID id) {
        VehicleListing listing = lazyExpire(repository.find(actor, id, false)
                .orElseThrow(VehicleService::notFound));
        boolean manager = canManage(actor, listing);
        if (!manager) requireViewable(actor, listing);
        return enrich(actor, List.of(listing), !manager, true).stream().findFirst()
                .orElseThrow(VehicleService::notFound);
    }

    public VehiclePage discover(UUID actor, VehicleSearch search, String cursor, int size) {
        int limit = pageSize(size);
        VehicleSearch value = validateSearch(search);
        ProfileSummary profile = requireActor(actor);
        String fingerprint = fingerprint(value.toString());
        VehicleCursor decoded = decode(cursor, value.sort(), fingerprint);
        var result = repository.discover(actor, profile.currentCountryId(), accessibleCommunities(actor),
                value, decoded, limit);
        return page(actor, result, value.sort(), fingerprint, true);
    }

    public VehiclePage owned(UUID actor, UUID businessFilter, String status,
            String cursor, int size) {
        int limit = pageSize(size);
        List<UUID> businessIds = manageableBusinessIds(actor);
        String normalizedStatus = status == null ? null : upper(status);
        if (normalizedStatus != null && !Set.of("DRAFT", "PUBLISHED", "PAUSED", "EXPIRED",
                "SOLD", "RENTED").contains(normalizedStatus)) throw bad("INVALID_VEHICLE_STATUS");
        String fingerprint = fingerprint((businessFilter == null ? "" : businessFilter)
                + "|" + normalizedStatus);
        VehicleCursor decoded = decode(cursor, "OWNED", fingerprint);
        var result = repository.owned(actor, businessIds, businessFilter, normalizedStatus,
                decoded, limit);
        return page(actor, result, "OWNED", fingerprint, false);
    }

    public VehiclePage saved(UUID actor, String cursor, int size) {
        int limit = pageSize(size);
        ProfileSummary profile = requireActor(actor);
        String fingerprint = fingerprint("SAVED");
        VehicleCursor decoded = decode(cursor, "SAVED", fingerprint);
        var result = repository.saved(actor, profile.currentCountryId(), accessibleCommunities(actor),
                decoded, limit);
        return page(actor, result, "SAVED", fingerprint, true);
    }

    @Transactional
    public void save(UUID actor, UUID id) {
        requireViewable(actor, lazyExpire(repository.find(actor, id, false)
                .orElseThrow(VehicleService::notFound)));
        repository.save(actor, id);
    }

    public void unsave(UUID actor, UUID id) {
        repository.unsave(actor, id);
    }

    @Transactional
    public VehicleView replaceMedia(UUID actor, UUID id, List<UUID> mediaIds, UUID coverMediaId) {
        VehicleListing listing = requireManaged(actor, id, true);
        if (!EDITABLE.contains(listing.status())) throw conflict("VEHICLE_NOT_EDITABLE");
        List<UUID> ids = mediaIds == null ? List.of() : mediaIds;
        if (ids.size() > MAX_MEDIA || ids.stream().anyMatch(Objects::isNull)
                || new LinkedHashSet<>(ids).size() != ids.size()) throw bad("INVALID_VEHICLE_MEDIA");
        Set<UUID> existing = repository.attachments(id).stream().map(Attachment::mediaId)
                .collect(Collectors.toSet());
        var assets = media.assets(ids).stream().collect(Collectors.toMap(MediaApi.AssetView::id,
                Function.identity()));
        if (assets.size() != ids.size()) throw bad("VEHICLE_MEDIA_NOT_FOUND");
        for (UUID mediaId : ids) {
            var asset = assets.get(mediaId);
            if (!"READY".equals(asset.status()) || !"VEHICLE".equals(asset.purpose())
                    || (!existing.contains(mediaId) && !actor.equals(asset.ownerId()))) {
                throw forbidden("INVALID_VEHICLE_MEDIA");
            }
        }
        UUID cover = coverMediaId == null ? ids.stream().findFirst().orElse(null) : coverMediaId;
        if (cover != null && !ids.contains(cover)) throw bad("INVALID_VEHICLE_COVER");
        List<Attachment> attachments = new ArrayList<>();
        for (int i = 0; i < ids.size(); i++) {
            attachments.add(new Attachment(ids.get(i), i, ids.get(i).equals(cover)));
        }
        repository.replaceMedia(id, attachments);
        return detail(actor, id);
    }

    public String mediaDownloadUrl(UUID actor, UUID listingId, UUID mediaId) {
        VehicleListing listing = lazyExpire(repository.find(actor, listingId, false)
                .orElseThrow(VehicleService::notFound));
        if (!canManage(actor, listing)) requireViewable(actor, listing);
        if (repository.attachments(listingId).stream().noneMatch(a -> a.mediaId().equals(mediaId))) {
            throw notFound();
        }
        return media.authorizedDownloadUrl(mediaId);
    }

    @Transactional
    public UUID contact(UUID actor, UUID id, UUID actingBusinessAccountId) {
        VehicleListing listing = requireViewable(actor, lazyExpire(repository.find(actor, id, false)
                .orElseThrow(VehicleService::notFound)));
        if (actor.equals(listing.ownerUserId())) throw conflict("CANNOT_CONTACT_OWN_VEHICLE");
        if (actingBusinessAccountId != null) {
            if (!businesses.isActiveMember(actor, actingBusinessAccountId)
                    || actingBusinessAccountId.equals(listing.businessAccountId())) {
                throw forbidden("INVALID_ACTING_BUSINESS");
            }
        }
        if (listing.businessAccountId() != null && businesses.isActiveMember(actor,
                listing.businessAccountId())) throw conflict("CANNOT_CONTACT_OWN_VEHICLE");
        UUID sellerRepresentative = representative(listing);
        UUID actorRepresentative = actingBusinessAccountId == null ? actor
                : businesses.representativeUserId(actingBusinessAccountId).orElse(actor);
        if (sellerRepresentative == null || !social.canInteract(actorRepresentative, sellerRepresentative)) {
            throw forbidden("VEHICLE_CONTACT_BLOCKED");
        }
        return messaging.ensureContextConversation(actor, actingBusinessAccountId,
                "VEHICLE_LISTING", id, listing.ownerUserId(), listing.businessAccountId());
    }

    @Transactional
    public UUID report(UUID actor, UUID id, String reason, String details) {
        VehicleListing listing = requireViewable(actor, lazyExpire(repository.find(actor, id, false)
                .orElseThrow(VehicleService::notFound)));
        return moderation.createReport(new ModerationApi.CreateReportCommand(actor,
                listing.countryId(), listing.communityId(), "VEHICLE", id, reason, details));
    }

    private VehicleListing requireManaged(UUID actor, UUID id, boolean lock) {
        VehicleListing listing = repository.find(actor, id, lock).orElseThrow(VehicleService::notFound);
        if (!canManage(actor, listing)) throw forbidden("NOT_VEHICLE_MANAGER");
        return listing;
    }

    private VehicleListing requireViewable(UUID actor, VehicleListing listing) {
        if (!"PUBLISHED".equals(listing.status()) || (listing.expiresAt() != null
                && !listing.expiresAt().isAfter(Instant.now()))) throw notFound();
        ProfileSummary viewer = requireActor(actor);
        if (!viewer.currentCountryId().equals(listing.countryId())) throw notFound();
        switch (listing.visibilityScope()) {
            case "COMMUNITY" -> {
                if (!community.canAccess(actor, listing.communityId())) throw notFound();
            }
            case "SELECTED_COMMUNITIES" -> {
                if (repository.selectedCommunities(listing.id()).stream()
                        .noneMatch(id -> community.canAccess(actor, id))) throw notFound();
            }
            case "COUNTRY" -> { }
            default -> throw notFound();
        }
        UUID representative = representative(listing);
        if (representative == null || !social.canInteract(actor, representative)) throw notFound();
        return listing;
    }

    private UUID representative(VehicleListing listing) {
        return listing.ownerUserId() != null ? listing.ownerUserId()
                : businesses.representativeUserId(listing.businessAccountId()).orElse(null);
    }

    private VehicleListing lazyExpire(VehicleListing listing) {
        if ("PUBLISHED".equals(listing.status()) && listing.expiresAt() != null
                && !listing.expiresAt().isAfter(Instant.now())) {
            repository.transition(listing.id(), "EXPIRED");
            return repository.find(listing.ownerUserId() == null ? listing.createdByUserId()
                    : listing.ownerUserId(), listing.id(), false).orElse(listing);
        }
        return listing;
    }

    private VehiclePage page(UUID actor, VehicleQueryResult result, String sort,
            String fingerprint, boolean publicResults) {
        List<VehicleView> items = enrich(actor, result.items(), publicResults, false);
        String next = result.nextSortKey() == null ? null : encode(new VehicleCursor(sort,
                result.nextSortKey(), result.items().getLast().id(), fingerprint));
        return new VehiclePage(items, next);
    }

    private List<VehicleView> enrich(UUID actor, List<VehicleListing> source,
            boolean publicResults, boolean includeSelected) {
        if (source.isEmpty()) return List.of();
        List<UUID> ids = source.stream().map(VehicleListing::id).toList();
        Set<UUID> businessIds = source.stream().map(VehicleListing::businessAccountId)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        var businessSummaries = businesses.accountSummaries(businessIds);
        var representatives = businesses.representativeUserIds(businessIds);
        Map<UUID, UUID> sellerRepresentatives = new LinkedHashMap<>();
        for (var listing : source) {
            UUID representative = listing.ownerUserId() != null ? listing.ownerUserId()
                    : representatives.get(listing.businessAccountId());
            if (representative != null) sellerRepresentatives.put(listing.id(), representative);
        }
        Set<UUID> personalSellers = source.stream().map(VehicleListing::ownerUserId)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        var profiles = identity.profileSummaries(personalSellers).stream()
                .collect(Collectors.toMap(ProfileSummary::id, Function.identity()));
        Set<UUID> blocked = publicResults ? social.blockedWith(actor, sellerRepresentatives.values())
                : Set.of();
        Map<UUID, String> managerRoles = businesses.membershipsOf(actor).stream()
                .filter(m -> "ACTIVE".equals(m.status()) && MANAGER_ROLES.contains(m.role()))
                .collect(Collectors.toMap(BusinessAccountsApi.AccountMembershipView::accountId,
                        BusinessAccountsApi.AccountMembershipView::role, (a, b) -> a));
        var attachments = repository.attachmentsFor(ids);
        var features = repository.featuresFor(ids);
        List<UUID> mediaIds = attachments.values().stream().flatMap(Collection::stream)
                .map(Attachment::mediaId).toList();
        var downloadUrls = media.authorizedDownloadUrls(mediaIds);
        List<VehicleView> views = new ArrayList<>();
        for (var listing : source) {
            UUID representative = sellerRepresentatives.get(listing.id());
            if (publicResults && (representative == null || blocked.contains(representative)
                    || !activeSeller(listing, profiles, businessSummaries))) continue;
            var listingMedia = attachments.getOrDefault(listing.id(), List.of()).stream()
                    .map(a -> new VehicleMedia(a.mediaId(), downloadUrls.get(a.mediaId()),
                            a.sortOrder(), a.cover())).toList();
            VehicleSeller seller;
            if (listing.ownerUserId() != null) {
                var profile = profiles.get(listing.ownerUserId());
                seller = new VehicleSeller(listing.ownerUserId(),
                        profile == null ? null : profile.displayName(),
                        profile == null ? null : profile.username(), null, null);
            } else {
                var account = businessSummaries.get(listing.businessAccountId());
                seller = new VehicleSeller(null, null, null, listing.businessAccountId(),
                        account == null ? null : account.accountName());
            }
            boolean canManage = actor.equals(listing.ownerUserId())
                    || managerRoles.containsKey(listing.businessAccountId());
            views.add(new VehicleView(listing, listing.location(), listingMedia,
                    features.getOrDefault(listing.id(), List.of()),
                    includeSelected ? repository.selectedCommunities(listing.id()) : List.of(),
                    seller, canManage));
        }
        return views;
    }

    private static boolean activeSeller(VehicleListing listing,
            Map<UUID, ProfileSummary> profiles,
            Map<UUID, BusinessAccountsApi.BusinessAccountSummary> accounts) {
        if (listing.ownerUserId() != null) {
            var profile = profiles.get(listing.ownerUserId());
            return profile != null && "ACTIVE".equals(profile.accountStatus());
        }
        var account = accounts.get(listing.businessAccountId());
        return account != null && "ACTIVE".equals(account.status());
    }

    private void validate(UUID actor, UUID country, VehicleInput v) {
        validateAudience(actor, country, v);
        if (!repository.catalogueValid(v.categoryId(), v.makeId(), v.modelId(), v.variantId())) {
            throw bad("INVALID_VEHICLE_CATALOGUE");
        }
        text(v.title(), 220, "INVALID_VEHICLE_TITLE");
        text(v.description(), 20000, "INVALID_VEHICLE_DESCRIPTION");
        require(v.listingPurpose(), PURPOSES, "INVALID_LISTING_PURPOSE");
        require(v.mileageUnit(), MILEAGE_UNITS, "INVALID_MILEAGE_UNIT");
        require(v.fuelType(), FUEL, "INVALID_FUEL_TYPE");
        require(v.transmission(), TRANSMISSION, "INVALID_TRANSMISSION");
        require(v.driveType(), DRIVE, "INVALID_DRIVE_TYPE");
        require(v.bodyType(), BODY, "INVALID_BODY_TYPE");
        if (v.condition() != null) require(v.condition(), CONDITION, "INVALID_CONDITION");
        if (v.serviceHistory() != null) require(v.serviceHistory(), SERVICE_HISTORY,
                "INVALID_SERVICE_HISTORY");
        year(v.modelYear()); year(v.registrationYear());
        nonnegative(v.mileage(), "INVALID_MILEAGE"); nonnegative(v.engineSizeCc(), "INVALID_ENGINE_SIZE");
        positive(v.doors(), "INVALID_DOORS"); positive(v.seats(), "INVALID_SEATS");
        nonnegative(v.previousOwners(), "INVALID_PREVIOUS_OWNERS");
        nonnegative(v.mileageAllowance(), "INVALID_MILEAGE_ALLOWANCE");
        if (v.priceAmount() == null || v.priceAmount().signum() < 0) throw bad("INVALID_PRICE");
        if (v.rentalDeposit() != null && v.rentalDeposit().signum() < 0) throw bad("INVALID_DEPOSIT");
        if (v.currencyCode() == null || !v.currencyCode().matches("[A-Z]{3}")) {
            throw bad("INVALID_CURRENCY");
        }
        if ("SALE".equals(v.listingPurpose())) {
            if (v.pricePeriod() != null && !"TOTAL".equals(v.pricePeriod())
                    || v.rentalDeposit() != null || v.mileageAllowance() != null
                    || v.rentalConditions() != null) throw bad("INVALID_SALE_PRICING");
        } else if (v.pricePeriod() != null && !Set.of("DAY", "WEEK", "MONTH")
                .contains(v.pricePeriod())) throw bad("INVALID_RENT_PRICING");
        validateLocation(v.location());
        validatePolicy(v);
        validateFeatures(v);
    }

    private void validateAudience(UUID actor, UUID country, VehicleInput v) {
        require(v.visibilityScope(), VISIBILITIES, "INVALID_VISIBILITY");
        if ("COMMUNITY".equals(v.visibilityScope())) {
            validateCommunity(actor, country, v.communityId());
        } else if (v.communityId() != null) throw bad("INVALID_AUDIENCE");
        if ("SELECTED_COMMUNITIES".equals(v.visibilityScope())) {
            if (v.selectedCommunityIds() == null || v.selectedCommunityIds().isEmpty()
                    || v.selectedCommunityIds().size() > 20
                    || new LinkedHashSet<>(v.selectedCommunityIds()).size()
                    != v.selectedCommunityIds().size()) throw bad("SELECTED_COMMUNITIES_REQUIRED");
            v.selectedCommunityIds().forEach(id -> validateCommunity(actor, country, id));
        }
    }

    private void validateCommunity(UUID actor, UUID country, UUID id) {
        var view = taxonomy.findCommunityById(id).orElseThrow(() -> bad("COMMUNITY_NOT_FOUND"));
        if (!view.active() || !country.equals(view.destinationCountryId())
                || !community.canAccess(actor, id)) throw forbidden("INACCESSIBLE_COMMUNITY");
    }

    private void validateLocation(VehicleInput.LocationInput location) {
        if (location == null) return;
        if (trim(location.city()) == null && trim(location.region()) == null
                && trim(location.formattedAddress()) == null) throw bad("GENERAL_LOCATION_REQUIRED");
        if ((location.discoveryLatitude() == null) != (location.discoveryLongitude() == null)
                || location.discoveryLatitude() != null
                && (location.discoveryLatitude() < -90 || location.discoveryLatitude() > 90
                || location.discoveryLongitude() < -180 || location.discoveryLongitude() > 180)) {
            throw bad("INVALID_DISCOVERY_POINT");
        }
    }

    private void validatePolicy(VehicleInput v) {
        String json = mapper.writeValueAsString(v.additionalAttributes());
        if (json.getBytes(StandardCharsets.UTF_8).length > 16 * 1024
                || v.additionalAttributes().size() > 32) throw bad("ATTRIBUTES_TOO_LARGE");
        String categoryKey = jdbcCategoryKey(v.categoryId());
        var policy = policies.forCategory(categoryKey);
        Map<String, VehiclePolicies.Attribute> definitions = policy == null
                ? Map.of() : policy.attributes();
        if (!definitions.keySet().containsAll(v.additionalAttributes().keySet())) {
            throw bad("UNAPPROVED_ATTRIBUTE");
        }
        definitions.forEach((key, definition) -> {
            Object value = v.additionalAttributes().get(key);
            if (definition.required() && value == null) throw bad("REQUIRED_ATTRIBUTE_MISSING");
            if (value != null) validateAttribute(definition, value);
        });
        if (policy != null) {
            for (String field : policy.requiredCoreFields()) {
                if (coreField(v, field) == null) throw bad("REQUIRED_VEHICLE_FIELD_MISSING");
            }
        }
    }

    private String jdbcCategoryKey(UUID categoryId) {
        return repository.categories().stream().filter(c -> c.id().equals(categoryId))
                .findFirst().orElseThrow(() -> bad("INVALID_VEHICLE_CATALOGUE")).key();
    }

    private static void validateAttribute(VehiclePolicies.Attribute definition, Object value) {
        String type = definition.type() == null ? "STRING" : definition.type();
        switch (type) {
            case "STRING", "ENUM" -> {
                if (!(value instanceof String)) throw bad("INVALID_ATTRIBUTE_TYPE");
            }
            case "INTEGER" -> {
                if (!(value instanceof Number number) || number.doubleValue() != Math.rint(
                        number.doubleValue())) throw bad("INVALID_ATTRIBUTE_TYPE");
            }
            case "NUMBER" -> {
                if (!(value instanceof Number)) throw bad("INVALID_ATTRIBUTE_TYPE");
            }
            case "BOOLEAN" -> {
                if (!(value instanceof Boolean)) throw bad("INVALID_ATTRIBUTE_TYPE");
            }
            default -> throw bad("INVALID_ATTRIBUTE_POLICY");
        }
        if (value instanceof Number number) {
            if (definition.minimum() != null && number.doubleValue() < definition.minimum()
                    || definition.maximum() != null && number.doubleValue() > definition.maximum()) {
                throw bad("ATTRIBUTE_OUT_OF_RANGE");
            }
        }
        if (!definition.options().isEmpty() && !definition.options().contains(value.toString())) {
            throw bad("INVALID_ATTRIBUTE_OPTION");
        }
    }

    private void validateFeatures(VehicleInput v) {
        List<UUID> ids = v.featureIds() == null ? List.of() : v.featureIds();
        if (new LinkedHashSet<>(ids).size() != ids.size()) throw bad("DUPLICATE_VEHICLE_FEATURE");
        var active = repository.activeFeatures(ids);
        if (active.size() != ids.size()) throw bad("INVALID_VEHICLE_FEATURE");
        var policy = policies.forCategory(jdbcCategoryKey(v.categoryId()));
        if (policy != null && !policy.allowedFeatures().isEmpty()
                && !active.stream().allMatch(f -> policy.allowedFeatures().contains(f.key()))) {
            throw bad("FEATURE_NOT_ALLOWED_FOR_CATEGORY");
        }
    }

    private VehicleSearch validateSearch(VehicleSearch input) {
        VehicleSearch v = input == null ? new VehicleSearch(
                null, null, null, null, null, null,
                null, null, null, null, null, null, null,
                null, null, null, null, null, null,
                null, null, null, null, null, null, null,
                Map.of(), "NEWEST") : input;
        String sort = upper(v.sort());
        require(sort, SORTS, "INVALID_VEHICLE_SORT");
        String currency = v.currency() == null ? null : upper(v.currency());
        if ((v.priceMin() != null || v.priceMax() != null || sort.startsWith("PRICE"))
                && (currency == null || !currency.matches("[A-Z]{3}"))) throw bad("CURRENCY_REQUIRED");
        if (v.priceMin() != null && v.priceMin().signum() < 0
                || v.priceMax() != null && v.priceMax().signum() < 0
                || v.priceMin() != null && v.priceMax() != null
                && v.priceMin().compareTo(v.priceMax()) > 0) throw bad("INVALID_PRICE_RANGE");
        if ((v.originLatitude() == null) != (v.originLongitude() == null)
                || "DISTANCE".equals(sort) && v.originLatitude() == null) throw bad("ORIGIN_REQUIRED");
        if (v.originLatitude() != null && (v.originLatitude() < -90 || v.originLatitude() > 90
                || v.originLongitude() < -180 || v.originLongitude() > 180)) throw bad("INVALID_ORIGIN");
        if (v.radiusMeters() != null && (v.radiusMeters() <= 0 || v.radiusMeters() > 500000)) {
            throw bad("INVALID_RADIUS");
        }
        if (v.originLatitude() == null && v.radiusMeters() != null) throw bad("ORIGIN_REQUIRED");
        Map<String, String> attributes = new TreeMap<>(v.attributeFilters());
        if (!attributes.isEmpty()) {
            if (v.categoryId() == null) throw bad("CATEGORY_REQUIRED_FOR_ATTRIBUTE_FILTERS");
            String key = jdbcCategoryKey(v.categoryId());
            var policy = policies.forCategory(key);
            for (String attribute : attributes.keySet()) {
                var definition = policy == null ? null : policy.attributes().get(attribute);
                if (definition == null || !definition.filterable()) throw bad("INVALID_ATTRIBUTE_FILTER");
            }
        }
        return new VehicleSearch(trim(v.keyword()), v.purpose() == null ? null : upper(v.purpose()),
                v.categoryId(), v.makeId(), v.modelId(), v.variantId(), v.yearMin(), v.yearMax(),
                v.mileageMin(), v.mileageMax(), v.priceMin(), v.priceMax(), currency,
                v.fuelType() == null ? null : upper(v.fuelType()),
                v.transmission() == null ? null : upper(v.transmission()),
                v.bodyType() == null ? null : upper(v.bodyType()),
                v.condition() == null ? null : upper(v.condition()), v.engineSizeMin(), v.engineSizeMax(),
                v.countryId(), v.communityId(), trim(v.city()), trim(v.region()), v.originLatitude(),
                v.originLongitude(), v.radiusMeters(), attributes, sort);
    }

    private VehicleInput defaults(VehicleInput v) {
        if (v == null) throw bad("INVALID_VEHICLE");
        return new VehicleInput(v.businessAccountId(), v.visibilityScope() == null ? "COUNTRY"
                : upper(v.visibilityScope()), v.communityId(), v.selectedCommunityIds(),
                upper(v.listingPurpose()), v.categoryId(), v.makeId(), v.modelId(), v.variantId(),
                v.title(), v.description(), v.modelYear(), v.mileage(),
                v.mileageUnit() == null ? "MILES" : upper(v.mileageUnit()),
                v.fuelType() == null ? "UNKNOWN" : upper(v.fuelType()),
                v.transmission() == null ? "UNKNOWN" : upper(v.transmission()),
                v.driveType() == null ? "UNKNOWN" : upper(v.driveType()),
                v.bodyType() == null ? "UNKNOWN" : upper(v.bodyType()), v.engineSizeCc(), v.colour(),
                v.doors(), v.seats(), v.condition() == null ? null : upper(v.condition()),
                v.registrationYear(), v.previousOwners(),
                v.additionalAttributes() == null ? Map.of() : v.additionalAttributes(), v.motExpiry(),
                v.serviceHistory() == null ? null : upper(v.serviceHistory()), v.priceAmount(),
                upper(v.currencyCode()), v.pricePeriod() == null ? null : upper(v.pricePeriod()),
                v.rentalDeposit(), v.mileageAllowance(), v.rentalConditions(), v.location(),
                v.featureIds() == null ? List.of() : v.featureIds(), v.expiresAt(), false, false, Set.of());
    }

    private VehicleInput merge(VehicleListing e, VehicleInput p) {
        if (p == null) throw bad("INVALID_VEHICLE");
        Set<String> clear = p.clearFields();
        return defaults(new VehicleInput(e.businessAccountId(),
                p.visibilityScope() == null ? e.visibilityScope() : p.visibilityScope(),
                p.visibilityScope() == null ? e.communityId() : p.communityId(),
                p.selectedCommunityIds() == null ? repository.selectedCommunities(e.id())
                        : p.selectedCommunityIds(),
                p.listingPurpose() == null ? e.listingPurpose() : p.listingPurpose(),
                p.categoryId() == null ? e.categoryId() : p.categoryId(),
                p.makeId() == null ? e.makeId() : p.makeId(),
                p.modelId() == null ? e.modelId() : p.modelId(),
                clear.contains("variantId") ? null : p.variantId() == null ? e.variantId() : p.variantId(),
                p.title() == null ? e.title() : p.title(),
                p.description() == null ? e.description() : p.description(),
                clear.contains("modelYear") ? null : p.modelYear() == null ? e.modelYear() : p.modelYear(),
                clear.contains("mileage") ? null : p.mileage() == null ? e.mileage() : p.mileage(),
                p.mileageUnit() == null ? e.mileageUnit() : p.mileageUnit(),
                p.fuelType() == null ? e.fuelType() : p.fuelType(),
                p.transmission() == null ? e.transmission() : p.transmission(),
                p.driveType() == null ? e.driveType() : p.driveType(),
                p.bodyType() == null ? e.bodyType() : p.bodyType(),
                clear.contains("engineSizeCc") ? null : p.engineSizeCc() == null
                        ? e.engineSizeCc() : p.engineSizeCc(),
                clear.contains("colour") ? null : p.colour() == null ? e.colour() : p.colour(),
                clear.contains("doors") ? null : p.doors() == null ? e.doors() : p.doors(),
                clear.contains("seats") ? null : p.seats() == null ? e.seats() : p.seats(),
                clear.contains("condition") ? null : p.condition() == null ? e.conditionKey() : p.condition(),
                clear.contains("registrationYear") ? null : p.registrationYear() == null
                        ? e.registrationYear() : p.registrationYear(),
                clear.contains("previousOwners") ? null : p.previousOwners() == null
                        ? e.previousOwners() : p.previousOwners(),
                p.additionalAttributes() == null ? e.additionalAttributes() : p.additionalAttributes(),
                clear.contains("motExpiry") ? null : p.motExpiry() == null ? e.motExpiry() : p.motExpiry(),
                clear.contains("serviceHistory") ? null : p.serviceHistory() == null
                        ? e.serviceHistory() : p.serviceHistory(),
                p.priceAmount() == null ? e.priceAmount() : p.priceAmount(),
                p.currencyCode() == null ? e.currencyCode() : p.currencyCode(),
                clear.contains("pricePeriod") ? null : p.pricePeriod() == null
                        ? e.pricePeriod() : p.pricePeriod(),
                clear.contains("rentalDeposit") ? null : p.rentalDeposit() == null
                        ? e.rentalDeposit() : p.rentalDeposit(),
                clear.contains("mileageAllowance") ? null : p.mileageAllowance() == null
                        ? e.mileageAllowance() : p.mileageAllowance(),
                clear.contains("rentalConditions") ? null : p.rentalConditions() == null
                        ? e.rentalConditions() : p.rentalConditions(), p.location(),
                p.featureIds() == null ? repository.featuresFor(List.of(e.id()))
                        .getOrDefault(e.id(), List.of()).stream().map(f -> f.id()).toList()
                        : p.featureIds(),
                p.clearExpiry() ? null : p.expiresAt() == null ? e.expiresAt() : p.expiresAt(),
                p.clearLocation(), p.clearExpiry(), clear));
    }

    private VehicleListing copyForUpdate(VehicleListing e, VehicleInput v, UUID country, UUID address) {
        return new VehicleListing(e.id(), country, "COMMUNITY".equals(v.visibilityScope())
                ? v.communityId() : null, e.ownerUserId(), e.businessAccountId(), e.createdByUserId(),
                v.visibilityScope(), v.listingPurpose(), v.categoryId(), v.makeId(), v.modelId(),
                v.variantId(), e.categoryKey(), e.categoryName(), e.makeName(), e.modelName(), e.variantName(),
                v.title().trim(), v.description().trim(), v.modelYear(), v.mileage(), v.mileageUnit(),
                v.fuelType(), v.transmission(), v.driveType(), v.bodyType(), v.engineSizeCc(), v.colour(),
                v.doors(), v.seats(), v.condition(), v.registrationYear(), v.previousOwners(),
                v.additionalAttributes(), v.motExpiry(), v.serviceHistory(), v.priceAmount(), v.currencyCode(),
                v.pricePeriod(), v.rentalDeposit(), v.mileageAllowance(), v.rentalConditions(), address,
                e.status(), v.expiresAt(), e.publishedAt(), e.createdAt(), e.updatedAt(), e.saved(),
                e.distanceMeters(), e.location());
    }

    private VehicleInput inputOf(VehicleListing e) {
        return defaults(new VehicleInput(e.businessAccountId(), e.visibilityScope(), e.communityId(),
                repository.selectedCommunities(e.id()), e.listingPurpose(), e.categoryId(), e.makeId(),
                e.modelId(), e.variantId(), e.title(), e.description(), e.modelYear(), e.mileage(),
                e.mileageUnit(), e.fuelType(), e.transmission(), e.driveType(), e.bodyType(),
                e.engineSizeCc(), e.colour(), e.doors(), e.seats(), e.conditionKey(), e.registrationYear(),
                e.previousOwners(), e.additionalAttributes(), e.motExpiry(), e.serviceHistory(),
                e.priceAmount(), e.currencyCode(), e.pricePeriod(), e.rentalDeposit(), e.mileageAllowance(),
                e.rentalConditions(), e.location() == null ? null : new VehicleInput.LocationInput(
                        e.location().city(), e.location().region(), e.location().formattedAddress(), null, null),
                repository.featuresFor(List.of(e.id())).getOrDefault(e.id(), List.of()).stream()
                        .map(f -> f.id()).toList(), e.expiresAt(), false, false, Set.of()));
    }

    private void replaceJoins(UUID id, VehicleInput value) {
        repository.replaceCommunities(id, "SELECTED_COMMUNITIES".equals(value.visibilityScope())
                ? value.selectedCommunityIds() : List.of());
        repository.replaceFeatures(id, value.featureIds());
    }

    private UUID createAddress(UUID actor, UUID country, VehicleInput.LocationInput location) {
        if (location == null) return null;
        return repository.createAddress(country, trim(location.city()), trim(location.region()),
                trim(location.formattedAddress()), location.discoveryLatitude(),
                location.discoveryLongitude(), actor);
    }

    private static boolean hasGeneralLocation(VehicleListing listing) {
        return listing.addressId() != null && listing.location() != null
                && (trim(listing.location().city()) != null || trim(listing.location().region()) != null
                || trim(listing.location().formattedAddress()) != null);
    }

    private ProfileSummary requireActor(UUID actor) {
        ProfileSummary profile = identity.profileSummary(actor)
                .orElseThrow(() -> forbidden("ACTIVE_PROFILE_REQUIRED"));
        if (!"ACTIVE".equals(profile.accountStatus()) || profile.currentCountryId() == null) {
            throw forbidden("ACTIVE_PROFILE_REQUIRED");
        }
        return profile;
    }

    private UUID requireCountry(UUID countryId) {
        if (!taxonomy.isCountryActive(countryId)) throw forbidden("COUNTRY_NOT_ACTIVE");
        return countryId;
    }

    private void requireManager(UUID actor, UUID businessAccountId) {
        if (businessAccountId == null) return;
        var membership = businesses.membership(actor, businessAccountId)
                .orElseThrow(() -> forbidden("NOT_VEHICLE_MANAGER"));
        if (!"ACTIVE".equals(membership.status()) || !MANAGER_ROLES.contains(membership.role())) {
            throw forbidden("NOT_VEHICLE_MANAGER");
        }
    }

    private boolean canManage(UUID actor, VehicleListing listing) {
        if (actor.equals(listing.ownerUserId())) return true;
        if (listing.businessAccountId() == null) return false;
        return businesses.membership(actor, listing.businessAccountId())
                .map(m -> "ACTIVE".equals(m.status()) && MANAGER_ROLES.contains(m.role()))
                .orElse(false);
    }

    private List<UUID> manageableBusinessIds(UUID actor) {
        return businesses.membershipsOf(actor).stream()
                .filter(m -> "ACTIVE".equals(m.status()) && MANAGER_ROLES.contains(m.role()))
                .map(BusinessAccountsApi.AccountMembershipView::accountId).toList();
    }

    private List<UUID> accessibleCommunities(UUID actor) {
        return community.membershipsOf(actor).stream()
                .map(CommunityApi.MembershipView::communityId).toList();
    }

    private static Object coreField(VehicleInput v, String field) {
        return switch (field) {
            case "modelYear" -> v.modelYear(); case "registrationYear" -> v.registrationYear();
            case "mileage" -> v.mileage(); case "fuelType" -> v.fuelType();
            case "transmission" -> v.transmission(); case "driveType" -> v.driveType();
            case "bodyType" -> v.bodyType(); case "engineSizeCc" -> v.engineSizeCc();
            case "colour" -> v.colour(); case "doors" -> v.doors(); case "seats" -> v.seats();
            case "condition" -> v.condition(); case "previousOwners" -> v.previousOwners();
            case "motExpiry" -> v.motExpiry(); case "serviceHistory" -> v.serviceHistory();
            case "pricePeriod" -> v.pricePeriod(); case "rentalDeposit" -> v.rentalDeposit();
            case "mileageAllowance" -> v.mileageAllowance();
            case "rentalConditions" -> v.rentalConditions();
            default -> throw bad("INVALID_CATEGORY_POLICY");
        };
    }

    private static int pageSize(int size) {
        if (size <= 0) return DEFAULT_PAGE;
        if (size > MAX_PAGE) throw bad("PAGE_SIZE_TOO_LARGE");
        return size;
    }

    private static String encode(VehicleCursor cursor) {
        String value = String.join("|", cursor.sort(), cursor.fingerprint(),
                cursor.sortKey(), cursor.id().toString());
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                value.getBytes(StandardCharsets.UTF_8));
    }

    private static VehicleCursor decode(String value, String sort, String fingerprint) {
        if (value == null || value.isBlank()) return null;
        try {
            String[] parts = new String(Base64.getUrlDecoder().decode(value), StandardCharsets.UTF_8)
                    .split("\\|", -1);
            if (parts.length != 4 || !sort.equals(parts[0]) || !fingerprint.equals(parts[1])) {
                throw bad("CURSOR_FILTER_MISMATCH");
            }
            return new VehicleCursor(parts[0], parts[2], UUID.fromString(parts[3]), parts[1]);
        } catch (IllegalArgumentException e) {
            throw bad("INVALID_CURSOR");
        }
    }

    private static String fingerprint(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String upper(String value) {
        return value == null ? null : value.trim().toUpperCase(Locale.ROOT);
    }

    private static String trim(String value) {
        if (value == null || value.isBlank()) return null;
        return value.trim();
    }

    private static void text(String value, int max, String code) {
        if (trim(value) == null || value.trim().length() > max) throw bad(code);
    }

    private static void require(String value, Set<String> allowed, String code) {
        if (value == null || !allowed.contains(value)) throw bad(code);
    }

    private static void year(Integer value) {
        if (value != null && (value < 1886 || value > 2200)) throw bad("INVALID_VEHICLE_YEAR");
    }

    private static void nonnegative(Integer value, String code) {
        if (value != null && value < 0) throw bad(code);
    }

    private static void positive(Integer value, String code) {
        if (value != null && value <= 0) throw bad(code);
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "VEHICLE_NOT_FOUND");
    }

    private static ResponseStatusException bad(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }

    private static ResponseStatusException forbidden(String reason) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, reason);
    }

    private static ResponseStatusException conflict(String reason) {
        return new ResponseStatusException(HttpStatus.CONFLICT, reason);
    }
}
