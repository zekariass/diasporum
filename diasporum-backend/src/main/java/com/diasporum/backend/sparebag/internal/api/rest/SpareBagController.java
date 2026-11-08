package com.diasporum.backend.sparebag.internal.api.rest;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.sparebag.internal.application.SpareBagContactService;
import com.diasporum.backend.sparebag.internal.application.SpareBagListingService;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Address;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Airport;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Category;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ContactInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ContactView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.DiscoveryCounts;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.DiscoveryFilters;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ListingInput;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.ListingView;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Owner;
import com.diasporum.backend.sparebag.internal.domain.SpareBagTypes.Page;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Spare Bag listing, discovery, saved-item and contact-request endpoints. */
@RestController
@RequestMapping("/api/v1")
public class SpareBagController {

    private final SpareBagListingService listings;
    private final SpareBagContactService contacts;

    public SpareBagController(SpareBagListingService listings,
            SpareBagContactService contacts) {
        this.listings = listings;
        this.contacts = contacts;
    }

    public record ListingRequest(@NotBlank String listingType, UUID communityId,
            @NotBlank String visibilityScope, @NotNull UUID originAirportId,
            @NotNull UUID destinationAirportId, @NotBlank @Size(max = 180) String title,
            @NotBlank @Size(max = 10000) String description,
            @NotNull LocalDate travelDateStart, LocalDate travelDateEnd,
            BigDecimal requestedWeightKg, Integer requestedParcelCount,
            BigDecimal availableCapacityKg, Integer availableParcelCount,
            BigDecimal maxSingleParcelKg, @NotNull BigDecimal priceAmount,
            @NotBlank String priceUnit, @NotBlank @Size(min = 3, max = 3) String priceCurrency,
            @Size(max = 500) String collectionPlace, UUID collectionAddressId,
            @Size(max = 500) String handoverPlace, UUID handoverAddressId,
            @Size(max = 3000) String handoverNotes, List<String> categoryKeys,
            List<UUID> mediaIds) {

        ListingInput toInput() {
            return new ListingInput(listingType, communityId, visibilityScope,
                    originAirportId, destinationAirportId, title, description,
                    travelDateStart, travelDateEnd, requestedWeightKg, requestedParcelCount,
                    availableCapacityKg, availableParcelCount, maxSingleParcelKg,
                    priceAmount, priceUnit, priceCurrency, collectionPlace,
                    collectionAddressId, handoverPlace, handoverAddressId, handoverNotes,
                    categoryKeys, mediaIds);
        }
    }

    public record ContactRequestBody(@NotNull UUID ownListingId,
            @NotNull UUID targetListingId, BigDecimal parcelWeightKg,
            BigDecimal proposedPriceAmount, String proposedPriceUnit,
            String priceCurrency, @Size(max = 3000) String message,
            @NotBlank @Size(max = 120) String idempotencyKey) {

        ContactInput toInput() {
            return new ContactInput(ownListingId, targetListingId, parcelWeightKg,
                    proposedPriceAmount, proposedPriceUnit, priceCurrency, message,
                    idempotencyKey);
        }
    }

    public record ResponseNoteBody(@Size(max = 3000) String responseNote) {
    }

    public record ReportBody(@NotBlank String reason,
            @Size(max = 4000) String details) {
    }

    public record AirportResponse(UUID id, UUID countryId, String iataCode,
            String icaoCode, String name, String city, String countryName,
            String countryIso2) {
        AirportResponse(Airport a) {
            this(a.id(), a.countryId(), a.iataCode(), a.icaoCode(), a.name(), a.city(),
                    a.countryName(), a.countryIso2());
        }
    }

    public record CategoryResponse(String key, String displayName, int sortOrder) {
        CategoryResponse(Category c) {
            this(c.key(), c.displayName(), c.sortOrder());
        }
    }

    public record OwnerResponse(UUID id, String username, String displayName,
            UUID avatarMediaId) {
        OwnerResponse(Owner owner) {
            this(owner == null ? null : owner.id(), owner == null ? null : owner.username(),
                    owner == null ? null : owner.displayName(),
                    owner == null ? null : owner.avatarMediaId());
        }
    }

    public record CountsResponse(long passengerOffers, long senderRequests) {
        CountsResponse(DiscoveryCounts counts) {
            this(counts.passengerOffers(), counts.senderRequests());
        }
    }

    public record AddressResponse(UUID id, String addressLine1, String addressLine2,
            String city, String region, String postalCode, String formattedAddress) {
        AddressResponse(Address a) {
            this(a == null ? null : a.id(), a == null ? null : a.addressLine1(),
                    a == null ? null : a.addressLine2(), a == null ? null : a.city(),
                    a == null ? null : a.region(), a == null ? null : a.postalCode(),
                    a == null ? null : a.formattedAddress());
        }
    }

    public record ListingResponse(UUID id, UUID ownerUserId, String listingType,
            UUID communityId, String visibilityScope, AirportResponse originAirport,
            AirportResponse destinationAirport, String title, String description,
            LocalDate travelDateStart, LocalDate travelDateEnd,
            BigDecimal requestedWeightKg, Integer requestedParcelCount,
            BigDecimal availableCapacityKg, Integer availableParcelCount,
            BigDecimal maxSingleParcelKg, BigDecimal priceAmount, String priceUnit,
            String priceCurrency, String collectionPlace, String handoverPlace,
            String handoverNotes, String status, Instant publishedAt, Instant closesAt,
            Instant createdAt, Instant updatedAt, List<CategoryResponse> categories,
            List<UUID> mediaIds, OwnerResponse owner, boolean saved, boolean canManage,
            AddressResponse collectionAddress, AddressResponse handoverAddress) {
        ListingResponse(ListingView v) {
            this(v.listing().id(), v.listing().ownerUserId(), v.listing().listingType(),
                    v.listing().communityId(), v.listing().visibilityScope(),
                    new AirportResponse(v.listing().originAirport()),
                    new AirportResponse(v.listing().destinationAirport()), v.listing().title(),
                    v.listing().description(), v.listing().travelDateStart(),
                    v.listing().travelDateEnd(), v.listing().requestedWeightKg(),
                    v.listing().requestedParcelCount(), v.listing().availableCapacityKg(),
                    v.listing().availableParcelCount(), v.listing().maxSingleParcelKg(),
                    v.listing().priceAmount(), v.listing().priceUnit(),
                    v.listing().priceCurrency(), v.listing().collectionPlace(),
                    v.listing().handoverPlace(), v.listing().handoverNotes(),
                    v.listing().status(), v.listing().publishedAt(), v.listing().closesAt(),
                    v.listing().createdAt(), v.listing().updatedAt(),
                    v.categories().stream().map(CategoryResponse::new).toList(), v.mediaIds(),
                    SpareBagController.owner(v.owner()), v.saved(), v.canManage(),
                    address(v.collectionAddress()), address(v.handoverAddress()));
        }
    }

    public record ContactResponse(UUID id, UUID senderListingId,
            UUID passengerListingId, UUID requestedByUserId, UUID respondedByUserId,
            UUID directConversationId, String status, BigDecimal parcelWeightKg,
            BigDecimal proposedPriceAmount, String proposedPriceUnit,
            String priceCurrency, String message, String responseNote,
            Instant createdAt, Instant updatedAt, Instant respondedAt,
            Instant expiresAt, ListingResponse senderListing,
            ListingResponse passengerListing, OwnerResponse otherOwner,
            boolean incoming) {
        ContactResponse(ContactView v) {
            this(v.contact().id(), v.contact().senderListingId(),
                    v.contact().passengerListingId(), v.contact().requestedByUserId(),
                    v.contact().respondedByUserId(), v.contact().directConversationId(),
                    v.contact().status(), v.contact().parcelWeightKg(),
                    v.contact().proposedPriceAmount(), v.contact().proposedPriceUnit(),
                    v.contact().priceCurrency(), v.contact().message(),
                    v.contact().responseNote(), v.contact().createdAt(),
                    v.contact().updatedAt(), v.contact().respondedAt(), v.contact().expiresAt(),
                    new ListingResponse(v.senderListing()), new ListingResponse(v.passengerListing()),
                    owner(v.otherOwner()), v.incoming());
        }
    }

    @GetMapping("/spare-bag/airports")
    public Map<String, Object> airports(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) UUID countryId,
            @RequestParam(defaultValue = "20") int size) {
        p.userId();
        return Map.of("items", listings.airports(search, countryId, size).stream()
                .map(AirportResponse::new).toList());
    }

    @GetMapping("/spare-bag/categories")
    public Map<String, Object> categories(@AuthenticationPrincipal DiasporumUserPrincipal p) {
        p.userId();
        return Map.of("items", listings.categories().stream().map(CategoryResponse::new).toList());
    }

    @PostMapping("/spare-bag/listings")
    public ResponseEntity<ListingResponse> create(
            @AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody ListingRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(new ListingResponse(
                listings.create(p.userId(), request.toInput())));
    }

    @GetMapping("/spare-bag/listings")
    public Page<ListingResponse> discover(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String listingType,
            @RequestParam(required = false) UUID communityId,
            @RequestParam(required = false) UUID originCountryId,
            @RequestParam(required = false) UUID destinationCountryId,
            @RequestParam(required = false) UUID originAirportId,
            @RequestParam(required = false) UUID destinationAirportId,
            @RequestParam(required = false) LocalDate dateFrom,
            @RequestParam(required = false) LocalDate dateTo,
            @RequestParam(required = false) BigDecimal maxPrice,
            @RequestParam(required = false) BigDecimal minimumCapacityKg,
            @RequestParam(required = false) String priceCurrency,
            @RequestParam(required = false) String categoryKey,
            @RequestParam(required = false) BigDecimal maxWeightKg,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        var filters = new DiscoveryFilters(listingType, communityId, originCountryId,
                destinationCountryId, originAirportId, destinationAirportId, dateFrom,
                dateTo, maxPrice, minimumCapacityKg, priceCurrency, categoryKey,
                maxWeightKg, sort);
        return mapPage(listings.discover(p.userId(), filters, cursor, size));
    }

    /** Per-type totals under the same discovery predicates — feeds the
     * dashboard's tab badges and results summary. */
    @GetMapping("/spare-bag/listings/counts")
    public CountsResponse counts(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) UUID communityId,
            @RequestParam(required = false) UUID originCountryId,
            @RequestParam(required = false) UUID destinationCountryId,
            @RequestParam(required = false) UUID originAirportId,
            @RequestParam(required = false) UUID destinationAirportId,
            @RequestParam(required = false) LocalDate dateFrom,
            @RequestParam(required = false) LocalDate dateTo,
            @RequestParam(required = false) BigDecimal maxPrice,
            @RequestParam(required = false) BigDecimal minimumCapacityKg,
            @RequestParam(required = false) String priceCurrency,
            @RequestParam(required = false) String categoryKey,
            @RequestParam(required = false) BigDecimal maxWeightKg) {
        var filters = new DiscoveryFilters(null, communityId, originCountryId,
                destinationCountryId, originAirportId, destinationAirportId, dateFrom,
                dateTo, maxPrice, minimumCapacityKg, priceCurrency, categoryKey,
                maxWeightKg, null);
        return new CountsResponse(listings.countDiscover(p.userId(), filters));
    }

    @GetMapping("/spare-bag/listings/{listingId}")
    public ListingResponse detail(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID listingId) {
        return new ListingResponse(listings.detail(p.userId(), listingId));
    }

    @PutMapping("/spare-bag/listings/{listingId}")
    public ListingResponse update(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID listingId, @Valid @RequestBody ListingRequest request) {
        return new ListingResponse(listings.update(p.userId(), listingId, request.toInput()));
    }

    @PostMapping("/spare-bag/listings/{listingId}/publish")
    public ListingResponse publish(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID listingId) {
        return new ListingResponse(listings.publish(p.userId(), listingId));
    }

    @PostMapping("/spare-bag/listings/{listingId}/pause")
    public ListingResponse pause(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID listingId) {
        return new ListingResponse(listings.pause(p.userId(), listingId));
    }

    @PostMapping("/spare-bag/listings/{listingId}/close")
    public ListingResponse close(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID listingId) {
        return new ListingResponse(listings.close(p.userId(), listingId));
    }

    @GetMapping("/spare-bag/listings/{listingId}/media/{mediaId}/download-url")
    public Map<String, String> mediaUrl(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID listingId, @PathVariable UUID mediaId) {
        return Map.of("downloadUrl", listings.mediaDownloadUrl(p.userId(), listingId, mediaId));
    }

    @PutMapping("/spare-bag/listings/{listingId}/save")
    public ResponseEntity<Void> save(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID listingId) {
        listings.save(p.userId(), listingId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/spare-bag/listings/{listingId}/save")
    public ResponseEntity<Void> unsave(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID listingId) {
        listings.unsave(p.userId(), listingId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/spare-bag/listings/{listingId}/report")
    public ResponseEntity<Map<String, UUID>> reportListing(
            @AuthenticationPrincipal DiasporumUserPrincipal p, @PathVariable UUID listingId,
            @Valid @RequestBody ReportBody request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id",
                listings.report(p.userId(), listingId, request.reason(), request.details())));
    }

    @GetMapping("/me/spare-bag/listings")
    public Page<ListingResponse> mine(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return mapPage(listings.mine(p.userId(), status, cursor, size));
    }

    @GetMapping("/me/spare-bag/listings/saved")
    public Page<ListingResponse> saved(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return mapPage(listings.saved(p.userId(), cursor, size));
    }

    @PostMapping("/spare-bag/contact-requests")
    public ResponseEntity<ContactResponse> createContact(
            @AuthenticationPrincipal DiasporumUserPrincipal p,
            @Valid @RequestBody ContactRequestBody request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(new ContactResponse(
                contacts.create(p.userId(), request.toInput())));
    }

    @GetMapping("/spare-bag/contact-requests")
    public Page<ContactResponse> contactList(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @RequestParam(required = false) String direction,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return mapContactPage(contacts.list(p.userId(), direction, cursor, size));
    }

    @GetMapping("/spare-bag/contact-requests/{contactId}")
    public ContactResponse contactDetail(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID contactId) {
        return new ContactResponse(contacts.detail(p.userId(), contactId));
    }

    @PostMapping("/spare-bag/contact-requests/{contactId}/accept")
    public ContactResponse accept(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID contactId,
            @Valid @RequestBody(required = false) ResponseNoteBody request) {
        return new ContactResponse(contacts.accept(p.userId(), contactId,
                request == null ? null : request.responseNote()));
    }

    @PostMapping("/spare-bag/contact-requests/{contactId}/decline")
    public ContactResponse decline(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID contactId,
            @Valid @RequestBody(required = false) ResponseNoteBody request) {
        return new ContactResponse(contacts.decline(p.userId(), contactId,
                request == null ? null : request.responseNote()));
    }

    @PostMapping("/spare-bag/contact-requests/{contactId}/cancel")
    public ContactResponse cancel(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID contactId) {
        return new ContactResponse(contacts.cancel(p.userId(), contactId));
    }

    @PostMapping("/spare-bag/contact-requests/{contactId}/close")
    public ContactResponse closeContact(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID contactId) {
        return new ContactResponse(contacts.close(p.userId(), contactId));
    }

    @PostMapping("/spare-bag/contact-requests/{contactId}/conversation")
    public ContactResponse conversation(@AuthenticationPrincipal DiasporumUserPrincipal p,
            @PathVariable UUID contactId) {
        return new ContactResponse(contacts.openConversation(p.userId(), contactId));
    }

    @PostMapping("/spare-bag/contact-requests/{contactId}/report")
    public ResponseEntity<Map<String, UUID>> reportContact(
            @AuthenticationPrincipal DiasporumUserPrincipal p, @PathVariable UUID contactId,
            @Valid @RequestBody ReportBody request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id",
                contacts.report(p.userId(), contactId, request.reason(), request.details())));
    }

    private static OwnerResponse owner(Owner owner) {
        return owner == null ? null : new OwnerResponse(owner);
    }

    private static AddressResponse address(Address address) {
        return address == null ? null : new AddressResponse(address);
    }

    private static Page<ListingResponse> mapPage(Page<ListingView> page) {
        return new Page<>(page.items().stream().map(ListingResponse::new).toList(),
                page.nextCursor());
    }

    private static Page<ContactResponse> mapContactPage(Page<ContactView> page) {
        return new Page<>(page.items().stream().map(ContactResponse::new).toList(),
                page.nextCursor());
    }
}
