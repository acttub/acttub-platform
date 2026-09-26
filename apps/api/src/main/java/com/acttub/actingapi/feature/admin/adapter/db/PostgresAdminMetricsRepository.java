package com.acttub.actingapi.feature.admin.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminTurn;
import com.acttub.actingapi.feature.admin.app.AdminMetricsRepository;
import com.acttub.actingapi.feature.admin.app.AdminMetricsRepository.FeedbackRow;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import org.hibernate.Session;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 최근 코치 세션을 native projection으로 읽는다. 파이썬 {@code db/store.py} 의 질의를 그대로 옮긴 것이다.
 *
 * <p>여기 있던 집계 한 벌({@code /v2/admin/stats})은 은퇴했다 — 부르는 코드도 보는 사람도
 * 없었고, 그 값은 전부 살아 있는 테이블에서 다시 셀 수 있다 (SOMA-462).
 */
@Repository
class PostgresAdminMetricsRepository implements AdminMetricsRepository {
    /**
     * ops 수집기 CORE_SQL 을 옮긴 것. 위치 바인드 {@code ?} 는 팀 이메일 목록·팀 배우 가명 목록 두 자리다.
     * Hibernate 의 이름 파라미터 해석을 거치지 않도록 JDBC 로 직접 돈다 — 600줄짜리 SQL 의
     * {@code ::} 캐스트와 주석 속 따옴표·콜론을 Hibernate 가 다시 읽을 이유가 없다.
     */
    private static final String OPS_CORE_SQL = load("/admin/ops-core.sql");
    /** 수집기 psql 경로와 같은 상한. 넘기면 이 트랜잭션만 취소된다. */
    private static final String OPS_CORE_TIMEOUT = "SET LOCAL statement_timeout = '20s'";

    private final EntityManager entityManager;

    PostgresAdminMetricsRepository(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public List<SessionRow> sessions(int limit, List<String> excludeEmails) {
        // 1.0 대화(coach_conversations)와 아직 옮겨지지 않은 옛 코치 세션을 함께 본다. 이관은 같은 id 로
        // 옮기므로 새 표에 있는 옛 행은 뺀다(SOMA-566). 영상은 1.0 이 videos, 옛 행이 확정된 업로드다.
        StringBuilder sql = new StringBuilder("""
                SELECT
                    coach.id,
                    coach.created_at,
                    coach.status,
                    coach.close_reason,
                    coach.situation,
                    coach.character_context,
                    coach.goal,
                    coach.object_key
                FROM (
                    SELECT
                        conversation.id,
                        conversation.created_at,
                        conversation.status,
                        conversation.close_reason,
                        practice.situation,
                        practice.character_context,
                        practice.goal,
                        video.object_key,
                        practice.user_id
                    FROM coach_conversations AS conversation
                    JOIN practices AS practice
                      ON practice.id = conversation.practice_id
                    LEFT JOIN videos AS video
                      ON video.id = practice.video_id
                     AND video.purged_at IS NULL
                    UNION ALL
                    SELECT
                        legacy.id,
                        legacy.created_at,
                        legacy.status::text,
                        legacy.close_reason::text,
                        practice.situation,
                        practice.character_context,
                        practice.goal,
                        upload.object_key,
                        practice.user_id
                    FROM coach_sessions AS legacy
                    LEFT JOIN practice_sessions AS practice
                      ON practice.id = legacy.practice_session_id
                    LEFT JOIN upload_intents AS upload
                      ON upload.id = practice.upload_intent_id
                     AND upload.status = 'finalized'
                    WHERE NOT EXISTS (
                        SELECT 1 FROM coach_conversations AS moved WHERE moved.id = legacy.id)
                ) AS coach
                """);
        if (!excludeEmails.isEmpty()) {
            sql.append("""
                    LEFT JOIN users AS app_user
                      ON app_user.id = coach.user_id
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
        Map<UUID, List<AdminTurn>> turnsBySession = turns(
                rows.stream().map(SessionBaseRow::coachSessionId).toList());
        return rows.stream()
                .map(row -> new SessionRow(
                        row.coachSessionId(),
                        row.createdAt(),
                        row.status(),
                        row.closeReason(),
                        row.situation(),
                        row.characterContext(),
                        row.goal(),
                        turnsBySession.getOrDefault(row.coachSessionId(), List.of()),
                        row.objectKey()))
                .toList();
    }

    private Map<UUID, List<AdminTurn>> turns(List<UUID> coachSessionIds) {
        if (coachSessionIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, List<AdminTurn>> turnsBySession = new HashMap<>();
        for (Tuple row : list(entityManager.createNativeQuery("""
                SELECT conversation_id AS session_id, turn_index, role, text
                FROM coach_messages
                WHERE conversation_id IN (:coachSessionIds)
                UNION ALL
                SELECT session_id, turn_index, role::text, text
                FROM coach_turns
                WHERE session_id IN (:coachSessionIds)
                  AND NOT EXISTS (
                      SELECT 1 FROM coach_conversations AS moved WHERE moved.id = coach_turns.session_id)
                ORDER BY session_id, turn_index
                """, Tuple.class)
                .setParameter("coachSessionIds", coachSessionIds))) {
            turnsBySession.computeIfAbsent(row.get("session_id", UUID.class), key -> new ArrayList<>())
                .add(new AdminTurn(
                        row.get("turn_index", Integer.class),
                        row.get("role", String.class),
                        row.get("text", String.class) == null
                                ? ""
                                : row.get("text", String.class)));
        }
        return turnsBySession;
    }

    @Override
    @Transactional(readOnly = true)
    public List<FeedbackRow> feedback(
            int limit,
            List<String> excludeEmails,
            List<String> excludeActors,
            boolean includeTeam) {
        String emails = String.join(",", excludeEmails.stream()
                .map(email -> email.toLowerCase(Locale.ROOT))
                .toList());
        String actors = String.join(",", excludeActors);
        return list(entityManager.createNativeQuery("""
                WITH combined AS (
                    SELECT
                        feedback.id,
                        'exit_survey' AS kind,
                        feedback.created_at,
                        feedback.user_id,
                        feedback.body,
                        CAST(NULL AS text) AS rating,
                        CASE WHEN feedback.body IS NULL THEN 'dismissed' ELSE 'answered' END AS status,
                        feedback.screen AS source,
                        feedback.trigger,
                        feedback.practice_id
                    FROM practice_feedback AS feedback
                    UNION ALL
                    SELECT
                        rating.id,
                        'note_rating' AS kind,
                        rating.created_at,
                        rating.user_id,
                        rating.comment AS body,
                        rating.rating,
                        CAST(NULL AS text) AS status,
                        'practice_note' AS source,
                        CAST(NULL AS text) AS trigger,
                        rating.practice_id
                    FROM note_ratings AS rating
                ), marked AS (
                    SELECT
                        combined.*,
                        left(md5(CAST(combined.user_id AS text)), 8) AS actor_key,
                        (lower(COALESCE(app_user.email, '')) = ANY(string_to_array(:excludeEmails, ','))
                         OR left(md5(CAST(combined.user_id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))) AS is_team
                    FROM combined
                    JOIN users AS app_user ON app_user.id=combined.user_id
                )
                SELECT
                    id,kind,created_at,'배우 ' || actor_key AS actor,is_team,body,rating,status,source,trigger,practice_id
                FROM marked
                WHERE :includeTeam OR NOT is_team
                ORDER BY created_at DESC, kind ASC, id ASC
                LIMIT :limit
                """, Tuple.class)
                .setParameter("excludeEmails", emails)
                .setParameter("excludeActors", actors)
                .setParameter("includeTeam", includeTeam)
                .setParameter("limit", limit)).stream()
                .map(Tuple.class::cast)
                .map(row -> new FeedbackRow(
                        row.get("id", UUID.class),
                        row.get("kind", String.class),
                        row.get("created_at", Instant.class).atOffset(ZoneOffset.UTC),
                        row.get("actor", String.class),
                        row.get("is_team", Boolean.class),
                        row.get("body", String.class),
                        row.get("rating", String.class),
                        row.get("status", String.class),
                        row.get("source", String.class),
                        row.get("trigger", String.class),
                        row.get("practice_id", UUID.class)))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public String opsCore(List<String> excludeEmails, List<String> excludeActors) {
        String excluded = String.join(",", excludeEmails.stream()
                .map(email -> email.toLowerCase(Locale.ROOT))
                .toList());
        String actors = String.join(",", excludeActors);
        return entityManager.unwrap(Session.class).doReturningWork(connection -> {
            try (Statement guard = connection.createStatement()) {
                guard.execute(OPS_CORE_TIMEOUT);
                guard.execute("SET TRANSACTION READ ONLY");
            }
            try (PreparedStatement statement = connection.prepareStatement(OPS_CORE_SQL)) {
                statement.setString(1, excluded);
                statement.setString(2, actors);
                try (ResultSet result = statement.executeQuery()) {
                    if (!result.next()) {
                        throw new IllegalStateException("ops core query returned no row");
                    }
                    return result.getString(1);
                }
            }
        });
    }

    private static String load(String resource) {
        try (InputStream input = PostgresAdminMetricsRepository.class.getResourceAsStream(resource)) {
            if (input == null) {
                throw new IllegalStateException("admin sql is missing: " + resource);
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException exc) {
            throw new IllegalStateException("failed to read admin sql: " + resource, exc);
        }
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
