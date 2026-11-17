package com.diasporum.backend.sparebag.internal.infrastructure.persistence.v2;

import java.sql.Array;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/** Small JDBC helpers shared by the v2 Spare Bag repositories. */
final class SqlSupport {

    private SqlSupport() {
    }

    /**
     * Postgres array literal for {@code ?::text[]}. Only ever called with keys
     * the services normalised to {@code [A-Z0-9_]} (category keys), so no
     * quoting is required.
     */
    static String textArray(Collection<String> values) {
        if (values == null) {
            return null;
        }
        return values.stream().collect(Collectors.joining(",", "{", "}"));
    }

    /** Postgres array literal for {@code ?::uuid[]}. */
    static String uuidArray(Collection<UUID> values) {
        return values.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
    }

    static List<String> textList(ResultSet rs, String column) throws SQLException {
        Array array = rs.getArray(column);
        if (array == null) {
            return null;
        }
        return Arrays.asList((String[]) array.getArray());
    }

    static Instant ts(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    static LocalDate date(ResultSet rs, String column) throws SQLException {
        Date value = rs.getDate(column);
        return value == null ? null : value.toLocalDate();
    }

    static Timestamp ts(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }

    static Date date(LocalDate value) {
        return value == null ? null : Date.valueOf(value);
    }
}
