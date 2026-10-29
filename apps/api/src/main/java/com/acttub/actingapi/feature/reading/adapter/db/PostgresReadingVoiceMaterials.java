package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ReadingVoiceMaterials;
import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 리딩 녹음 코칭(SOMA-791)의 재료. 리딩 회차·대본 줄·녹음은 리딩 표에서, 시작한 코칭 회차는 practices.reading_session_id 로 찾는다. */
@Repository
class PostgresReadingVoiceMaterials implements ReadingVoiceMaterials {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresReadingVoiceMaterials(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Material material(UUID userId, UUID readingSessionId) {
        return transaction.execute(tx -> {
            List<Tuple> session = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT script_id,start_line_id,end_line_id FROM reading_sessions
                    WHERE id=:readingSessionId AND user_id=:userId
                    """, Tuple.class)
                    .setParameter("readingSessionId", readingSessionId)
                    .setParameter("userId", userId));
            if (session.isEmpty()) {
                return null;
            }
            Set<UUID> mine = new LinkedHashSet<>();
            for (Tuple row : NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT unnest(my_character_ids) AS id FROM reading_sessions WHERE id=:readingSessionId
                    """, Tuple.class).setParameter("readingSessionId", readingSessionId))) {
                mine.add(row.get("id", UUID.class));
            }
            // 구간은 시작 줄과 끝 줄의 순번 사이다. 대본을 고쳐 끝 줄이 사라졌으면 대본 끝까지로 본다.
            List<ReadingVoiceMaterial.Line> lines = NativeTuples.list(entityManager.createNativeQuery("""
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
                    .map(row -> new ReadingVoiceMaterial.Line(
                            row.get("id", UUID.class),
                            row.get("ordinal", Integer.class),
                            row.get("kind", String.class),
                            row.get("text", String.class),
                            row.get("character_id", UUID.class),
                            row.get("character_name", String.class)))
                    .toList();
            List<ReadingVoiceMaterial.Recording> recordings = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT DISTINCT ON (line_id) line_id,object_key,content_type,duration_ms,byte_size,
                           transcript,transcript_source
                    FROM reading_recordings
                    WHERE reading_session_id=:readingSessionId AND user_id=:userId AND line_id IS NOT NULL
                    ORDER BY line_id,attempt_no DESC,created_at DESC
                    """, Tuple.class)
                    .setParameter("readingSessionId", readingSessionId)
                    .setParameter("userId", userId))
                    .stream()
                    .map(row -> new ReadingVoiceMaterial.Recording(
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
    public UUID practiceOf(UUID userId, UUID readingSessionId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                "SELECT id FROM practices WHERE user_id=:userId AND reading_session_id=:readingSessionId", Tuple.class)
                .setParameter("userId", userId)
                .setParameter("readingSessionId", readingSessionId));
        return rows.isEmpty() ? null : rows.getFirst().get("id", UUID.class);
    }

    @Override
    public UUID readingSessionOf(UUID userId, UUID practiceId) {
        // 영상으로 이은 회차도 묶음 첫 회차의 리딩 회차를 가리킨다 — 코치는 리딩으로 시작한 회차에서만 묻는다.
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT r.reading_session_id FROM practices p JOIN practices r ON r.id=p.root_id
                WHERE p.id=:practiceId AND p.user_id=:userId AND r.reading_session_id IS NOT NULL
                """, Tuple.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : rows.getFirst().get("reading_session_id", UUID.class);
    }
}
