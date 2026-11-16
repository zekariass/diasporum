package com.diasporum.backend.shopmarketplace.internal.infrastructure;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Minimal JSON/form HTTP client shared by provider adapters; no provider SDK leaks. */
public final class ProviderHttp {
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();
    private static final ObjectMapper JSON = new ObjectMapper();

    private ProviderHttp() {
    }

    /** Provider responded with a non-2xx status. */
    public static final class ProviderException extends RuntimeException {
        private final int status;
        private final Map<String, Object> body;

        public ProviderException(int status, Map<String, Object> body) {
            super("provider status " + status);
            this.status = status;
            this.body = body;
        }

        public int status() {
            return status;
        }

        public Map<String, Object> body() {
            return body;
        }
    }

    public static Map<String, Object> send(String method, String url, Map<String, String> headers,
            String contentType, String body) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(20));
        headers.forEach(builder::header);
        if (body != null) {
            builder.header("Content-Type", contentType);
            builder.method(method, HttpRequest.BodyPublishers.ofString(body));
        } else {
            builder.method(method, HttpRequest.BodyPublishers.noBody());
        }
        try {
            HttpResponse<String> response = CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            Map<String, Object> parsed = parse(response.body());
            if (response.statusCode() / 100 != 2) {
                throw new ProviderException(response.statusCode(), parsed);
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
    public static Map<String, Object> parse(String body) {
        if (body == null || body.isBlank()) {
            return new LinkedHashMap<>();
        }
        try {
            Object value = JSON.readValue(body, Object.class);
            if (value instanceof Map<?, ?> map) {
                return (Map<String, Object>) map;
            }
            Map<String, Object> wrapped = new LinkedHashMap<>();
            wrapped.put("data", value);
            return wrapped;
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    public static String json(Object value) {
        return JSON.writeValueAsString(value);
    }

    public static String form(List<String[]> pairs) {
        return pairs.stream().map(p -> URLEncoder.encode(p[0], StandardCharsets.UTF_8) + "="
                + URLEncoder.encode(p[1], StandardCharsets.UTF_8)).collect(Collectors.joining("&"));
    }

    public static List<String[]> pairs() {
        return new ArrayList<>();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(Object value) {
        return value instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    public static List<Object> arr(Object value) {
        return value instanceof List<?> l ? (List<Object>) l : List.of();
    }

    public static String str(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    public static boolean bool(Object value) {
        return Boolean.TRUE.equals(value) || "true".equals(String.valueOf(value));
    }

    public static Long lng(Object value) {
        if (value instanceof Number n) {
            return n.longValue();
        }
        try {
            return value == null ? null : Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
