package com.diasporum.backend.sparebag.internal.application;

import com.diasporum.backend.billing.BillingApi;
import com.diasporum.backend.community.CommunityApi;
import com.diasporum.backend.identity.IdentityApi;
import com.diasporum.backend.media.MediaApi;
import com.diasporum.backend.social.SocialApi;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Address;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Airport;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Category;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.DiscoveryFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Listing;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ListingInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ListingView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Owner;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Page;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.SpareBagContactRepository;
import com.diasporum.backend.sparebag.internal.infrastructure.persistence.SpareBagListingRepository;
import com.diasporum.backend.taxonomy.TaxonomyApi;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Listing lifecycle, discovery, visibility, saves, media and reporting. */
@Service
public class SpareBagListingService {

    private static final int DEFAULT_PAGE = 20;
    private static final int MAX_PAGE = 50;
    private static final Set<String> LISTING_TYPES = Set.of(
            "SENDER_REQUEST", "PASSENGER_OFFER");
    private static final Set<String> VISIBILITIES = Set.of("COMMUNITY", "COUNTRY");
    private static final Set<String> PRICE_UNITS = Set.of("PER_KG", "PER_PARCEL");
    private static final Set<String> OWNER_STATUSES = Set.of("DRAFT", "PENDING_REVIEW",
            "PUBLISHED", "PAUSED", "MATCHED", "CLOSED", "EXPIRED", "REMOVED");
    private static final Set<String> REPORT_REASONS = Set.of("SPAM", "SCAM",
            "HARASSMENT", "HATE", "SEXUAL_MISCONDUCT", "MISINFORMATION",
            "IMPERSONATION", "PRIVACY", "OTHER");
    private static final Set<String> IMAGE_TYPES = Set.of(
            "image/jpeg", "image/png", "image/webp");

    private final SpareBagListingRepository repository;
    private final SpareBagContactRepository contacts;
    private final IdentityApi identity;
    private final CommunityApi community;
    private final TaxonomyApi taxonomy;
    private final MediaApi media;
    private final SocialApi social;
    private final BillingApi billing;

    public SpareBagListingService(SpareBagListingRepository repository,
            SpareBagContactRepository contacts, IdentityApi identity,
            CommunityApi community, TaxonomyApi taxonomy, MediaApi media,
            SocialApi social, BillingApi billing) {
        this.repository = repository;
        this.contacts = contacts;
        this.identity = identity;
        this.community = community;
        this.taxonomy = taxonomy;
        this.media = media;
        this.social = social;
        this.billing = billing;
    }

    public List<Airport> airports(String search, UUID countryId, int limit) {
        return repository.airports(search, countryId, clamp(limit));
    }

    public List<Category> categories() {
        return repository.categories();
    }

    @Transactional
    public ListingView create(UUID actor, ListingInput input) {
        validate(actor, input);
        Listing listing = repository.insert(UUID.randomUUID(), actor, input);
        repository.replaceCategories(listing.id(), distinct(input.categoryKeys()));
        repository.replaceMedia(listing.id(), distinct(input.mediaIds()));
        return view(actor, listing);
    }

    @Transactional
    public ListingView update(UUID actor, UUID listingId, ListingInput input) {
        Listing existing = requireOwned(actor, listingId);
        if (!Set.of("DRAFT", "PUBLISHED", "PAUSED").contains(existing.status())) {
            throw conflict("LISTING_NOT_EDITABLE");
        }
        if (!existing.listingType().equals(input.listingType())) {
            throw bad("LISTING_TYPE_IMMUTABLE");
        }
        validate(actor, input);
        Listing updated = repository.update(listingId, input);
        repository.replaceCategories(listingId, distinct(input.categoryKeys()));
        repository.replaceMedia(listingId, distinct(input.mediaIds()));
        return view(actor, updated);
    }

    @Transactional(readOnly = true)
    public ListingView detail(UUID actor, UUID listingId) {
        Listing listing = requireListing(listingId);
        requireViewable(actor, listing);
        return view(actor, listing);
    }

    @Transactional
    public ListingView publish(UUID actor, UUID listingId) {
        Listing listing = requireOwnedForUpdate(actor, listingId);
        if (!Set.of("DRAFT", "PAUSED").contains(listing.status())) {
            throw conflict("INVALID_LISTING_TRANSITION");
        }
        validate(actor, inputOf(listing));
        if (listing.effectiveEndDate().isBefore(LocalDate.now())) {
            throw bad("PAST_TRAVEL_DATES");
        }
        if ("DRAFT".equals(listing.status())) {
            var decision = billing.consumePersonalQuota(actor,
                    "SPARE_BAG_LISTING_PUBLISH", "SPARE_BAG_LISTING", listingId,
                    "spare-bag-publish:" + listingId);
            if (!decision.allowed()) {
                throw forbidden(decision.reason());
            }
        }
        repository.setStatus(listingId, "PUBLISHED");
        return view(actor, requireListing(listingId));
    }

    @Transactional
    public ListingView pause(UUID actor, UUID listingId) {
        Listing listing = requireOwnedForUpdate(actor, listingId);
        if (!"PUBLISHED".equals(listing.status())) {
            throw conflict("INVALID_LISTING_TRANSITION");
        }
        repository.setStatus(listingId, "PAUSED");
        return view(actor, requireListing(listingId));
    }

    @Transactional
    public ListingView close(UUID actor, UUID listingId) {
        Listing listing = requireOwnedForUpdate(actor, listingId);
        if (!Set.of("DRAFT", "PUBLISHED", "PAUSED", "MATCHED")
                .contains(listing.status())) {
            throw conflict("INVALID_LISTING_TRANSITION");
        }
        repository.setStatus(listingId, "CLOSED");
        return view(actor, requireListing(listingId));
    }

    @Transactional(readOnly = true)
    public Page<ListingView> discover(UUID actor, DiscoveryFilters filters,
            String cursor, int size) {
        validateFilters(filters);
        var profile = identity.profileSummary(actor)
                .orElseThrow(() -> forbidden("PROFILE_REQUIRED"));
        List<UUID> memberships = community.membershipsOf(actor).stream()
                .map(CommunityApi.MembershipView::communityId).toList();
        LocalDate cursorDate = null;
        UUID cursorId = null;
        if (cursor != null && !cursor.isBlank()) {
            String[] parts = decode(cursor);
            cursorDate = LocalDate.parse(parts[0]);
            cursorId = UUID.fromString(parts[1]);
        }
        int limit = clamp(size);
        List<Listing> rows = repository.discover(profile.currentCountryId(), memberships,
                filters, cursorDate, cursorId, limit + 1);
        boolean hasMore = rows.size() > limit;
        List<Listing> pageRows = hasMore ? new ArrayList<>(rows.subList(0, limit)) : rows;
        String next = hasMore ? encode(pageRows.getLast().travelDateStart().toString(),
                pageRows.getLast().id()) : null;
        Set<UUID> blocked = social.blockedWith(actor,
                pageRows.stream().map(Listing::ownerUserId).toList());
        List<Listing> visible = pageRows.stream()
                .filter(l -> !blocked.contains(l.ownerUserId()))
                .toList();
        return new Page<>(views(actor, visible), next);
    }

    @Transactional(readOnly = true)
    public Page<ListingView> mine(UUID actor, String status, String cursor, int size) {
        if (status != null && !OWNER_STATUSES.contains(status)) {
            throw bad("INVALID_LISTING_STATUS");
        }
        Instant ts = null;
        UUID id = null;
        if (cursor != null && !cursor.isBlank()) {
            String[] parts = decode(cursor);
            ts = Instant.parse(parts[0]);
            id = UUID.fromString(parts[1]);
        }
        int limit = clamp(size);
        List<Listing> rows = repository.mine(actor, status, ts, id, limit + 1);
        boolean hasMore = rows.size() > limit;
        List<Listing> pageRows = hasMore ? new ArrayList<>(rows.subList(0, limit)) : rows;
        String next = hasMore ? encode(pageRows.getLast().createdAt().toString(),
                pageRows.getLast().id()) : null;
        return new Page<>(views(actor, pageRows), next);
    }

    @Transactional
    public void save(UUID actor, UUID listingId) {
        Listing listing = requireListing(listingId);
        requireViewable(actor, listing);
        if (!"PUBLISHED".equals(listing.status())) {
            throw conflict("LISTING_NOT_ELIGIBLE");
        }
        repository.save(actor, listingId);
    }

    @Transactional
    public void unsave(UUID actor, UUID listingId) {
        repository.unsave(actor, listingId);
    }

    @Transactional(readOnly = true)
    public Page<ListingView> saved(UUID actor, String cursor, int size) {
        Instant ts = null;
        UUID id = null;
        if (cursor != null && !cursor.isBlank()) {
            String[] parts = decode(cursor);
            ts = Instant.parse(parts[0]);
            id = UUID.fromString(parts[1]);
        }
        int limit = clamp(size);
        List<Listing> rows = repository.saved(actor, ts, id, limit + 1);
        boolean hasMore = rows.size() > limit;
        List<Listing> pageRows = hasMore ? new ArrayList<>(rows.subList(0, limit)) : rows;
        String next = hasMore ? encode(pageRows.getLast().createdAt().toString(),
                pageRows.getLast().id()) : null;
        Set<UUID> blocked = social.blockedWith(actor,
                pageRows.stream().map(Listing::ownerUserId).toList());
        List<Listing> visible = pageRows.stream()
                .filter(l -> !blocked.contains(l.ownerUserId()))
                .filter(l -> canView(actor, l)).toList();
        return new Page<>(views(actor, visible), next);
    }

    public String mediaDownloadUrl(UUID actor, UUID listingId, UUID mediaId) {
        ListingView detail = detail(actor, listingId);
        if (!detail.mediaIds().contains(mediaId)) {
            throw notFound("MEDIA_NOT_FOUND");
        }
        return media.authorizedDownloadUrl(mediaId);
    }

    @Transactional
    public UUID report(UUID actor, UUID listingId, String reason, String details) {
        Listing listing = requireListing(listingId);
        requireViewable(actor, listing);
        if (listing.ownerUserId().equals(actor)) {
            throw bad("CANNOT_REPORT_OWN_LISTING");
        }
        validateReport(reason, details);
        if (repository.hasOpenReport(actor, "SPARE_BAG_LISTING", listingId)) {
            throw conflict("REPORT_DUPLICATE");
        }
        return repository.report(actor, listing.originAirport().countryId(),
                listing.communityId(), "SPARE_BAG_LISTING", listingId, reason, details);
    }

    /** Batch enrichment shared by listing and contact-request endpoints. */
    @Transactional(readOnly = true)
    public List<ListingView> views(UUID viewer, Collection<Listing> listings) {
        if (listings.isEmpty()) return List.of();
        List<UUID> ids = listings.stream().map(Listing::id).toList();
        var categories = repository.categoriesFor(ids);
        var mediaIds = repository.mediaFor(ids);
        var saves = repository.savedFor(viewer, ids);
        var privateListings = contacts.acceptedListingsForViewer(viewer, ids);
        Set<UUID> ownerIds = listings.stream().map(Listing::ownerUserId)
                .collect(Collectors.toSet());
        Map<UUID, Owner> owners = identity.profileSummaries(ownerIds).stream()
                .map(p -> new Owner(p.id(), p.username(), p.displayName()))
                .collect(Collectors.toMap(Owner::id, Function.identity()));
        Set<UUID> addressIds = new HashSet<>();
        for (Listing listing : listings) {
            if (listing.collectionAddressId() != null) addressIds.add(listing.collectionAddressId());
            if (listing.handoverAddressId() != null) addressIds.add(listing.handoverAddressId());
        }
        var addresses = repository.addressesFor(addressIds);
        return listings.stream().map(listing -> {
            boolean privateAccess = viewer.equals(listing.ownerUserId())
                    || privateListings.contains(listing.id());
            return new ListingView(listing,
                    categories.getOrDefault(listing.id(), List.of()),
                    mediaIds.getOrDefault(listing.id(), List.of()),
                    owners.get(listing.ownerUserId()), saves.contains(listing.id()),
                    viewer.equals(listing.ownerUserId()),
                    privateAccess ? addresses.get(listing.collectionAddressId()) : null,
                    privateAccess ? addresses.get(listing.handoverAddressId()) : null);
        }).toList();
    }

    public ListingView view(UUID viewer, Listing listing) {
        return views(viewer, List.of(listing)).getFirst();
    }

    public Listing requireListing(UUID id) {
        return repository.find(id).orElseThrow(() -> notFound("LISTING_NOT_FOUND"));
    }

    public Listing requireForUpdate(UUID id) {
        return repository.findForUpdate(id)
                .orElseThrow(() -> notFound("LISTING_NOT_FOUND"));
    }

    public Listing requireOwnedForUpdate(UUID actor, UUID id) {
        Listing listing = repository.findForUpdate(id)
                .orElseThrow(() -> notFound("LISTING_NOT_FOUND"));
        if (!listing.ownerUserId().equals(actor)) throw forbidden("NOT_LISTING_OWNER");
        return listing;
    }

    public void requireViewable(UUID actor, Listing listing) {
        if (!canView(actor, listing)) throw notFound("LISTING_NOT_FOUND");
    }

    private boolean canView(UUID actor, Listing listing) {
        if (listing.ownerUserId().equals(actor)) return true;
        boolean active = "PUBLISHED".equals(listing.status())
                && !listing.effectiveEndDate().isBefore(LocalDate.now())
                && (listing.closesAt() == null || listing.closesAt().isAfter(Instant.now()));
        boolean matchedParticipant = "MATCHED".equals(listing.status())
                && contacts.acceptedParticipant(listing.id(), actor);
        if ((!active && !matchedParticipant) || !social.canInteract(actor, listing.ownerUserId())) {
            return false;
        }
        if ("COMMUNITY".equals(listing.visibilityScope())) {
            return listing.communityId() != null
                    && community.canAccess(actor, listing.communityId());
        }
        return identity.profileSummary(actor).map(p -> p.currentCountryId()
                .equals(listing.originAirport().countryId())).orElse(false);
    }

    private Listing requireOwned(UUID actor, UUID id) {
        Listing listing = requireListing(id);
        if (!listing.ownerUserId().equals(actor)) throw forbidden("NOT_LISTING_OWNER");
        return listing;
    }

    private void validate(UUID actor, ListingInput in) {
        if (in == null || !LISTING_TYPES.contains(in.listingType())
                || !VISIBILITIES.contains(in.visibilityScope())
                || !PRICE_UNITS.contains(in.priceUnit())) {
            throw bad("INVALID_LISTING");
        }
        if (blank(in.title()) || in.title().length() > 180
                || blank(in.description()) || in.description().length() > 10000
                || in.travelDateStart() == null || in.priceAmount() == null
                || in.priceAmount().signum() < 0 || in.priceCurrency() == null
                || !in.priceCurrency().matches("[A-Z]{3}")) {
            throw bad("INVALID_LISTING_FIELDS");
        }
        if (in.travelDateEnd() != null
                && in.travelDateEnd().isBefore(in.travelDateStart())) {
            throw bad("INVALID_TRAVEL_DATES");
        }
        Airport origin = repository.airport(in.originAirportId())
                .orElseThrow(() -> bad("ORIGIN_AIRPORT_INVALID"));
        Airport destination = repository.airport(in.destinationAirportId())
                .orElseThrow(() -> bad("DESTINATION_AIRPORT_INVALID"));
        if (origin.id().equals(destination.id())) throw bad("AIRPORTS_MUST_DIFFER");
        validateScope(actor, in, origin);
        validateCapacityAndPrice(in);
        validateAddresses(actor, in, origin, destination);
        Set<String> activeCategories = repository.activeCategoryKeys();
        if (in.categoryKeys() != null && !activeCategories.containsAll(in.categoryKeys())) {
            throw bad("INVALID_CATEGORY");
        }
        validateMedia(actor, in.mediaIds());
    }

    private void validateScope(UUID actor, ListingInput in, Airport origin) {
        if ("COUNTRY".equals(in.visibilityScope())) {
            if (in.communityId() != null) throw bad("COUNTRY_SCOPE_HAS_NO_COMMUNITY");
            return;
        }
        if (in.communityId() == null || !community.isActiveMember(actor, in.communityId())) {
            throw forbidden("COMMUNITY_MEMBERSHIP_REQUIRED");
        }
        var selected = taxonomy.findCommunityById(in.communityId())
                .filter(TaxonomyApi.CommunityView::active)
                .orElseThrow(() -> bad("COMMUNITY_INVALID"));
        if (!selected.destinationCountryId().equals(origin.countryId())) {
            throw bad("COMMUNITY_ORIGIN_COUNTRY_MISMATCH");
        }
    }

    private void validateCapacityAndPrice(ListingInput in) {
        boolean sender = "SENDER_REQUEST".equals(in.listingType());
        if (sender) {
            if ((positive(in.requestedWeightKg()) == null
                    && positive(in.requestedParcelCount()) == null)
                    || in.availableCapacityKg() != null || in.availableParcelCount() != null
                    || in.maxSingleParcelKg() != null) {
                throw bad("SENDER_REQUEST_CAPACITY_INVALID");
            }
            if (("PER_KG".equals(in.priceUnit()) && in.requestedWeightKg() == null)
                    || ("PER_PARCEL".equals(in.priceUnit())
                    && in.requestedParcelCount() == null)) {
                throw bad("PRICE_UNIT_MISMATCH");
            }
        } else {
            if (positive(in.availableCapacityKg()) == null
                    || in.requestedWeightKg() != null || in.requestedParcelCount() != null) {
                throw bad("PASSENGER_OFFER_CAPACITY_INVALID");
            }
            if (in.availableParcelCount() != null && in.availableParcelCount() < 1) {
                throw bad("PASSENGER_OFFER_CAPACITY_INVALID");
            }
            if (in.maxSingleParcelKg() != null && (in.maxSingleParcelKg().signum() <= 0
                    || in.maxSingleParcelKg().compareTo(in.availableCapacityKg()) > 0)) {
                throw bad("MAX_PARCEL_WEIGHT_INVALID");
            }
            if ("PER_PARCEL".equals(in.priceUnit()) && in.availableParcelCount() == null) {
                throw bad("PRICE_UNIT_MISMATCH");
            }
        }
    }

    private void validateAddresses(UUID actor, ListingInput in,
            Airport origin, Airport destination) {
        if (blank(in.collectionPlace()) && in.collectionAddressId() == null
                && blank(in.handoverPlace()) && in.handoverAddressId() == null) {
            throw bad("COLLECTION_OR_HANDOVER_REQUIRED");
        }
        if (in.collectionAddressId() != null) {
            Address address = repository.address(in.collectionAddressId())
                    .orElseThrow(() -> bad("COLLECTION_ADDRESS_INVALID"));
            validateAddress(actor, address, origin.countryId(), "COLLECTION_ADDRESS_INVALID");
        }
        if (in.handoverAddressId() != null) {
            Address address = repository.address(in.handoverAddressId())
                    .orElseThrow(() -> bad("HANDOVER_ADDRESS_INVALID"));
            validateAddress(actor, address, destination.countryId(), "HANDOVER_ADDRESS_INVALID");
        }
    }

    private void validateAddress(UUID actor, Address address, UUID countryId, String code) {
        if (!actor.equals(address.ownerUserId()) || !countryId.equals(address.countryId())
                || "PUBLIC".equals(address.visibility())) {
            throw bad(code);
        }
    }

    private void validateMedia(UUID actor, List<UUID> mediaIds) {
        if (mediaIds == null || mediaIds.isEmpty()) return;
        List<UUID> unique = distinct(mediaIds);
        Map<UUID, MediaApi.AssetView> assets = media.assets(unique).stream()
                .collect(Collectors.toMap(MediaApi.AssetView::id, Function.identity()));
        if (assets.size() != unique.size()) throw bad("MEDIA_NOT_READY");
        for (UUID id : unique) {
            var asset = assets.get(id);
            if (!"READY".equals(asset.status())) throw bad("MEDIA_NOT_READY");
            if (!actor.equals(asset.ownerId()) || !"SPARE_BAG_LISTING".equals(asset.purpose())
                    || !IMAGE_TYPES.contains(asset.mimeType())) {
                throw bad("MEDIA_NOT_ATTACHABLE");
            }
        }
    }

    private void validateFilters(DiscoveryFilters f) {
        if (f.listingType() != null && !LISTING_TYPES.contains(f.listingType())
                || f.dateFrom() != null && f.dateTo() != null
                && f.dateFrom().isAfter(f.dateTo())
                || f.maxPrice() != null && f.maxPrice().signum() < 0
                || f.minimumCapacityKg() != null && f.minimumCapacityKg().signum() < 0) {
            throw bad("INVALID_DISCOVERY_FILTERS");
        }
    }

    private void validateReport(String reason, String details) {
        if (!REPORT_REASONS.contains(reason)) throw bad("INVALID_REPORT_REASON");
        if (details != null && details.length() > 4000) throw bad("REPORT_DETAILS_TOO_LONG");
    }

    private ListingInput inputOf(Listing listing) {
        var view = view(listing.ownerUserId(), listing);
        return new ListingInput(listing.listingType(), listing.communityId(),
                listing.visibilityScope(), listing.originAirport().id(),
                listing.destinationAirport().id(), listing.title(), listing.description(),
                listing.travelDateStart(), listing.travelDateEnd(), listing.requestedWeightKg(),
                listing.requestedParcelCount(), listing.availableCapacityKg(),
                listing.availableParcelCount(), listing.maxSingleParcelKg(),
                listing.priceAmount(), listing.priceUnit(), listing.priceCurrency(),
                listing.collectionPlace(), listing.collectionAddressId(), listing.handoverPlace(),
                listing.handoverAddressId(), listing.handoverNotes(),
                view.categories().stream().map(Category::key).toList(), view.mediaIds());
    }

    private static Object positive(Number value) {
        if (value == null) return null;
        if (value instanceof BigDecimal decimal) {
            if (decimal.signum() <= 0) throw bad("INVALID_CAPACITY");
        } else if (value.intValue() < 1) {
            throw bad("INVALID_CAPACITY");
        }
        return value;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static <T> List<T> distinct(List<T> values) {
        return values == null ? List.of() : List.copyOf(new LinkedHashSet<>(values));
    }

    private static int clamp(int size) {
        return size <= 0 ? DEFAULT_PAGE : Math.min(size, MAX_PAGE);
    }

    private static String encode(String value, UUID id) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (value + "|" + id).getBytes(StandardCharsets.UTF_8));
    }

    private static String[] decode(String cursor) {
        try {
            String decoded = new String(Base64.getUrlDecoder().decode(cursor),
                    StandardCharsets.UTF_8);
            String[] parts = decoded.split("\\|", -1);
            if (parts.length != 2) throw new IllegalArgumentException();
            return parts;
        } catch (IllegalArgumentException e) {
            throw bad("INVALID_CURSOR");
        }
    }

    private static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    private static ResponseStatusException forbidden(String code) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, code);
    }

    private static ResponseStatusException conflict(String code) {
        return new ResponseStatusException(HttpStatus.CONFLICT, code);
    }

    private static ResponseStatusException notFound(String code) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, code);
    }
}
