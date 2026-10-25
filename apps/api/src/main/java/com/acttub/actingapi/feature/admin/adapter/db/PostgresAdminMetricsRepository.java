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
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.admin.app.AdminMetrics;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminAdvisorSession;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminChallenge;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminChallengeVideo;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminFeedbackItem;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminReadingLine;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminReadingRecording;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminReadingSession;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminReadingSessionDetail;
import com.acttub.actingapi.feature.admin.app.AdminMetrics.AdminTurn;
import com.acttub.actingapi.feature.admin.app.AdminMetricsRepository;
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
        // 0.1.0 대화(coach_conversations)와 아직 옮겨지지 않은 옛 코치 세션을 함께 본다. 이관은 같은 id 로
        // 옮기므로 새 표에 있는 옛 행은 뺀다(SOMA-566). 영상은 0.1.0 이 videos, 옛 행이 확정된 업로드다.
        StringBuilder sql = new StringBuilder("""
                SELECT
                    coach.id,
                    coach.created_at,
                    coach.status,
                    coach.close_reason,
                    coach.situation,
                    coach.character_context,
                    coach.goal,
                    coach.object_key,
                    coach.coach_flow
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
                        practice.user_id,
                        NULLIF(conversation.state -> 'practice_loop' ->> 'flow', '') AS coach_flow
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
                        practice.user_id,
                        CAST(NULL AS text) AS coach_flow
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
                        row.get("object_key", String.class),
                        row.get("coach_flow", String.class)))
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
                        row.objectKey(),
                        row.coachFlow()))
                .toList();
    }

    @Override
    public List<AdminMetrics.AdminActorName> actorNames() {
        return list(entityManager.createNativeQuery("""
                SELECT
                    left(md5(CAST(app_user.id AS text)), 8) AS actor,
                    btrim(profile.name) AS name
                FROM users AS app_user
                JOIN user_profiles AS profile
                  ON profile.user_id = app_user.id
                WHERE app_user.deactivated_at IS NULL
                  AND app_user.retention_purged_at IS NULL
                  AND NULLIF(btrim(profile.name), '') IS NOT NULL
                ORDER BY actor
                """, Tuple.class)).stream()
                .map(row -> new AdminMetrics.AdminActorName(
                        row.get("actor", String.class), row.get("name", String.class)))
                .toList();
    }

    @Override
    public List<AdvisorSessionRow> advisorSessions(int limit, Set<String> advisorEmailHashes) {
        if (advisorEmailHashes.isEmpty()) {
            return List.of();
        }
        // 자문위원 판정은 코치 성격 배정(PostgresCoachPersonas)과 같은 이메일 해시다. 이메일 원문은 저장소에
        // 두지 않으므로 DB 에서 같은 방식(소문자·앞뒤 공백 제거 → UTF-8 → SHA-256)으로 해싱해 대조한다.
        // 영상은 세션 목록과 같은 규칙으로 고른다: 새 대화는 지워지지 않은 videos, 옛 행은 확정된 업로드.
        List<String> hashes = advisorEmailHashes.stream().sorted().toList();
        String sql = """
                SELECT
                    coach.id,
                    coach.created_at,
                    coach.status,
                    coach.close_reason,
                    coach.situation,
                    coach.character_context,
                    coach.goal,
                    coach.persona,
                    coach.coach_flow,
                    coach.object_key,
                    left(md5(CAST(coach.user_id AS text)), 8) AS actor,
                    advisor.hash AS advisor_hash
                FROM (
                    SELECT
                        conversation.id,
                        conversation.created_at,
                        conversation.status,
                        conversation.close_reason,
                        practice.situation,
                        practice.character_context,
                        practice.goal,
                        NULLIF(conversation.state -> 'practice_loop' ->> 'persona', '') AS persona,
                        NULLIF(conversation.state -> 'practice_loop' ->> 'flow', '') AS coach_flow,
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
                        CAST(NULL AS text) AS persona,
                        CAST(NULL AS text) AS coach_flow,
                        upload.object_key,
                        practice.user_id
                    FROM coach_sessions AS legacy
                    JOIN practice_sessions AS practice
                      ON practice.id = legacy.practice_session_id
                    LEFT JOIN upload_intents AS upload
                      ON upload.id = practice.upload_intent_id
                     AND upload.status = 'finalized'
                    WHERE NOT EXISTS (
                        SELECT 1 FROM coach_conversations AS moved WHERE moved.id = legacy.id)
                ) AS coach
                JOIN users AS app_user
                  ON app_user.id = coach.user_id
                CROSS JOIN LATERAL (
                    SELECT encode(sha256(convert_to(lower(btrim(app_user.email)), 'UTF8')), 'hex') AS hash
                ) AS advisor
                WHERE advisor.hash IN (%s)
                ORDER BY coach.created_at DESC, coach.id
                LIMIT :limit
                """.formatted(namedParameters("hash", hashes.size()));
        Query query = entityManager.createNativeQuery(sql, Tuple.class).setParameter("limit", limit);
        for (int index = 0; index < hashes.size(); index++) {
            query.setParameter("hash" + index, hashes.get(index));
        }
        List<Tuple> rows = list(query);
        Map<UUID, List<AdminTurn>> turnsBySession = turns(
                rows.stream().map(row -> row.get("id", UUID.class)).toList());
        return rows.stream()
                .map(row -> {
                    UUID id = row.get("id", UUID.class);
                    return new AdvisorSessionRow(new AdminAdvisorSession(
                            id.toString(),
                            row.get("created_at", Instant.class).atOffset(ZoneOffset.UTC),
                            row.get("actor", String.class),
                            row.get("advisor_hash", String.class),
                            row.get("persona", String.class),
                            row.get("status", String.class),
                            row.get("close_reason", String.class),
                            row.get("situation", String.class),
                            row.get("character_context", String.class),
                            row.get("goal", String.class),
                            turnsBySession.getOrDefault(id, List.of()),
                            null,
                            row.get("coach_flow", String.class)), row.get("object_key", String.class));
                })
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
    public List<AdminFeedbackItem> feedback(
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
                        feedback.practice_id,
                        CAST(NULL AS uuid) AS reading_session_id,
                        CAST(NULL AS text) AS reading_mode,
                        CAST(NULL AS boolean) AS reading_record
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
                        rating.practice_id,
                        CAST(NULL AS uuid),
                        CAST(NULL AS text),
                        CAST(NULL AS boolean)
                    FROM note_ratings AS rating
                    UNION ALL
                    -- 리딩 평가는 다시 누르면 덮어쓰므로 마지막으로 고친 시각으로 줄을 세운다.
                    SELECT
                        rating.id,
                        'reading_rating' AS kind,
                        rating.updated_at,
                        rating.user_id,
                        rating.comment AS body,
                        rating.rating,
                        CAST(NULL AS text) AS status,
                        'reading' AS source,
                        CAST(NULL AS text) AS trigger,
                        CAST(NULL AS uuid),
                        session.id,
                        session.mode,
                        session.record
                    FROM reading_session_ratings AS rating
                    JOIN reading_sessions AS session ON session.id = rating.session_id
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
                    id,kind,created_at,'배우 ' || actor_key AS actor,is_team,body,rating,status,source,trigger,practice_id,
                    reading_session_id,reading_mode,reading_record
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
                .map(row -> new AdminFeedbackItem(
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
                        row.get("practice_id", UUID.class),
                        row.get("reading_session_id", UUID.class),
                        row.get("reading_mode", String.class),
                        row.get("reading_record", Boolean.class)))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AdminChallenge> challenges(
            int limit,
            List<String> excludeEmails,
            List<String> excludeActors) {
        return list(entityManager.createNativeQuery("""
                WITH team AS (
                    SELECT id FROM users
                    WHERE lower(COALESCE(email, '')) = ANY(string_to_array(:excludeEmails, ','))
                       OR left(md5(CAST(id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))
                ),
                listed AS (
                    SELECT
                        challenge.*,
                        CASE WHEN challenge.starts_at > now() THEN 'scheduled'
                             WHEN challenge.ends_at > now() THEN 'active'
                             ELSE 'ended' END AS state
                    FROM challenges AS challenge
                    WHERE challenge.deleted_at IS NULL
                )
                SELECT
                    listed.id,
                    listed.line,
                    listed.work,
                    listed.character,
                    listed.origin,
                    CASE WHEN listed.host_user_id IS NULL THEN NULL
                         ELSE left(md5(CAST(listed.host_user_id AS text)), 8) END AS host_actor,
                    (listed.host_user_id IS NOT NULL
                        AND listed.host_user_id IN (SELECT id FROM team)) AS host_is_team,
                    listed.duration_days,
                    CAST(listed.featured_on AS text) AS featured_on,
                    listed.starts_at,
                    listed.ends_at,
                    listed.state,
                    listed.moderation,
                    COALESCE(stats.entries, 0) AS entries,
                    COALESCE(stats.public_entries, 0) AS public_entries,
                    COALESCE(stats.outside_entries, 0) AS outside_entries,
                    COALESCE(like_stats.likes, 0) AS likes,
                    COALESCE(like_stats.outside_likes, 0) AS outside_likes
                FROM listed
                LEFT JOIN (
                    SELECT
                        entry.challenge_id,
                        count(*) AS entries,
                        count(*) FILTER (WHERE entry.visibility='public') AS public_entries,
                        count(*) FILTER (WHERE entry.user_id NOT IN (SELECT id FROM team)) AS outside_entries
                    FROM challenge_entries AS entry
                    WHERE entry.deleted_at IS NULL AND entry.status<>'deleted'
                    GROUP BY entry.challenge_id
                ) AS stats ON stats.challenge_id=listed.id
                LEFT JOIN (
                    SELECT
                        entry.challenge_id,
                        count(*) AS likes,
                        count(*) FILTER (WHERE liked.user_id NOT IN (SELECT id FROM team)) AS outside_likes
                    FROM entry_likes AS liked
                    JOIN challenge_entries AS entry ON entry.id=liked.entry_id
                    WHERE entry.deleted_at IS NULL AND entry.status<>'deleted'
                    GROUP BY entry.challenge_id
                ) AS like_stats ON like_stats.challenge_id=listed.id
                ORDER BY
                    CASE listed.state WHEN 'active' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
                    listed.featured_on DESC NULLS LAST,
                    listed.starts_at DESC,
                    listed.id DESC
                LIMIT :limit
                """, Tuple.class)
                .setParameter("excludeEmails", normalizedEmails(excludeEmails))
                .setParameter("excludeActors", String.join(",", excludeActors))
                .setParameter("limit", limit)).stream()
                .map(Tuple.class::cast)
                .map(row -> new AdminChallenge(
                        row.get("id", UUID.class),
                        row.get("line", String.class),
                        row.get("work", String.class),
                        row.get("character", String.class),
                        row.get("origin", String.class),
                        row.get("host_actor", String.class),
                        Boolean.TRUE.equals(row.get("host_is_team", Boolean.class)),
                        ((Number) row.get("duration_days")).intValue(),
                        row.get("featured_on", String.class),
                        row.get("starts_at", Instant.class).atOffset(ZoneOffset.UTC),
                        row.get("ends_at", Instant.class).atOffset(ZoneOffset.UTC),
                        row.get("state", String.class),
                        row.get("moderation", String.class),
                        ((Number) row.get("entries")).intValue(),
                        ((Number) row.get("public_entries")).intValue(),
                        ((Number) row.get("outside_entries")).intValue(),
                        ((Number) row.get("likes")).intValue(),
                        ((Number) row.get("outside_likes")).intValue()))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AdminChallengeVideo> challengeVideos(
            int limit,
            List<String> excludeEmails,
            List<String> excludeActors,
            String visibility) {
        return list(entityManager.createNativeQuery("""
                SELECT
                    entry.id,
                    left(md5(CAST(entry.user_id AS text)), 8) AS actor,
                    entry.created_at,
                    entry.visibility,
                    entry.status,
                    challenge.origin AS challenge_kind,
                    left(md5(CAST(entry.challenge_id AS text)), 8) AS challenge_ref,
                    (video.id IS NOT NULL) AS has_video,
                    (SELECT count(*) FROM entry_likes AS liked WHERE liked.entry_id=entry.id) AS likes,
                    (SELECT count(*)
                       FROM entry_likes AS liked
                       JOIN users AS liker ON liker.id=liked.user_id
                      WHERE liked.entry_id=entry.id
                        AND NOT (
                          lower(COALESCE(liker.email, '')) = ANY(string_to_array(:excludeEmails, ','))
                          OR left(md5(CAST(liked.user_id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))
                        )) AS outside_likes
                FROM challenge_entries AS entry
                JOIN challenges AS challenge ON challenge.id=entry.challenge_id
                JOIN users AS app_user ON app_user.id=entry.user_id
                LEFT JOIN videos AS video
                  ON video.id=entry.video_id
                 AND video.purged_at IS NULL
                WHERE entry.deleted_at IS NULL
                  AND entry.status<>'deleted'
                  AND challenge.deleted_at IS NULL
                  AND (:visibility='all' OR entry.visibility=:visibility)
                  AND NOT (
                    lower(COALESCE(app_user.email, '')) = ANY(string_to_array(:excludeEmails, ','))
                    OR left(md5(CAST(entry.user_id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))
                  )
                ORDER BY entry.created_at DESC, entry.id DESC
                LIMIT :limit
                """, Tuple.class)
                .setParameter("visibility", visibility)
                .setParameter("excludeEmails", normalizedEmails(excludeEmails))
                .setParameter("excludeActors", String.join(",", excludeActors))
                .setParameter("limit", limit)).stream()
                .map(Tuple.class::cast)
                .map(row -> new AdminChallengeVideo(
                        row.get("id", UUID.class),
                        row.get("actor", String.class),
                        row.get("created_at", Instant.class).atOffset(ZoneOffset.UTC),
                        row.get("visibility", String.class),
                        row.get("status", String.class),
                        row.get("challenge_kind", String.class),
                        row.get("challenge_ref", String.class),
                        row.get("has_video", Boolean.class),
                        ((Number) row.get("likes")).intValue(),
                        ((Number) row.get("outside_likes")).intValue()))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AdminMetrics.AdminChallengeComment> challengeComments(
            int limit,
            List<String> excludeEmails,
            List<String> excludeActors) {
        return list(entityManager.createNativeQuery("""
                WITH team AS (
                    SELECT id FROM users
                    WHERE lower(COALESCE(email, '')) = ANY(string_to_array(:excludeEmails, ','))
                       OR left(md5(CAST(id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))
                )
                SELECT
                    comment.id,
                    comment.entry_id,
                    left(md5(CAST(entry.user_id AS text)), 8) AS entry_actor,
                    (entry.user_id IN (SELECT id FROM team)) AS entry_is_team,
                    entry.visibility AS entry_visibility,
                    left(md5(CAST(entry.challenge_id AS text)), 8) AS challenge_ref,
                    left(md5(CAST(comment.user_id AS text)), 8) AS actor,
                    (comment.user_id IN (SELECT id FROM team)) AS actor_is_team,
                    comment.body,
                    comment.status,
                    comment.created_at
                FROM entry_comments AS comment
                JOIN challenge_entries AS entry ON entry.id=comment.entry_id
                JOIN challenges AS challenge ON challenge.id=entry.challenge_id
                WHERE comment.deleted_at IS NULL
                  AND comment.body IS NOT NULL
                  AND entry.deleted_at IS NULL
                  AND entry.status<>'deleted'
                  AND challenge.deleted_at IS NULL
                ORDER BY comment.created_at DESC, comment.id DESC
                LIMIT :limit
                """, Tuple.class)
                .setParameter("excludeEmails", normalizedEmails(excludeEmails))
                .setParameter("excludeActors", String.join(",", excludeActors))
                .setParameter("limit", limit)).stream()
                .map(Tuple.class::cast)
                .map(row -> new AdminMetrics.AdminChallengeComment(
                        row.get("id", UUID.class),
                        row.get("entry_id", UUID.class),
                        row.get("entry_actor", String.class),
                        row.get("entry_is_team", Boolean.class),
                        row.get("entry_visibility", String.class),
                        row.get("challenge_ref", String.class),
                        row.get("actor", String.class),
                        row.get("actor_is_team", Boolean.class),
                        row.get("body", String.class),
                        row.get("status", String.class),
                        row.get("created_at", Instant.class).atOffset(ZoneOffset.UTC)))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<String> challengeVideoObjectKey(
            UUID entryId,
            List<String> excludeEmails,
            List<String> excludeActors) {
        return list(entityManager.createNativeQuery("""
                SELECT video.object_key
                FROM challenge_entries AS entry
                JOIN challenges AS challenge ON challenge.id=entry.challenge_id
                JOIN users AS app_user ON app_user.id=entry.user_id
                JOIN videos AS video
                  ON video.id=entry.video_id
                 AND video.purged_at IS NULL
                WHERE entry.id=:entryId
                  AND entry.deleted_at IS NULL
                  AND entry.status<>'deleted'
                  AND challenge.deleted_at IS NULL
                  AND NOT (
                    lower(COALESCE(app_user.email, '')) = ANY(string_to_array(:excludeEmails, ','))
                    OR left(md5(CAST(entry.user_id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))
                  )
                """, Tuple.class)
                .setParameter("entryId", entryId)
                .setParameter("excludeEmails", normalizedEmails(excludeEmails))
                .setParameter("excludeActors", String.join(",", excludeActors)))
                .stream()
                .findFirst()
                .map(row -> row.get("object_key", String.class));
    }

    /**
     * ops-core {@code upload_only_rows} 와 같은 판정(finalized · 연습 세션/연습/챌린지 미연결 · 미파기)을 통과한
     * 업로드 한 벌의 영상 키. 살아 있는 {@code videos} 행이 있어야 한다 — 옛 업로드처럼 영상 행이 없으면
     * 파기 여부를 알 수 없으므로 재생하지 않는다.
     */
    @Override
    @Transactional(readOnly = true)
    public Optional<String> uploadOnlyVideoObjectKey(
            UUID uploadIntentId,
            List<String> excludeEmails,
            List<String> excludeActors) {
        return list(entityManager.createNativeQuery("""
                SELECT video.object_key
                FROM upload_intents AS upload
                JOIN users AS app_user ON app_user.id=upload.user_id
                JOIN videos AS video
                  ON video.user_id=upload.user_id
                 AND video.purged_at IS NULL
                 AND ((upload.video_id IS NOT NULL AND video.id=upload.video_id)
                   OR (upload.video_id IS NULL AND video.object_key=upload.object_key))
                WHERE upload.id=:uploadIntentId
                  AND upload.status='finalized'
                  AND NOT EXISTS (
                    SELECT 1 FROM practice_sessions AS legacy WHERE legacy.upload_intent_id=upload.id
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM videos AS candidate
                    WHERE ((upload.video_id IS NOT NULL AND candidate.id=upload.video_id)
                        OR (upload.video_id IS NULL AND candidate.object_key=upload.object_key
                            AND candidate.user_id=upload.user_id))
                      AND (candidate.purged_at IS NOT NULL
                        OR EXISTS (SELECT 1 FROM practices AS practice WHERE practice.video_id=candidate.id)
                        OR EXISTS (SELECT 1 FROM challenge_entries AS entry WHERE entry.video_id=candidate.id))
                  )
                  AND NOT (
                    lower(COALESCE(app_user.email, '')) = ANY(string_to_array(:excludeEmails, ','))
                    OR left(md5(CAST(upload.user_id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))
                  )
                ORDER BY video.created_at DESC
                LIMIT 1
                """, Tuple.class)
                .setParameter("uploadIntentId", uploadIntentId)
                .setParameter("excludeEmails", normalizedEmails(excludeEmails))
                .setParameter("excludeActors", String.join(",", excludeActors)))
                .stream()
                .findFirst()
                .map(row -> row.get("object_key", String.class));
    }

    @Override
    @Transactional(readOnly = true)
    public List<AdminReadingSession> readingSessions(
            int limit,
            String status,
            List<String> excludeEmails,
            List<String> excludeActors) {
        return list(entityManager.createNativeQuery("""
                SELECT
                    session.id,
                    left(md5(CAST(session.user_id AS text)), 8) AS actor,
                    script.title AS script_title,
                    session.started_at,
                    session.ended_at,
                    session.status,
                    session.mode,
                    session.elapsed_seconds,
                    CAST((
                        SELECT count(*)
                        FROM reading_recordings AS recording
                        JOIN script_lines AS recording_line
                          ON recording_line.id=recording.line_id
                         AND recording_line.script_id=script.id
                        WHERE recording.reading_session_id=session.id
                          AND recording.user_id=session.user_id
                          AND recording_line.character_id=ANY(session.my_character_ids)
                    ) AS integer) AS recording_count
                FROM reading_sessions AS session
                JOIN scripts AS script
                  ON script.id=session.script_id
                 AND script.user_id=session.user_id
                JOIN users AS app_user
                  ON app_user.id=session.user_id
                 AND app_user.deactivated_at IS NULL
                 AND app_user.retention_purged_at IS NULL
                JOIN script_lines AS start_line
                  ON start_line.id=session.start_line_id
                 AND start_line.script_id=script.id
                JOIN script_lines AS end_line
                  ON end_line.id=session.end_line_id
                 AND end_line.script_id=script.id
                WHERE (:status='all' OR session.status=:status)
                  AND NOT (
                    lower(COALESCE(app_user.email, '')) = ANY(string_to_array(:excludeEmails, ','))
                    OR left(md5(CAST(session.user_id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))
                  )
                ORDER BY session.started_at DESC, session.id DESC
                LIMIT :limit
                """, Tuple.class)
                .setParameter("status", status)
                .setParameter("excludeEmails", normalizedEmails(excludeEmails))
                .setParameter("excludeActors", String.join(",", excludeActors))
                .setParameter("limit", limit)).stream()
                .map(Tuple.class::cast)
                .map(PostgresAdminMetricsRepository::readingSession)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AdminReadingSessionDetail> readingSession(
            UUID sessionId,
            List<String> excludeEmails,
            List<String> excludeActors) {
        Optional<AdminReadingSession> session = list(entityManager.createNativeQuery("""
                SELECT
                    session.id,
                    left(md5(CAST(session.user_id AS text)), 8) AS actor,
                    script.title AS script_title,
                    session.started_at,
                    session.ended_at,
                    session.status,
                    session.mode,
                    session.elapsed_seconds,
                    CAST((
                        SELECT count(*)
                        FROM reading_recordings AS recording
                        JOIN script_lines AS recording_line
                          ON recording_line.id=recording.line_id
                         AND recording_line.script_id=script.id
                        WHERE recording.reading_session_id=session.id
                          AND recording.user_id=session.user_id
                          AND recording_line.character_id=ANY(session.my_character_ids)
                    ) AS integer) AS recording_count
                FROM reading_sessions AS session
                JOIN scripts AS script
                  ON script.id=session.script_id
                 AND script.user_id=session.user_id
                JOIN users AS app_user
                  ON app_user.id=session.user_id
                 AND app_user.deactivated_at IS NULL
                 AND app_user.retention_purged_at IS NULL
                JOIN script_lines AS start_line
                  ON start_line.id=session.start_line_id
                 AND start_line.script_id=script.id
                JOIN script_lines AS end_line
                  ON end_line.id=session.end_line_id
                 AND end_line.script_id=script.id
                WHERE session.id=:sessionId
                  AND NOT (
                    lower(COALESCE(app_user.email, '')) = ANY(string_to_array(:excludeEmails, ','))
                    OR left(md5(CAST(session.user_id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))
                  )
                """, Tuple.class)
                .setParameter("sessionId", sessionId)
                .setParameter("excludeEmails", normalizedEmails(excludeEmails))
                .setParameter("excludeActors", String.join(",", excludeActors)))
                .stream()
                .findFirst()
                .map(PostgresAdminMetricsRepository::readingSession);
        if (session.isEmpty()) {
            return Optional.empty();
        }

        List<AdminReadingLine> lines = list(entityManager.createNativeQuery("""
                SELECT
                    line.id,
                    line.ordinal,
                    line.kind,
                    character.name AS character_name,
                    line.text,
                    (line.ordinal BETWEEN start_line.ordinal AND end_line.ordinal) AS in_range,
                    COALESCE(line.character_id=ANY(session.my_character_ids), false) AS is_mine
                FROM reading_sessions AS session
                JOIN scripts AS script
                  ON script.id=session.script_id
                 AND script.user_id=session.user_id
                JOIN users AS app_user
                  ON app_user.id=session.user_id
                 AND app_user.deactivated_at IS NULL
                 AND app_user.retention_purged_at IS NULL
                JOIN script_lines AS start_line
                  ON start_line.id=session.start_line_id
                 AND start_line.script_id=script.id
                JOIN script_lines AS end_line
                  ON end_line.id=session.end_line_id
                 AND end_line.script_id=script.id
                JOIN script_lines AS line ON line.script_id=script.id
                LEFT JOIN script_characters AS character
                  ON character.id=line.character_id
                 AND character.script_id=script.id
                WHERE session.id=:sessionId
                  AND NOT (
                    lower(COALESCE(app_user.email, '')) = ANY(string_to_array(:excludeEmails, ','))
                    OR left(md5(CAST(session.user_id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))
                  )
                ORDER BY line.ordinal ASC
                """, Tuple.class)
                .setParameter("sessionId", sessionId)
                .setParameter("excludeEmails", normalizedEmails(excludeEmails))
                .setParameter("excludeActors", String.join(",", excludeActors))).stream()
                .map(Tuple.class::cast)
                .map(row -> new AdminReadingLine(
                        row.get("id", UUID.class),
                        row.get("ordinal", Integer.class),
                        row.get("kind", String.class),
                        row.get("character_name", String.class),
                        row.get("text", String.class),
                        row.get("in_range", Boolean.class),
                        row.get("is_mine", Boolean.class)))
                .toList();

        List<AdminReadingRecording> recordings = list(entityManager.createNativeQuery("""
                SELECT
                    recording.id,
                    recording.line_id,
                    recording.attempt_no,
                    recording.duration_ms,
                    recording.created_at,
                    recording.transcript_source,
                    recording.transcript,
                    recording.matched
                FROM reading_recordings AS recording
                JOIN reading_sessions AS session
                  ON session.id=recording.reading_session_id
                 AND session.user_id=recording.user_id
                JOIN scripts AS script
                  ON script.id=session.script_id
                 AND script.user_id=session.user_id
                JOIN users AS app_user
                  ON app_user.id=session.user_id
                 AND app_user.deactivated_at IS NULL
                 AND app_user.retention_purged_at IS NULL
                JOIN script_lines AS start_line
                  ON start_line.id=session.start_line_id
                 AND start_line.script_id=script.id
                JOIN script_lines AS end_line
                  ON end_line.id=session.end_line_id
                 AND end_line.script_id=script.id
                JOIN script_lines AS line
                  ON line.id=recording.line_id
                 AND line.script_id=script.id
                WHERE session.id=:sessionId
                  AND line.character_id=ANY(session.my_character_ids)
                  AND NOT (
                    lower(COALESCE(app_user.email, '')) = ANY(string_to_array(:excludeEmails, ','))
                    OR left(md5(CAST(session.user_id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))
                  )
                ORDER BY line.ordinal ASC, recording.created_at ASC, recording.id ASC
                """, Tuple.class)
                .setParameter("sessionId", sessionId)
                .setParameter("excludeEmails", normalizedEmails(excludeEmails))
                .setParameter("excludeActors", String.join(",", excludeActors))).stream()
                .map(Tuple.class::cast)
                .map(row -> new AdminReadingRecording(
                        row.get("id", UUID.class),
                        row.get("line_id", UUID.class),
                        row.get("attempt_no", Integer.class),
                        row.get("duration_ms", Integer.class),
                        row.get("created_at", Instant.class).atOffset(ZoneOffset.UTC),
                        row.get("transcript_source", String.class),
                        row.get("transcript", String.class),
                        row.get("matched", Boolean.class)))
                .toList();
        return Optional.of(new AdminReadingSessionDetail(session.orElseThrow(), lines, recordings));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<String> readingRecordingObjectKey(
            UUID recordingId,
            List<String> excludeEmails,
            List<String> excludeActors) {
        return list(entityManager.createNativeQuery("""
                SELECT recording.object_key
                FROM reading_recordings AS recording
                JOIN reading_sessions AS session
                  ON session.id=recording.reading_session_id
                 AND session.user_id=recording.user_id
                JOIN scripts AS script
                  ON script.id=session.script_id
                 AND script.user_id=session.user_id
                JOIN users AS app_user
                  ON app_user.id=session.user_id
                 AND app_user.deactivated_at IS NULL
                 AND app_user.retention_purged_at IS NULL
                JOIN script_lines AS start_line
                  ON start_line.id=session.start_line_id
                 AND start_line.script_id=script.id
                JOIN script_lines AS end_line
                  ON end_line.id=session.end_line_id
                 AND end_line.script_id=script.id
                JOIN script_lines AS line
                  ON line.id=recording.line_id
                 AND line.script_id=script.id
                WHERE recording.id=:recordingId
                  AND line.character_id=ANY(session.my_character_ids)
                  AND recording.content_type='audio/mp4'
                  AND right(recording.object_key, 4)='.m4a'
                  AND NOT (
                    lower(COALESCE(app_user.email, '')) = ANY(string_to_array(:excludeEmails, ','))
                    OR left(md5(CAST(session.user_id AS text)), 8) = ANY(string_to_array(:excludeActors, ','))
                  )
                """, Tuple.class)
                .setParameter("recordingId", recordingId)
                .setParameter("excludeEmails", normalizedEmails(excludeEmails))
                .setParameter("excludeActors", String.join(",", excludeActors)))
                .stream()
                .findFirst()
                .map(row -> row.get("object_key", String.class));
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

    private static String normalizedEmails(List<String> excludeEmails) {
        return String.join(",", excludeEmails.stream()
                .map(email -> email.toLowerCase(Locale.ROOT))
                .toList());
    }

    private static String namedParameters(String prefix, int count) {
        return java.util.stream.IntStream.range(0, count)
                .mapToObj(index -> ":" + prefix + index)
                .collect(java.util.stream.Collectors.joining(","));
    }

    private static AdminReadingSession readingSession(Tuple row) {
        return new AdminReadingSession(
                row.get("id", UUID.class),
                row.get("actor", String.class),
                row.get("script_title", String.class),
                row.get("started_at", Instant.class).atOffset(ZoneOffset.UTC),
                row.get("ended_at", Instant.class) == null
                        ? null
                        : row.get("ended_at", Instant.class).atOffset(ZoneOffset.UTC),
                row.get("status", String.class),
                row.get("mode", String.class),
                row.get("elapsed_seconds", Integer.class),
                row.get("recording_count", Integer.class));
    }

    private record SessionBaseRow(
            UUID coachSessionId,
            OffsetDateTime createdAt,
            String status,
            String closeReason,
            String situation,
            String characterContext,
            String goal,
            String objectKey,
            String coachFlow) {
    }
}
