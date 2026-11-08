package com.diasporum.backend.platform.api.error;

import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * Global translation of exceptions to the shared {@link ApiError} envelope.
 *
 * <p>Technical plumbing only: no module-specific business rules belong here.
 * Feature modules translate their domain exceptions to status codes in their own
 * {@code internal/api/rest} layer or dedicated handlers.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex,
            HttpServletRequest request) {
        Map<String, String> fields = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors()
                .forEach(error -> fields.putIfAbsent(error.getField(), error.getDefaultMessage()));
        return ResponseEntity.badRequest().body(ApiError.of(
                400, "VALIDATION_FAILED", "Request validation failed",
                request.getRequestURI(), fields));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiError> handleParameterType(MethodArgumentTypeMismatchException ex,
            HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiError.of(
                400, "VALIDATION_FAILED", "Invalid request parameter",
                request.getRequestURI(), Map.of(ex.getName(), "Invalid value")));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> handleUnreadableBody(HttpMessageNotReadableException ex,
            HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiError.of(
                400, "MALFORMED_REQUEST", "Request body could not be read",
                request.getRequestURI()));
    }

    @ExceptionHandler(ErrorResponseException.class)
    ResponseEntity<ApiError> handleErrorResponse(ErrorResponseException ex,
            HttpServletRequest request) {
        HttpStatusCode status = ex.getStatusCode();
        // ResponseStatusException reasons are this codebase's client-facing machine
        // codes (e.g. MATCHMAKING_NOT_ELIGIBLE) — forward them instead of flattening
        // every error to the raw HTTP status string.
        String reason = ex instanceof ResponseStatusException responseStatus
                ? responseStatus.getReason() : null;
        String code = reason == null || reason.isBlank() ? status.toString() : reason;
        return ResponseEntity.status(status).body(ApiError.of(
                status.value(), code, code, request.getRequestURI()));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception ex, HttpServletRequest request) {
        log.error("Unhandled exception on {} {}", request.getMethod(), request.getRequestURI(), ex);
        return ResponseEntity.internalServerError().body(ApiError.of(
                500, "INTERNAL_ERROR", "An unexpected error occurred",
                request.getRequestURI()));
    }
}
