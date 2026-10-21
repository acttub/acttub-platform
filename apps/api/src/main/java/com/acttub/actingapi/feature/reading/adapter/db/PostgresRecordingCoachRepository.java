package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.RecordingCoachRepository;
import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 리딩 녹음 코치의 Postgres 구현 — {@code reading_recording_coaches} (V48). native SQL 만 쓴다(Schema Entity 없음).
 *
 * <p>대화 행은 회차({@code reading_sessions})와 사람({@code users})에 ON DELETE CASCADE 로 매달린다. 회차 삭제·대본 삭제·
 * 탈퇴의 리딩 파기가 회차 행을 지우면 대화도 함께 지워진다. 넣기는 회차가 아직 내 것인지 같은 문장에서 다시 본다
 * ({@code INSERT … SELECT FROM reading_sessions}) — 그사이 지워졌으면 아무것도 넣지 않는다.
 */
@Repository
class PostgresRecordingCoachRepository implements RecordingCoachRepository {

    private static final String SELECT_COACH = """
            SELECT c.id,c.reading_session_id,c.focus_line_id,l.text AS focus_line_text,c.first_message,
                   c.actor_reply,c.second_message,c.created_at,c.updated_at
            FROM reading_recording_coaches c
            LEFT JOIN script_lines l ON l.id=c.focus_line_id
            """;

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresRecordingCoachRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Material material(UUID userId, UUID sessionId) {
        return transaction.execute(tx -> {
            List<Tuple> session = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT script_id,start_line_id,end_line_id FROM reading_sessions
                    WHERE id=:sessionId AND user_id=:userId
                    """, Tuple.class)
                    .setParameter("sessionId", sessionId)
                    .setParameter("userId", userId));
            if (session.isEmpty()) {
                return null;
            }
            Set<UUID> mine = new LinkedHashSet<>();
            for (Tuple row : NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT unnest(my_character_ids) AS id FROM reading_sessions WHERE id=:sessionId
                    """, Tuple.class).setParameter("sessionId", sessionId))) {
                mine.add(row.get("id", UUID.class));
            }
            // 구간은 시작 줄과 끝 줄의 순번 사이다. 대본을 고쳐 끝 줄이 사라졌으면 대본 끝까지로 본다.
            List<RecordingCoachMaterial.Line> lines = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT l.id,l.ordinal,l.kind,l.text,l.character_id,c.name AS character_name
                    FROM script_lines l
                    LEFT JOIN script_characters c ON c.id=l.character_id
                    WHERE l.script_id=:scriptId
                      AND l.ordinal>=COALESCE((SELECT ordinal FROM script_lines WHERE id=:startLineId),0)
                      AND l.ordinal<=COALESCE((SELECT ordinal FROM script_lines WHERE id=:endLineId),2147483647)
                    ORDER BY l.ordinal
                    """, Tuple.class)
                    .setParameter("scriptId", session.getFirst().get("script_id", UUID.class))
                    .setParameter("startLineId", session.getFirst().get("start_line_id", UUID.class))
                    .setParameter("endLineId", session.getFirst().get("end_line_id", UUID.class)))
                    .stream()
                    .map(row -> new RecordingCoachMaterial.Line(
                            row.get("id", UUID.class),
                            row.get("ordinal", Integer.class),
                            row.get("kind", String.class),
                            row.get("text", String.class),
                            row.get("character_id", UUID.class),
                            row.get("character_name", String.class)))
                    .toList();
            List<RecordingCoachMaterial.Recording> recordings = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT DISTINCT ON (line_id) line_id,object_key,content_type,duration_ms,byte_size,
                           transcript,transcript_source
                    FROM reading_recordings
                    WHERE reading_session_id=:sessionId AND user_id=:userId AND line_id IS NOT NULL
                    ORDER BY line_id,attempt_no DESC,created_at DESC
                    """, Tuple.class)
                    .setParameter("sessionId", sessionId)
                    .setParameter("userId", userId))
                    .stream()
                    .map(row -> new RecordingCoachMaterial.Recording(
                            row.get("line_id", UUID.class),
                            row.get("object_key", String.class),
                            row.get("content_type", String.class),
                            row.get("duration_ms", Integer.class),
                            row.get("byte_size", Long.class),
                            row.get("transcript", String.class),
                            row.get("transcript_source", String.class)))
                    .toList();
            return new Material(Set.copyOf(mine), lines, recordings);
        });
    }

    @Override
    public Coach findBySession(UUID userId, UUID sessionId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                SELECT_COACH + " WHERE c.reading_session_id=:sessionId AND c.user_id=:userId", Tuple.class)
                .setParameter("sessionId", sessionId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : coach(rows.getFirst());
    }

    @Override
    public Coach find(UUID userId, UUID coachId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                SELECT_COACH + " WHERE c.id=:coachId AND c.user_id=:userId", Tuple.class)
                .setParameter("coachId", coachId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : coach(rows.getFirst());
    }

    @Override
    public Coach insertFirst(UUID userId, UUID sessionId, FirstTurn first, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                INSERT INTO reading_recording_coaches(id,user_id,reading_session_id,model,clip_count,first_design,
                                                      first_message,focus_line_id,created_at,updated_at)
                SELECT :id,:userId,s.id,:model,:clipCount,CAST(:design AS text),:message,CAST(:focusLineId AS uuid),:now,:now
                FROM reading_sessions s
                WHERE s.id=:sessionId AND s.user_id=:userId
                ON CONFLICT (reading_session_id) DO NOTHING
                """)
                .setParameter("id", UUID.randomUUID())
                .setParameter("userId", userId)
                .setParameter("sessionId", sessionId)
                .setParameter("model", first.model())
                .setParameter("clipCount", first.clipCount())
                .setParameter("design", first.design())
                .setParameter("message", first.message())
                .setParameter("focusLineId", first.focusLineId() == null ? null : first.focusLineId().toString())
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate());
        return findBySession(userId, sessionId);
    }

    @Override
    public Coach saveSecond(UUID userId, UUID coachId, String actorReply, String secondMessage, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE reading_recording_coaches
                SET actor_reply=:reply,second_message=:message,updated_at=:now
                WHERE id=:coachId AND user_id=:userId AND second_message IS NULL
                """)
                .setParameter("reply", actorReply)
                .setParameter("message", secondMessage)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("coachId", coachId)
                .setParameter("userId", userId)
                .executeUpdate());
        return find(userId, coachId);
    }

    private static Coach coach(Tuple row) {
        return new Coach(
                row.get("id", UUID.class),
                row.get("reading_session_id", UUID.class),
                row.get("focus_line_id", UUID.class),
                row.get("focus_line_text", String.class),
                row.get("first_message", String.class),
                row.get("actor_reply", String.class),
                row.get("second_message", String.class),
                row.get("created_at", Instant.class),
                row.get("updated_at", Instant.class));
    }
}
