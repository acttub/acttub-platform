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

/**
 * 리딩 녹음 코칭(SOMA-791)의 재료: 리딩 회차·대본 줄·녹음.
 */
@Repository
class PostgresReadingVoiceMaterials implements ReadingVoiceMaterials {

    private final EntityManager entityManager;
    private final ReadingSessionJpaRepository sessions;
    private final ScriptLineJpaRepository scriptLines;
    private final TransactionTemplate transaction;

    PostgresReadingVoiceMaterials(EntityManager entityManager, ReadingSessionJpaRepository sessions,
            ScriptLineJpaRepository scriptLines, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.sessions = sessions;
        this.scriptLines = scriptLines;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Material material(UUID userId, UUID readingSessionId) {
        return transaction.execute(tx -> {
            ReadingSessionJpaRepository.Range session = sessions.range(readingSessionId, userId).orElse(null);
            if (session == null) {
                return null;
            }
            Set<UUID> mine = new LinkedHashSet<>(List.of(session.getMyCharacterIds()));
            List<ReadingVoiceMaterial.Line> lines =
                    scriptLines.castInRange(session.getScriptId(), session.getStartLineId(), session.getEndLineId()).stream()
                            .map(row -> new ReadingVoiceMaterial.Line(row.getId(), row.getOrdinal(), row.getKind().dbValue(),
                                    row.getText(), row.getCharacterId(), row.getCharacterName()))
                            .toList();
            // 줄마다 마지막 녹음을 고르는 DISTINCT ON 은 HQL 에 없어 native SQL 로 둔다(§5-9).
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
}
