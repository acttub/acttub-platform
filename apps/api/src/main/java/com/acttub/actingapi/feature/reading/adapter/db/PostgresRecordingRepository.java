package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ReadingRecordingCleanup;
import com.acttub.actingapi.feature.reading.app.RecordingRepository;
import com.acttub.actingapi.feature.reading.app.SessionViews.RecordingView;
import com.acttub.actingapi.feature.reading.domain.RecordingRules;
import com.acttub.actingapi.platform.schema.TranscriptSource;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 녹음의 최종 저장은 <b>회차 행을 {@code FOR UPDATE} 로 잡고 주인이 맞는지 다시 본다</b>(회차와 같은 규칙). 같은 줄의
 * 올리기가 겹치면 여기서 줄을 서므로 시도 번호 판정과 총량 계산이 정확하다. 반영하지 못한 객체(거절·재전송·대체된 앞의
 * 것)의 키는 같은 트랜잭션에서 정리 장부에 남긴다 — 커밋 뒤 저장소가 실패해도 키를 잃지 않는다. 단, 저장된 행이 가리키는
 * 키는 남기지 않는다({@code unstored}).
 *
 * <p>문장은 {@link ReadingRecordingJpaRepository}·{@link ReadingSessionJpaRepository} 에 있다. 녹음 올리기는 요청이 많은 경로라
 * 요청 하나가 보내는 문장의 수와 트랜잭션 수를 {@code RecordingRepositoryIT} 가 지킨다(apps/api/CONTRACT.md §5-9).
 */
@Repository
class PostgresRecordingRepository implements RecordingRepository {
    private final ReadingRecordingJpaRepository recordings;
    private final ReadingSessionJpaRepository sessions;
    private final TransactionTemplate transaction;
    private final ReadingRecordingCleanup cleanup;

    PostgresRecordingRepository(
            ReadingRecordingJpaRepository recordings,
            ReadingSessionJpaRepository sessions,
            PlatformTransactionManager transactionManager,
            ReadingRecordingCleanup cleanup) {
        this.recordings = recordings;
        this.sessions = sessions;
        this.transaction = new TransactionTemplate(transactionManager);
        this.cleanup = cleanup;
    }

    @Override
    public Precheck precheck(UUID userId, UUID sessionId, UUID lineId, UUID requestId, int attemptNo) {
        if (sessions.owned(sessionId, userId).isEmpty()) {
            return new Precheck(PrecheckOutcome.NOT_FOUND, null);
        }
        if (myDialogueLine(sessionId, lineId) == null) {
            return new Precheck(PrecheckOutcome.INVALID_LINE, null);
        }
        RecordingView replayed = view(recordings.byRequest(userId, requestId));
        if (replayed != null) {
            return new Precheck(PrecheckOutcome.REPLAYED, replayed);
        }
        RecordingView current = view(recordings.byLine(sessionId, lineId));
        if (current != null && current.attemptNo() >= attemptNo) {
            return new Precheck(PrecheckOutcome.IGNORED, current);
        }
        return new Precheck(PrecheckOutcome.OK, null);
    }

    @Override
    public Stored store(UUID userId, UUID sessionId, NewRecording recording, long quotaBytes, Instant now) {
        return transaction.execute(status -> {
            // 회차 행을 잡는다 — 이관·삭제 뒤에는 남의 것이라 404 이고, 올린 객체는 장부가 지운다.
            if (sessions.lockOwned(sessionId, userId).isEmpty()) {
                return rejected(StoreOutcome.NOT_FOUND, userId, sessionId, recording.objectKey(), now);
            }
            String line = myDialogueLine(sessionId, recording.lineId());
            if (line == null) {
                return rejected(StoreOutcome.INVALID_LINE, userId, sessionId, recording.objectKey(), now);
            }
            RecordingView replayed = view(recordings.byRequest(userId, recording.requestId()));
            if (replayed != null) {
                return new Stored(StoreOutcome.REPLAYED, replayed, unstored(userId, sessionId, recording.objectKey(), now));
            }
            RecordingView current = view(recordings.lockByLine(sessionId, recording.lineId()));
            if (current != null && current.attemptNo() >= recording.attemptNo()) {
                return new Stored(StoreOutcome.IGNORED, current, unstored(userId, sessionId, recording.objectKey(), now));
            }
            long stored = recordings.storedBytes(userId);
            long replacedBytes = current == null ? 0 : current.byteSize();
            if (stored - replacedBytes + recording.byteSize() > quotaBytes) {
                return rejected(StoreOutcome.QUOTA, userId, sessionId, recording.objectKey(), now);
            }
            Boolean matched = RecordingRules.matched(recording.transcript(), line);
            TranscriptSource source = TranscriptSource.valueOf(recording.transcriptSource().toUpperCase(Locale.ROOT));
            if (current == null) {
                UUID id = UUID.randomUUID();
                recordings.insert(id, userId, sessionId, recording.lineId(), recording.requestId(), recording.attemptNo(),
                        recording.objectKey(), recording.contentType(), recording.byteSize(), recording.durationMs(),
                        recording.transcript(), source, matched, now);
                return new Stored(StoreOutcome.CREATED, view(recordings.row(id)), List.of());
            }
            // 같은 줄의 다시 말하기 — 행은 하나이고 앞 객체는 장부로 지운다.
            recordings.replace(current.id(), recording.requestId(), recording.attemptNo(), recording.objectKey(),
                    recording.contentType(), recording.byteSize(), recording.durationMs(), recording.transcript(), source,
                    matched, now);
            return new Stored(StoreOutcome.REPLACED, view(recordings.row(current.id())),
                    List.of(cleanup.schedule(userId, List.of(current.objectKey()), now)));
        });
    }

    @Override
    public List<UUID> delete(UUID userId, UUID recordingId, Instant now) {
        return transaction.execute(status -> {
            Optional<String> objectKey = recordings.lockObjectKey(recordingId, userId);
            if (objectKey.isEmpty()) {
                return null;
            }
            recordings.delete(recordingId);
            return List.of(cleanup.schedule(userId, List.of(objectKey.get()), now));
        });
    }

    private Stored rejected(StoreOutcome outcome, UUID userId, UUID sessionId, String objectKey, Instant now) {
        return new Stored(outcome, null, unstored(userId, sessionId, objectKey, now));
    }

    /**
     * 올렸지만 반영하지 못한 객체를 장부에 올린다. 객체 키에 요청 id 가 들어 있어({@link RecordingRules#objectKey}) 같은 요청 id 의
     * 올리기가 겹치면 키가 같다. 그러면 뒤의 요청이 재전송·거절로 끝나도 그 키를 먼저 저장된 행이 가리킬 수 있다 — 겹친 사이에
     * 이관으로 주인이 바뀌었거나(404), 줄이 바뀌었거나(422), 보관 동의자가 탈퇴했어도(404) 행은 남는다. 그 행이 가리키는 키는
     * 지우지 않는다. 그런 행은 이 회차에 있거나 탈퇴 보관으로 회차 연결이 비었다.
     */
    private List<UUID> unstored(UUID userId, UUID sessionId, String objectKey, Instant now) {
        boolean stored = !recordings.pointingAt(sessionId, objectKey, Limit.of(1)).isEmpty();
        return stored ? List.of() : List.of(cleanup.schedule(userId, List.of(objectKey), now));
    }

    /** 그 회차의 구간 안 내 대사 줄(내 배역이 든 함께 말하는 줄 포함)의 원문. 상대역 줄·지문·구간 밖·남의 줄이면 {@code null}. */
    private String myDialogueLine(UUID sessionId, UUID lineId) {
        List<String> rows = sessions.myDialogueLine(sessionId, lineId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private static RecordingView view(Optional<ReadingRecordingJpaRepository.Row> found) {
        return found.map(row -> new RecordingView(
                row.getId(),
                row.getLineId(),
                row.getAttemptNo(),
                row.getDurationMs(),
                row.getContentType(),
                row.getByteSize(),
                row.getTranscript(),
                row.getTranscriptSource().dbValue(),
                row.getMatched(),
                row.getObjectKey(),
                null,
                null)).orElse(null);
    }
}
