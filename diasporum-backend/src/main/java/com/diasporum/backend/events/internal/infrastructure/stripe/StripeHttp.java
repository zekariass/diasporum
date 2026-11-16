package com.diasporum.backend.events.internal.infrastructure.stripe;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Minimal form/JSON HTTP client for the events-scoped Stripe adapter. Mirrors the
 * shop's provider client (which is module-internal and cannot be imported); no
 * provider SDK is used.
 */
final class StripeHttp {
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();
    private static final ObjectMapper JSON = new ObjectMapper();

    private StripeHttp() {
    }

    /** Provider responded with a non-2xx status. */
    static final class StripeException extends RuntimeException {
        private final int status;
        private final Map<String, Object> body;

        StripeException(int status, Map<String, Object> body) {
            super("stripe status " + status);
            this.status = status;
            this.body = body;
        }

        int status() {
            return status;
        }

        String errorCode() {
            Object code = obj(body.get("error")).get("code");
            return code == null ? "provider_error_" + status : String.valueOf(code);
        }
    }

    static Map<String, Object> send(String method, String url, Map<String, String> headers,
            String formBody) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(20));
        headers.forEach(builder::header);
        if (formBody != null) {
            builder.header("Content-Type", "application/x-www-form-urlencoded");
            builder.method(method, HttpRequest.BodyPublishers.ofString(formBody));
        } else {
            builder.method(method, HttpRequest.BodyPublishers.noBody());
        }
        try {
            HttpResponse<String> response = CLIENT.send(builder.build(),
                    HttpResponse.BodyHandlers.ofString());
            Map<String, Object> parsed = parse(response.body());
            if (response.statusCode() / 100 != 2) {
                throw new StripeException(response.statusCode(), parsed);
            }
            return parsed;
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "PROVIDER_UNREACHABLE");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "PROVIDER_UNREACHABLE");
        }
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> parse(String body) {
        if (body == null || body.isBlank()) {
            return new LinkedHashMap<>();
        }
        try {
            Object value = JSON.readValue(body, Object.class);
            return value instanceof Map<?, ?> map ? (Map<String, Object>) map : new LinkedHashMap<>();
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    static String form(List<String[]> pairs) {
        return pairs.stream().map(p -> URLEncoder.encode(p[0], StandardCharsets.UTF_8) + "="
                + URLEncoder.encode(p[1], StandardCharsets.UTF_8)).collect(Collectors.joining("&"));
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> obj(Object value) {
        return value instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>();
    }

    static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    static long lng(Object value) {
        if (value instanceof Number n) {
            return n.longValue();
        }
        try {
            return value == null ? 0L : Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException e) {
            return 0L;
        }
    }
}
