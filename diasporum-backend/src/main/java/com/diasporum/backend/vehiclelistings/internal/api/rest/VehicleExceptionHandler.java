package com.diasporum.backend.vehiclelistings.internal.api.rest;

import com.diasporum.backend.platform.api.error.ApiError;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/** Keeps vehicle/integration reason codes inside the shared API error envelope. */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(assignableTypes = VehicleController.class)
class VehicleExceptionHandler {

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<ApiError> handle(ResponseStatusException exception, HttpServletRequest request) {
        int status = exception.getStatusCode().value();
        String code = exception.getReason() == null ? "VEHICLE_REQUEST_FAILED" : exception.getReason();
        return ResponseEntity.status(status).body(ApiError.of(status, code, code,
                request.getRequestURI()));
    }
}
