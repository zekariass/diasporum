package com.diasporum.backend.feed.internal.application;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/** Durable whole-request replay for Feed publication endpoints. */
@Service
public class FeedPublicationService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public FeedPublicationService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    /**
     * Executes a publication and its replay-record insert in one transaction.
     * A failed action therefore leaves neither published content nor a success
     * response that could be replayed later.
     */
    @Transactional
    public <T> T execute(UUID userId, String operation, Map<String, Object> request,
            TypeReference<T> responseType, Supplier<T> action) {
        String key = normalizeKey(request.get("idempotencyKey"));
        if (key == null) {
            return action.get();
        }

        String operationKey = operation + ":" + key;
        String requestHash = requestHash(request);
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",
                Object.class, userId + ":" + operationKey);
        jdbc.update("DELETE FROM idempotency_keys WHERE user_id=?"
                + " AND operation_key=? AND expires_at<=now()", userId, operationKey);

        var previous = jdbc.query("SELECT request_hash,response_body::text"
                        + " FROM idempotency_keys WHERE user_id=? AND operation_key=?",
                (rs, i) -> new PreviousResponse(rs.getString(1), rs.getString(2)),
                userId, operationKey).stream().findFirst();
        if (previous.isPresent()) {
            if (!previous.get().requestHash().equals(requestHash)
                    || previous.get().responseBody() == null) {
                throw conflict();
            }
            try {
                return mapper.readValue(previous.get().responseBody(), responseType);
            } catch (JacksonException e) {
                throw new IllegalStateException("Stored publication response is invalid", e);
            }
        }

        T response = action.get();
        try {
            jdbc.update("INSERT INTO idempotency_keys(user_id,operation_key,request_hash,"
                            + "response_status,response_body,expires_at) VALUES(?,?,?,200,"
                            + "?::jsonb,now()+interval '7 days')",
                    userId, operationKey, requestHash, mapper.writeValueAsString(response));
        } catch (JacksonException e) {
            throw new IllegalStateException("Publication response could not be stored", e);
        }
        return response;
    }

    private String requestHash(Map<String, Object> request) {
        var canonical = new TreeMap<>(request);
        canonical.remove("idempotencyKey");
        try {
            byte[] json = mapper.writeValueAsBytes(canonical);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(json));
        } catch (JacksonException | NoSuchAlgorithmException e) {
            throw new IllegalStateException("Publication request could not be hashed", e);
        }
    }

    private static String normalizeKey(Object value) {
        if (value == null) {
            return null;
        }
        if (!(value instanceof String raw)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "FEED_IDEMPOTENCY_KEY_INVALID");
        }
        String key = raw.trim();
        if (key.isEmpty()) {
            return null;
        }
        if (key.length() > 120) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "FEED_IDEMPOTENCY_KEY_INVALID");
        }
        return key;
    }

    private static ResponseStatusException conflict() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "IDEMPOTENCY_KEY_REUSED");
    }

    private record PreviousResponse(String requestHash, String responseBody) {
    }
}
