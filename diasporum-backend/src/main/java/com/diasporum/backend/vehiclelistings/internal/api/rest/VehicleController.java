package com.diasporum.backend.vehiclelistings.internal.api.rest;

import com.diasporum.backend.security.DiasporumUserPrincipal;
import com.diasporum.backend.vehiclelistings.internal.application.VehicleCatalogService;
import com.diasporum.backend.vehiclelistings.internal.application.VehicleService;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleInput;
import com.diasporum.backend.vehiclelistings.internal.domain.VehiclePage;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleSearch;
import com.diasporum.backend.vehiclelistings.internal.domain.VehicleView;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Authenticated Vehicles Marketplace API. */
@RestController
@RequestMapping("/api/v1")
public class VehicleController {

    private final VehicleService vehicles;
    private final VehicleCatalogService catalogue;

    public VehicleController(VehicleService vehicles, VehicleCatalogService catalogue) {
        this.vehicles = vehicles;
        this.catalogue = catalogue;
    }

    public record VehicleRequest(UUID businessAccountId, String visibilityScope, UUID communityId,
            @Size(max = 20) List<UUID> selectedCommunityIds, String listingPurpose, UUID categoryId,
            UUID makeId, UUID modelId, UUID variantId, @Size(max = 220) String title,
            @Size(max = 20000) String description, @Min(1886) Integer modelYear,
            @Min(0) Integer mileage, String mileageUnit, String fuelType, String transmission,
            String driveType, String bodyType, @Min(0) Integer engineSizeCc,
            @Size(max = 120) String colour, @Min(1) Integer doors, @Min(1) Integer seats,
            String condition, @Min(1886) Integer registrationYear, @Min(0) Integer previousOwners,
            Map<String, Object> additionalAttributes, LocalDate motExpiry, String serviceHistory,
            @DecimalMin("0.0") BigDecimal priceAmount, @Size(min = 3, max = 3) String currencyCode,
            String pricePeriod, @DecimalMin("0.0") BigDecimal rentalDeposit,
            @Min(0) Integer mileageAllowance, @Size(max = 10000) String rentalConditions,
            LocationRequest location, List<UUID> featureIds, Instant expiresAt,
            boolean clearLocation, boolean clearExpiry, Set<String> clearFields) {

        VehicleInput toInput() {
            return new VehicleInput(businessAccountId, visibilityScope, communityId,
                    selectedCommunityIds, listingPurpose, categoryId, makeId, modelId, variantId,
                    title, description, modelYear, mileage, mileageUnit, fuelType, transmission,
                    driveType, bodyType, engineSizeCc, colour, doors, seats, condition,
                    registrationYear, previousOwners, additionalAttributes, motExpiry, serviceHistory,
                    priceAmount, currencyCode, pricePeriod, rentalDeposit, mileageAllowance,
                    rentalConditions, location == null ? null : location.toInput(), featureIds,
                    expiresAt, clearLocation, clearExpiry, clearFields);
        }
    }

    public record LocationRequest(@Size(max = 120) String city, @Size(max = 120) String region,
            @Size(max = 1000) String formattedAddress, Double discoveryLatitude,
            Double discoveryLongitude) {
        VehicleInput.LocationInput toInput() {
            return new VehicleInput.LocationInput(city, region, formattedAddress,
                    discoveryLatitude, discoveryLongitude);
        }
    }

    public record MediaRequest(@Size(max = 5) List<UUID> mediaIds, UUID coverMediaId) {
    }

    public record ContactRequest(UUID actingBusinessAccountId) {
    }

    public record ReportRequest(@Size(max = 40) String reason,
            @Size(max = 4000) String details) {
    }

    @GetMapping("/vehicles/categories")
    public Map<String, Object> categories(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        principal.userId();
        return Map.of("items", catalogue.categories());
    }

    @GetMapping("/vehicles/makes")
    public Map<String, Object> makes(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        principal.userId();
        return Map.of("items", catalogue.makes());
    }

    @GetMapping("/vehicles/makes/{makeId}/models")
    public Map<String, Object> models(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID makeId) {
        principal.userId();
        return Map.of("items", catalogue.models(makeId));
    }

    @GetMapping("/vehicles/models/{modelId}/variants")
    public Map<String, Object> variants(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID modelId) {
        principal.userId();
        return Map.of("items", catalogue.variants(modelId));
    }

    @GetMapping("/vehicles/features")
    public Map<String, Object> features(@AuthenticationPrincipal DiasporumUserPrincipal principal) {
        principal.userId();
        return Map.of("items", catalogue.features());
    }

    @PostMapping("/vehicles")
    public ResponseEntity<VehicleView> create(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @Valid @RequestBody VehicleRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(vehicles.create(principal.userId(), request.toInput()));
    }

    @GetMapping("/vehicles")
    public VehiclePage discover(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String keyword, @RequestParam(required = false) String purpose,
            @RequestParam(required = false) UUID categoryId, @RequestParam(required = false) UUID makeId,
            @RequestParam(required = false) UUID modelId, @RequestParam(required = false) UUID variantId,
            @RequestParam(required = false) Integer yearMin, @RequestParam(required = false) Integer yearMax,
            @RequestParam(required = false) Integer mileageMin,
            @RequestParam(required = false) Integer mileageMax,
            @RequestParam(required = false) BigDecimal priceMin,
            @RequestParam(required = false) BigDecimal priceMax,
            @RequestParam(required = false) String currency, @RequestParam(required = false) String fuelType,
            @RequestParam(required = false) String transmission, @RequestParam(required = false) String bodyType,
            @RequestParam(required = false) String condition,
            @RequestParam(required = false) Integer engineSizeMin,
            @RequestParam(required = false) Integer engineSizeMax,
            @RequestParam(required = false) UUID countryId, @RequestParam(required = false) UUID communityId,
            @RequestParam(required = false) String city, @RequestParam(required = false) String region,
            @RequestParam(required = false) Double originLatitude,
            @RequestParam(required = false) Double originLongitude,
            @RequestParam(required = false) Double radiusMeters,
            @RequestParam(required = false) List<String> attribute,
            @RequestParam(required = false) String sort, @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return vehicles.discover(principal.userId(), new VehicleSearch(keyword, purpose, categoryId,
                makeId, modelId, variantId, yearMin, yearMax, mileageMin, mileageMax, priceMin,
                priceMax, currency, fuelType, transmission, bodyType, condition, engineSizeMin,
                engineSizeMax, countryId, communityId, city, region, originLatitude, originLongitude,
                radiusMeters, attributes(attribute), sort), cursor, size);
    }

    @GetMapping("/vehicles/{vehicleId}")
    public VehicleView detail(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId) {
        return vehicles.detail(principal.userId(), vehicleId);
    }

    @PatchMapping("/vehicles/{vehicleId}")
    public VehicleView update(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId, @Valid @RequestBody VehicleRequest request) {
        return vehicles.update(principal.userId(), vehicleId, request.toInput());
    }

    @DeleteMapping("/vehicles/{vehicleId}")
    public ResponseEntity<Void> remove(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId) {
        vehicles.remove(principal.userId(), vehicleId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/vehicles/{vehicleId}/publish")
    public VehicleView publish(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId) {
        return vehicles.publish(principal.userId(), vehicleId);
    }

    @PostMapping("/vehicles/{vehicleId}/pause")
    public VehicleView pause(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId) {
        return vehicles.pause(principal.userId(), vehicleId);
    }

    @PostMapping("/vehicles/{vehicleId}/sold")
    public VehicleView sold(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId) {
        return vehicles.sold(principal.userId(), vehicleId);
    }

    @PostMapping("/vehicles/{vehicleId}/rented")
    public VehicleView rented(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId) {
        return vehicles.rented(principal.userId(), vehicleId);
    }

    @PutMapping("/vehicles/{vehicleId}/media")
    public VehicleView media(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId, @Valid @RequestBody MediaRequest request) {
        return vehicles.replaceMedia(principal.userId(), vehicleId, request.mediaIds(),
                request.coverMediaId());
    }

    @GetMapping("/vehicles/{vehicleId}/media/{mediaId}/download-url")
    public Map<String, String> mediaUrl(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId, @PathVariable UUID mediaId) {
        return Map.of("downloadUrl", vehicles.mediaDownloadUrl(principal.userId(), vehicleId, mediaId));
    }

    @GetMapping("/me/vehicles")
    public VehiclePage owned(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) UUID businessAccountId,
            @RequestParam(required = false) String status, @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int size) {
        return vehicles.owned(principal.userId(), businessAccountId, status, cursor, size);
    }

    @PutMapping("/vehicles/{vehicleId}/save")
    public ResponseEntity<Void> save(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId) {
        vehicles.save(principal.userId(), vehicleId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/vehicles/{vehicleId}/save")
    public ResponseEntity<Void> unsave(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId) {
        vehicles.unsave(principal.userId(), vehicleId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me/vehicles/saved")
    public VehiclePage saved(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @RequestParam(required = false) String cursor, @RequestParam(defaultValue = "20") int size) {
        return vehicles.saved(principal.userId(), cursor, size);
    }

    @PostMapping("/vehicles/{vehicleId}/contact")
    public Map<String, UUID> contact(@AuthenticationPrincipal DiasporumUserPrincipal principal,
            @PathVariable UUID vehicleId, @RequestBody(required = false) ContactRequest request) {
        UUID conversationId = vehicles.contact(principal.userId(), vehicleId,
                request == null ? null : request.actingBusinessAccountId());
        return Map.of("conversationId", conversationId);
    }

    @PostMapping("/vehicles/{vehicleId}/report")
    public ResponseEntity<Map<String, UUID>> report(
            @AuthenticationPrincipal DiasporumUserPrincipal principal, @PathVariable UUID vehicleId,
            @Valid @RequestBody ReportRequest request) {
        UUID id = vehicles.report(principal.userId(), vehicleId, request.reason(), request.details());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id));
    }

    private static Map<String, String> attributes(List<String> values) {
        Map<String, String> result = new LinkedHashMap<>();
        if (values == null) return result;
        for (String value : values) {
            int separator = value == null ? -1 : value.indexOf('=');
            if (separator <= 0 || separator == value.length() - 1) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_ATTRIBUTE_FILTER");
            }
            if (result.put(value.substring(0, separator), value.substring(separator + 1)) != null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DUPLICATE_ATTRIBUTE_FILTER");
            }
        }
        return result;
    }
}
