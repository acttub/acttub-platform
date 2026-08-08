package com.acttub.actingapi.harness;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** wrapper.py:BackendRuntime.db_projection과 동일한 비교용 projection. */
@Service
@Profile("contract")
public class DbProjectionService {
    private static final List<String> DEFAULT_PROJECTION = List.of(
            "external_operations",
            "coach_sessions",
            "refresh_tokens",
            "practice_sessions",
            "practice_reports");

    private final JdbcTemplate jdbc;
    private final OffsettableClock clock;

    public DbProjectionService(JdbcTemplate jdbc, OffsettableClock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public Map<String, Object> project(Collection<?> requested) {
        Set<String> include = new LinkedHashSet<>();
        if (requested != null) {
            requested.forEach(value -> include.add(String.valueOf(value)));
        }
        if (include.isEmpty()) {
            include.addAll(DEFAULT_PROJECTION);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        if (include.contains("external_operations")) {
            out.put("external_operations", externalOperations());
        }
        if (include.contains("coach_sessions")) {
            out.put("coach_sessions", coachSessions());
        }
        if (include.contains("refresh_tokens")) {
            out.put("refresh_tokens", refreshTokens());
        }
        if (include.contains("practice_sessions")) {
            out.put("practice_sessions", practiceSessions());
        }
        if (include.contains("practice_reports")) {
            out.put("practice_reports", practiceReports());
        }
        return out;
    }

    private List<Map<String, Object>> externalOperations() {
        Instant now = clock.instant();
        return jdbc.query("""
                SELECT request_id, kind::text AS kind,
                       status::text AS status, attempt_count, error_code,
                       (lease_token IS NOT NULL) AS has_lease_token,
                       lease_expires_at, session_id,
                       (response_payload IS NOT NULL) AS has_response_payload
                FROM external_operations
                ORDER BY request_id, kind::text
                """, (rs, rowNum) -> {
                    OffsetDateTime expiresAt = rs.getObject("lease_expires_at", OffsetDateTime.class);
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("request_id", uuid(rs, "request_id"));
                    row.put("kind", rs.getString("kind"));
                    row.put("status", rs.getString("status"));
                    row.put("attempt_count", rs.getInt("attempt_count"));
                    row.put("error_code", rs.getString("error_code"));
                    row.put("has_lease_token", rs.getBoolean("has_lease_token"));
                    row.put("lease_expired", expiresAt == null
                            ? null
                            : !expiresAt.toInstant().isAfter(now));
                    row.put("practice_session_id", uuid(rs, "session_id"));
                    row.put("has_response_payload", rs.getBoolean("has_response_payload"));
                    return row;
                });
    }

    private List<Map<String, Object>> coachSessions() {
        return jdbc.query("""
                SELECT s.id, s.status::text AS status,
                       s.close_reason::text AS close_reason,
                       s.practice_session_id,
                       (SELECT count(*) FROM coach_turns t
                        WHERE t.session_id = s.id) AS turn_count
                FROM coach_sessions s
                ORDER BY s.created_at, s.id
                """, (rs, rowNum) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", uuid(rs, "id"));
                    row.put("status", rs.getString("status"));
                    row.put("close_reason", rs.getString("close_reason"));
                    row.put("practice_session_id", uuid(rs, "practice_session_id"));
                    row.put("turn_count", rs.getLong("turn_count"));
                    return row;
                });
    }

    private List<Map<String, Object>> refreshTokens() {
        List<Map<String, Object>> rows = jdbc.query("""
                SELECT user_id, replaced_by_id,
                       (revoked_at IS NOT NULL) AS revoked
                FROM refresh_tokens
                ORDER BY issued_at, id
                """, (rs, rowNum) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("index", rowNum);
                    row.put("user_id", uuid(rs, "user_id"));
                    row.put("revoked", rs.getBoolean("revoked"));
                    row.put("has_replacement", rs.getObject("replaced_by_id") != null);
                    return row;
                });
        return rows;
    }

    private List<Map<String, Object>> practiceSessions() {
        return jdbc.query("""
                SELECT id, status::text AS status FROM practice_sessions
                ORDER BY created_at, id
                """, (rs, rowNum) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", uuid(rs, "id"));
                    row.put("status", rs.getString("status"));
                    return row;
                });
    }

    private List<Map<String, Object>> practiceReports() {
        return jdbc.query("""
                SELECT practice_session_id, report_type::text AS report_type
                FROM practice_reports ORDER BY created_at
                """, (rs, rowNum) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("practice_session_id", uuid(rs, "practice_session_id"));
                    row.put("report_type", rs.getString("report_type"));
                    return row;
                });
    }

    private static String uuid(ResultSet resultSet, String column) throws SQLException {
        UUID value = resultSet.getObject(column, UUID.class);
        return value == null ? null : value.toString();
    }
}
