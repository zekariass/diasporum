package com.diasporum.backend.identity.internal.api.rest;

import com.diasporum.backend.platform.api.error.ApiError;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Translates identity-module auth failures into proper HTTP statuses.
 * Auth services signal failures via IllegalArgumentException carrying a
 * machine-readable code (e.g. INVALID_CREDENTIALS); without this handler they
 * surfaced as generic 500s.
 */
@RestControllerAdvice(assignableTypes = AuthController.class)
class AuthExceptionHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<ApiError> handleAuthError(IllegalArgumentException ex,
            HttpServletRequest request) {
        String code = ex.getMessage() == null ? "" : ex.getMessage();
        int status = switch (code) {
            case "EMAIL_TAKEN", "IDENTITY_ALREADY_LINKED", "LAST_AUTH_METHOD" -> 409;
            case "INVALID_CREDENTIALS", "INVALID_EXTERNAL_TOKEN" -> 401;
            case "ACCOUNT_RESTRICTED", "EMAIL_NOT_VERIFIED" -> 403;
            default -> 400;
        };
        String errorCode = code.matches("[A-Z_]+") ? code : "BAD_REQUEST";
        return ResponseEntity.status(status).body(ApiError.of(
                status, errorCode, messageFor(errorCode), request.getRequestURI()));
    }

    /** Unique-constraint races (e.g. concurrent duplicate registration). */
    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<ApiError> handleDuplicate(DuplicateKeyException ex,
            HttpServletRequest request) {
        return ResponseEntity.status(409).body(ApiError.of(
                409, "CONFLICT", "Resource already exists", request.getRequestURI()));
    }

    private static String messageFor(String code) {
        return switch (code) {
            case "EMAIL_TAKEN" -> "An account with this email already exists";
            case "IDENTITY_ALREADY_LINKED" -> "This external identity is linked to another account";
            case "LAST_AUTH_METHOD" -> "Cannot remove the last sign-in method";
            case "INVALID_CREDENTIALS" -> "Invalid email or password";
            case "INVALID_EXTERNAL_TOKEN" -> "External identity token is invalid";
            case "ACCOUNT_RESTRICTED" -> "This account is restricted";
            case "EMAIL_NOT_VERIFIED" -> "External identity email is not verified";
            case "PASSWORD_TOO_SHORT" -> "Password must be at least 8 characters";
            default -> "Request could not be processed";
        };
    }
}
