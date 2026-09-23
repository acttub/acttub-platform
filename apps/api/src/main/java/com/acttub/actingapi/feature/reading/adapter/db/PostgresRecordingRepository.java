package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ReadingRecordingCleanup;
import com.acttub.actingapi.feature.reading.app.RecordingRepository;
import com.acttub.actingapi.feature.reading.app.SessionViews.RecordingView;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.schema.TranscriptSource;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 녹음의 최종 저장은 <b>회차 행을 {@code FOR UPDATE} 로 잡고 주인이 맞는지 다시 본다</b>(회차와 같은 규칙). 같은 줄의
 * 올리기가 겹치면 여기서 줄을 서므로 시도 번호 판정과 총량 계산이 정확하다. 반영하지 못한 객체(거절·재전송·대체된 앞의
 * 것)의 키는 같은 트랜잭션에서 정리 장부에 남긴다 — 커밋 뒤 저장소가 실패해도 키를 잃지 않는다.
 */
@Repository
class PostgresRecordingRepository implements RecordingRepository {
    private static final String RECORDING_COLUMNS = """
            r.id,r.line_id,r.attempt_no,r.duration_ms,r.content_type,r.byte_size,r.transcript,r.transcript_source,r.matched,
            r.object_key
            """;

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final ReadingRecordingCleanup cleanup;

    PostgresRecordingRepository(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            ReadingRecordingCleanup cleanup) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.cleanup = cleanup;
    }

    @Override
    public Precheck precheck(UUID userId, UUID sessionId, UUID lineId, UUID requestId, int attemptNo) {
        if (!owned(sessionId, userId, false)) {
            return new Precheck(PrecheckOutcome.NOT_FOUND, null);
        }
        if (!myDialogueLineInRange(sessionId, lineId)) {
            return new Precheck(PrecheckOutcome.INVALID_LINE, null);
        }
        RecordingView replayed = byRequest(userId, requestId);
        if (replayed != null) {
            return new Precheck(PrecheckOutcome.REPLAYED, replayed);
        }
        RecordingView current = byLine(sessionId, lineId, false);
        if (current != null && current.attemptNo() >= attemptNo) {
            return new Precheck(PrecheckOutcome.IGNORED, current);
        }
        return new Precheck(PrecheckOutcome.OK, null);
    }

    @Override
    public Stored store(UUID userId, UUID sessionId, NewRecording recording, long quotaBytes, Instant now) {
        return transaction.execute(status -> {
            // 회차 행을 잡는다 — 이관·삭제 뒤에는 남의 것이라 404 이고, 올린 객체는 장부가 지운다.
            if (!owned(sessionId, userId, true)) {
                return rejected(StoreOutcome.NOT_FOUND, userId, recording.objectKey(), now);
            }
            if (!myDialogueLineInRange(sessionId, recording.lineId())) {
                return rejected(StoreOutcome.INVALID_LINE, userId, recording.objectKey(), now);
            }
            RecordingView replayed = byRequest(userId, recording.requestId());
            if (replayed != null) {
                return new Stored(StoreOutcome.REPLAYED, replayed,
                        List.of(cleanup.schedule(userId, List.of(recording.objectKey()), now)));
            }
            RecordingView current = byLine(sessionId, recording.lineId(), true);
            if (current != null && current.attemptNo() >= recording.attemptNo()) {
                return new Stored(StoreOutcome.IGNORED, current,
                        List.of(cleanup.schedule(userId, List.of(recording.objectKey()), now)));
            }
            long stored = ((Number) entityManager.createNativeQuery(
                    "SELECT COALESCE(SUM(byte_size),0) FROM reading_recordings WHERE user_id=:userId")
                    .setParameter("userId", userId)
                    .getSingleResult()).longValue();
            long replacedBytes = current == null ? 0 : current.byteSize();
            if (stored - replacedBytes + recording.byteSize() > quotaBytes) {
                return rejected(StoreOutcome.QUOTA, userId, recording.objectKey(), now);
            }
            if (current == null) {
                UUID id = UUID.randomUUID();
                entityManager.createNativeQuery("""
                        INSERT INTO reading_recordings(id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,
                                                       content_type,byte_size,duration_ms,transcript,transcript_source,matched,
                                                       created_at,updated_at)
                        VALUES (:id,:userId,:sessionId,:lineId,:requestId,:attemptNo,:objectKey,:contentType,:byteSize,
                                :durationMs,:transcript,:transcriptSource,:matched,:now,:now)
                        """)
                        .setParameter("id", id)
                        .setParameter("userId", userId)
                        .setParameter("sessionId", sessionId)
                        .setParameter("lineId", recording.lineId())
                        .setParameter("requestId", recording.requestId())
                        .setParameter("attemptNo", recording.attemptNo())
                        .setParameter("objectKey", recording.objectKey())
                        .setParameter("contentType", recording.contentType())
                        .setParameter("byteSize", recording.byteSize())
                        .setParameter("durationMs", recording.durationMs())
                        .setParameter("transcript", recording.transcript())
                        .setParameter("transcriptSource", recording.transcriptSource())
                        .setParameter("matched", recording.matched())
                        .setParameter("now", now.atOffset(ZoneOffset.UTC))
                        .executeUpdate();
                return new Stored(StoreOutcome.CREATED, byId(id), List.of());
            }
            // 같은 줄의 다시 말하기 — 행은 하나이고 앞 객체는 장부로 지운다.
            entityManager.createNativeQuery("""
                    UPDATE reading_recordings
                    SET request_id=:requestId,attempt_no=:attemptNo,object_key=:objectKey,content_type=:contentType,
                        byte_size=:byteSize,duration_ms=:durationMs,transcript=CAST(:transcript AS text),
                        transcript_source=:transcriptSource,matched=CAST(:matched AS boolean),updated_at=:now
                    WHERE id=:id
                    """)
                    .setParameter("requestId", recording.requestId())
                    .setParameter("attemptNo", recording.attemptNo())
                    .setParameter("objectKey", recording.objectKey())
                    .setParameter("contentType", recording.contentType())
                    .setParameter("byteSize", recording.byteSize())
                    .setParameter("durationMs", recording.durationMs())
                    .setParameter("transcript", recording.transcript())
                    .setParameter("transcriptSource", recording.transcriptSource())
                    .setParameter("matched", recording.matched())
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("id", current.id())
                    .executeUpdate();
            return new Stored(StoreOutcome.REPLACED, byId(current.id()),
                    List.of(cleanup.schedule(userId, List.of(current.objectKey()), now)));
        });
    }

    @Override
    public List<UUID> delete(UUID userId, UUID recordingId, Instant now) {
        return transaction.execute(status -> {
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT object_key FROM reading_recordings WHERE id=:id AND user_id=:userId FOR UPDATE
                    """, Tuple.class)
                    .setParameter("id", recordingId)
                    .setParameter("userId", userId));
            if (rows.isEmpty()) {
                return null;
            }
            entityManager.createNativeQuery("DELETE FROM reading_recordings WHERE id=:id")
                    .setParameter("id", recordingId)
                    .executeUpdate();
            return List.of(cleanup.schedule(userId, List.of(rows.getFirst().get("object_key", String.class)), now));
        });
    }

    private Stored rejected(StoreOutcome outcome, UUID userId, String objectKey, Instant now) {
        return new Stored(outcome, null, List.of(cleanup.schedule(userId, List.of(objectKey), now)));
    }

    /** 내 회차인가. 보관 행(회차 연결이 빈 녹음)은 회차가 없으므로 여기서 걸린다. */
    private boolean owned(UUID sessionId, UUID userId, boolean lock) {
        return !NativeTuples.list(entityManager.createNativeQuery(
                "SELECT id FROM reading_sessions WHERE id=:sessionId AND user_id=:userId" + (lock ? " FOR UPDATE" : ""),
                Tuple.class)
                .setParameter("sessionId", sessionId)
                .setParameter("userId", userId)).isEmpty();
    }

    /** 그 회차의 구간 안 내 대사 줄인가 — 상대역 줄·지문·구간 밖·남의 줄은 아니다. */
    private boolean myDialogueLineInRange(UUID sessionId, UUID lineId) {
        return !NativeTuples.list(entityManager.createNativeQuery("""
                SELECT l.id
                FROM reading_sessions rs
                JOIN script_lines s ON s.id=rs.start_line_id
                JOIN script_lines e ON e.id=rs.end_line_id
                JOIN script_lines l ON l.script_id=rs.script_id
                WHERE rs.id=:sessionId
                  AND l.id=:lineId
                  AND l.kind='dialogue'
                  AND l.ordinal BETWEEN s.ordinal AND e.ordinal
                  AND l.character_id=ANY(rs.my_character_ids)
                """, Tuple.class)
                .setParameter("sessionId", sessionId)
                .setParameter("lineId", lineId)).isEmpty();
    }

    private RecordingView byRequest(UUID userId, UUID requestId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                "SELECT " + RECORDING_COLUMNS + " FROM reading_recordings r WHERE r.user_id=:userId AND r.request_id=:requestId",
                Tuple.class)
                .setParameter("userId", userId)
                .setParameter("requestId", requestId));
        return rows.isEmpty() ? null : view(rows.getFirst());
    }

    private RecordingView byLine(UUID sessionId, UUID lineId, boolean lock) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                "SELECT " + RECORDING_COLUMNS
                        + " FROM reading_recordings r WHERE r.reading_session_id=:sessionId AND r.line_id=:lineId"
                        + (lock ? " FOR UPDATE" : ""),
                Tuple.class)
                .setParameter("sessionId", sessionId)
                .setParameter("lineId", lineId));
        return rows.isEmpty() ? null : view(rows.getFirst());
    }

    private RecordingView byId(UUID id) {
        return view(NativeTuples.list(entityManager.createNativeQuery(
                "SELECT " + RECORDING_COLUMNS + " FROM reading_recordings r WHERE r.id=:id", Tuple.class)
                .setParameter("id", id)).getFirst());
    }

    private static RecordingView view(Tuple row) {
        return new RecordingView(
                row.get("id", UUID.class),
                row.get("line_id", UUID.class),
                row.get("attempt_no", Integer.class),
                row.get("duration_ms", Integer.class),
                row.get("content_type", String.class),
                row.get("byte_size", Number.class).longValue(),
                row.get("transcript", String.class),
                TranscriptSource.valueOf(row.get("transcript_source", String.class).toUpperCase(Locale.ROOT)).dbValue(),
                row.get("matched", Boolean.class),
                row.get("object_key", String.class),
                null,
                null);
    }
}
