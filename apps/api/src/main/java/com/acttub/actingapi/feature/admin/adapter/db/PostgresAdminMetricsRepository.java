package com.acttub.actingapi.feature.admin.adapter.db;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminTurn;
import com.acttub.actingapi.feature.admin.app.AdminMetricsRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 최근 코치 세션을 손으로 쓴 SQL 로 읽는다. 파이썬 {@code db/store.py} 의 질의를 그대로 옮긴 것이다.
 *
 * <p>여기 있던 집계 한 벌({@code /v2/admin/stats})은 은퇴했다 — 부르는 코드도 보는 사람도
 * 없었고, 그 값은 전부 살아 있는 테이블에서 다시 셀 수 있다 (SOMA-462).
 */
@Repository
class PostgresAdminMetricsRepository implements AdminMetricsRepository {
    private final JdbcTemplate jdbc;

    PostgresAdminMetricsRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<SessionRow> sessions(int limit, List<String> excludeEmails) {
        StringBuilder sql = new StringBuilder("""
                SELECT
                    coach.id,
                    coach.created_at,
                    coach.status,
                    coach.close_reason,
                    practice.situation,
                    practice.character_context,
                    practice.goal,
                    upload.object_key
                FROM coach_sessions AS coach
                LEFT JOIN practice_sessions AS practice
                  ON practice.id = coach.practice_session_id
                LEFT JOIN upload_intents AS upload
                  ON upload.id = practice.upload_intent_id
                 AND upload.status = 'finalized'
                """);
        List<Object> arguments = new ArrayList<>();
        if (!excludeEmails.isEmpty()) {
            sql.append("""
                    LEFT JOIN users AS app_user
                      ON app_user.id = practice.user_id
                    WHERE app_user.email IS NULL
                       OR lower(app_user.email) NOT IN (
                    """);
            sql.append(placeholders(excludeEmails.size())).append(")\n");
            excludeEmails.stream().map(String::toLowerCase).forEach(arguments::add);
        }
        sql.append("ORDER BY coach.created_at DESC LIMIT ?");
        arguments.add(limit);

        List<SessionBaseRow> rows = jdbc.query(sql.toString(), (result, rowNumber) ->
                new SessionBaseRow(
                        result.getObject("id", UUID.class),
                        result.getObject("created_at", OffsetDateTime.class),
                        result.getString("status"),
                        result.getString("close_reason"),
                        result.getString("situation"),
                        result.getString("character_context"),
                        result.getString("goal"),
                        result.getString("object_key")), arguments.toArray());
        // Python도 세션마다 turns를 한 번씩 조회한다. 이번 이관에서는 그 N+1을 그대로 둔다.
        return rows.stream()
                .map(row -> new SessionRow(
                        row.coachSessionId(),
                        row.createdAt(),
                        row.status(),
                        row.closeReason(),
                        row.situation(),
                        row.characterContext(),
                        row.goal(),
                        turns(row.coachSessionId()),
                        row.objectKey()))
                .toList();
    }

    private List<AdminTurn> turns(UUID coachSessionId) {
        return jdbc.query("""
                SELECT turn_index, role, text
                FROM coach_turns
                WHERE session_id = ?
                ORDER BY turn_index
                """, (result, rowNumber) -> new AdminTurn(
                result.getInt("turn_index"),
                result.getString("role"),
                result.getString("text") == null ? "" : result.getString("text")), coachSessionId);
    }

    private static String placeholders(int count) {
        return String.join(",", java.util.Collections.nCopies(count, "?"));
    }

    private record SessionBaseRow(
            UUID coachSessionId,
            OffsetDateTime createdAt,
            String status,
            String closeReason,
            String situation,
            String characterContext,
            String goal,
            String objectKey) {
    }
}
