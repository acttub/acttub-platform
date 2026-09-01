package com.acttub.actingapi.feature.admin.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminTurn;
import com.acttub.actingapi.feature.admin.app.AdminMetricsRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/**
 * 최근 코치 세션을 native projection으로 읽는다. 파이썬 {@code db/store.py} 의 질의를 그대로 옮긴 것이다.
 *
 * <p>여기 있던 집계 한 벌({@code /v2/admin/stats})은 은퇴했다 — 부르는 코드도 보는 사람도
 * 없었고, 그 값은 전부 살아 있는 테이블에서 다시 셀 수 있다 (SOMA-462).
 */
@Repository
class PostgresAdminMetricsRepository implements AdminMetricsRepository {
    private final EntityManager entityManager;

    PostgresAdminMetricsRepository(EntityManager entityManager) {
        this.entityManager = entityManager;
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
        if (!excludeEmails.isEmpty()) {
            sql.append("""
                    LEFT JOIN users AS app_user
                      ON app_user.id = practice.user_id
                    WHERE app_user.email IS NULL
                       OR lower(app_user.email) NOT IN (
                    """);
            sql.append(namedParameters("email", excludeEmails.size())).append(")\n");
        }
        sql.append("ORDER BY coach.created_at DESC LIMIT :limit");

        Query query = entityManager.createNativeQuery(sql.toString(), Tuple.class)
                .setParameter("limit", limit);
        for (int index = 0; index < excludeEmails.size(); index++) {
            query.setParameter(
                    "email" + index,
                    excludeEmails.get(index).toLowerCase(Locale.ROOT));
        }
        List<SessionBaseRow> rows = list(query).stream()
                .map(row -> new SessionBaseRow(
                        row.get("id", UUID.class),
                        row.get("created_at", Instant.class).atOffset(ZoneOffset.UTC),
                        row.get("status", String.class),
                        row.get("close_reason", String.class),
                        row.get("situation", String.class),
                        row.get("character_context", String.class),
                        row.get("goal", String.class),
                        row.get("object_key", String.class)))
                .toList();
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
        return list(entityManager.createNativeQuery("""
                SELECT turn_index, role, text
                FROM coach_turns
                WHERE session_id = :coachSessionId
                ORDER BY turn_index
                """, Tuple.class)
                .setParameter("coachSessionId", coachSessionId)).stream()
                .map(row -> new AdminTurn(
                        row.get("turn_index", Integer.class),
                        row.get("role", String.class),
                        row.get("text", String.class) == null
                                ? ""
                                : row.get("text", String.class)))
                .toList();
    }

    private static String namedParameters(String prefix, int count) {
        return java.util.stream.IntStream.range(0, count)
                .mapToObj(index -> ":" + prefix + index)
                .collect(java.util.stream.Collectors.joining(","));
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
