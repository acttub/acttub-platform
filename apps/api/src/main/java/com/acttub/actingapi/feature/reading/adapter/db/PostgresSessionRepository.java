package com.acttub.actingapi.feature.reading.adapter.db;

import static com.acttub.actingapi.feature.reading.adapter.db.JoinedColumn.SEPARATOR;
import static com.acttub.actingapi.feature.reading.adapter.db.JoinedColumn.split;

import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ReadingRecordingCleanup;
import com.acttub.actingapi.feature.reading.app.SessionRepository;
import com.acttub.actingapi.feature.reading.app.SessionViews.ProgressView;
import com.acttub.actingapi.feature.reading.app.SessionViews.RecordingView;
import com.acttub.actingapi.feature.reading.app.SessionViews.SessionCardView;
import com.acttub.actingapi.feature.reading.app.SessionViews.SessionDetailView;
import com.acttub.actingapi.feature.reading.domain.DifferentLine;
import com.acttub.actingapi.feature.reading.domain.LineResult;
import com.acttub.actingapi.feature.reading.domain.ReadingLayout;
import com.acttub.actingapi.feature.reading.domain.SessionPlan;
import com.acttub.actingapi.platform.schema.ReadingAdvance;
import com.acttub.actingapi.platform.schema.ReadingMode;
import com.acttub.actingapi.platform.schema.ReadingSessionStatus;
import com.acttub.actingapi.platform.schema.ScriptLineKind;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 회차의 쓰기는 <b>회차 행(시작은 대본 행)을 {@code FOR UPDATE} 로 잡고 주인이 맞는지 다시 본다</b>. 이관은 게스트의
 * {@code users} 행을 잡은 뒤 리딩 행의 주인을 바꾸고 탈퇴·삭제는 행을 지우므로, 잠금을 기다린 뒤 다시 본 행이 없거나
 * 남의 것이면 그대로 404 다 — 옛 계정에 아무것도 남지 않는다(specs/reading 「리딩 자료의 이관·삭제·탈퇴」).
 *
 * <p>새 회차는 같은 대본의 진행 중 회차를 건드리지 않는다 — 한 대본에 진행 중 회차가 여럿일 수 있다.
 *
 * <p>회차 번호·구간의 대사 번호·내 대사 수·녹음된 줄 수는 저장하지 않고 조회할 때 센다. 문장은 Spring Data 저장소에 있다.
 * 회차 시작과 진행 저장은 요청이 많은 경로라 요청 하나가 보내는 문장의 수를 {@code SessionRepositoryIT} 가 지킨다
 * (apps/api/CONTRACT.md §5-9).
 */
@Repository
class PostgresSessionRepository implements SessionRepository {
    private static final TypeReference<List<StoredLineResult>> LINE_RESULTS = new TypeReference<>() { };
    private static final TypeReference<Map<UUID, String>> LINE_SAID = new TypeReference<>() { };

    private final EntityManager entityManager;
    private final ReadingSessionJpaRepository sessions;
    private final ScriptJpaRepository scripts;
    private final ScriptCharacterJpaRepository characters;
    private final ScriptLineJpaRepository scriptLines;
    private final ReadingRecordingJpaRepository recordings;
    private final ReadingSessionRatingJpaRepository ratings;
    private final TransactionTemplate transaction;
    private final ReadingRecordingCleanup cleanup;
    private final ObjectMapper json;

    PostgresSessionRepository(
            EntityManager entityManager,
            ReadingSessionJpaRepository sessions,
            ScriptJpaRepository scripts,
            ScriptCharacterJpaRepository characters,
            ScriptLineJpaRepository scriptLines,
            ReadingRecordingJpaRepository recordings,
            ReadingSessionRatingJpaRepository ratings,
            PlatformTransactionManager transactionManager,
            ReadingRecordingCleanup cleanup,
            ObjectMapper json) {
        this.entityManager = entityManager;
        this.sessions = sessions;
        this.scripts = scripts;
        this.characters = characters;
        this.scriptLines = scriptLines;
        this.recordings = recordings;
        this.ratings = ratings;
        this.transaction = new TransactionTemplate(transactionManager);
        this.cleanup = cleanup;
        this.json = json;
    }

    @Override
    public Start start(UUID userId, UUID scriptId, UUID requestId, SessionPlan plan, Instant now) {
        return transaction.execute(status -> {
            // 대본 행을 잡는다 — 같은 대본의 시작이 여기서 줄을 서고, 이관·삭제 뒤에는 남의 것이라 404 다.
            if (scripts.lockOwned(scriptId, userId).isEmpty()) {
                return null;
            }
            ReadingSessionJpaRepository.Planned existing = sessions.byRequest(userId, requestId).orElse(null);
            if (existing != null) {
                boolean same = scriptId.equals(existing.getScriptId())
                        && plan.myCharacterIds().equals(List.of(existing.getMyCharacterIds()))
                        && plan.mode().equals(existing.getMode().dbValue())
                        && plan.startLineId().equals(existing.getStartLineId())
                        && plan.endLineId().equals(existing.getEndLineId())
                        && plan.advance().equals(existing.getAdvance().dbValue())
                        && plan.record() == Boolean.TRUE.equals(existing.getRecord());
                return same
                        ? new Start(existing.getId(), StartOutcome.REPLAYED)
                        : new Start(null, StartOutcome.REQUEST_MISMATCH);
            }
            List<ScriptCharacterJpaRepository.Members> cast = characters.members(scriptId);
            Set<UUID> castIds = new HashSet<>(cast.stream().map(ScriptCharacterJpaRepository.Members::getId).toList());
            // 내 배역이 비어 있으면 「전체 듣기」 회차다 — 모든 대사를 앱이 읽으므로 구간에 내 대사가 없어도 된다(앱 1.1.1).
            boolean listenAll = plan.myCharacterIds().isEmpty();
            if (new HashSet<>(plan.myCharacterIds()).size() != plan.myCharacterIds().size()
                    || !castIds.containsAll(plan.myCharacterIds())) {
                return new Start(null, StartOutcome.INVALID_CHARACTERS);
            }
            // 내 차례인 배역 — 고른 배역과, 고른 배역이 멤버로 든 함께 말하는 줄의 묶음 배역(SOMA-709·785).
            Set<UUID> turns = new HashSet<>(plan.myCharacterIds());
            for (ScriptCharacterJpaRepository.Members row : cast) {
                if (row.getMemberIds() != null && List.of(row.getMemberIds()).stream().anyMatch(plan.myCharacterIds()::contains)) {
                    turns.add(row.getId());
                }
            }
            Map<UUID, ScriptLineJpaRepository.Outline> lines = new LinkedHashMap<>();
            for (ScriptLineJpaRepository.Outline line : scriptLines.outline(scriptId)) {
                lines.put(line.getId(), line);
            }
            ScriptLineJpaRepository.Outline start = lines.get(plan.startLineId());
            ScriptLineJpaRepository.Outline end = lines.get(plan.endLineId());
            if (start == null || end == null || !dialogue(start) || !dialogue(end)) {
                return new Start(null, StartOutcome.INVALID_LINE);
            }
            int from = start.getOrdinal();
            int to = end.getOrdinal();
            boolean mine = from <= to && (listenAll || lines.values().stream().anyMatch(line ->
                    line.getOrdinal() >= from && line.getOrdinal() <= to && dialogue(line)
                            && turns.contains(line.getCharacterId())));
            if (!mine) {
                return new Start(null, StartOutcome.EMPTY_RANGE);
            }
            UUID sessionId = UUID.randomUUID();
            sessions.insert(sessionId, scriptId, userId, requestId, plan.myCharacterIds().toArray(UUID[]::new),
                    ReadingMode.valueOf(plan.mode().toUpperCase(Locale.ROOT)), plan.startLineId(), plan.endLineId(),
                    ReadingAdvance.valueOf(plan.advance().toUpperCase(Locale.ROOT)), plan.record(), json.createArrayNode(), now);
            return new Start(sessionId, StartOutcome.CREATED);
        });
    }

    @Override
    public SessionDetailView find(UUID userId, UUID sessionId) {
        ReadingSessionJpaRepository.Detail row = sessions.detail(sessionId, userId, SEPARATOR).orElse(null);
        if (row == null) {
            return null;
        }
        List<LineResult> results = lineResults(row.getLineResults(), row.getLineSaid());
        Range range = lines(row.getScriptId(), row.getStartLineId(), row.getEndLineId());
        return new SessionDetailView(
                card(row, range.layout()),
                row.getScriptId(),
                row.getMode().dbValue(),
                row.getAdvance().dbValue(),
                Boolean.TRUE.equals(row.getRecord()),
                row.getStartLineId(),
                row.getEndLineId(),
                row.getCurrentLineId(),
                row.getProgressSeq(),
                results,
                recordings(sessionId),
                DifferentLine.of(range.dialogues(), results));
    }

    @Override
    public List<SessionCardView> list(UUID userId, UUID scriptId) {
        if (scripts.owned(scriptId, userId).isEmpty()) {
            return null;
        }
        ReadingLayout layout = lines(scriptId, null, null).layout();
        return sessions.cards(scriptId, userId, SEPARATOR).stream().map(row -> card(row, layout)).toList();
    }

    @Override
    public Progress saveProgress(UUID userId, UUID sessionId, ProgressChange change, Instant now) {
        return transaction.execute(status -> {
            ReadingSessionJpaRepository.ProgressState row = sessions.lockProgress(sessionId, userId).orElse(null);
            if (row == null) {
                return null;
            }
            UUID currentLine = row.getCurrentLineId();
            int currentElapsed = row.getElapsedSeconds();
            long currentSeq = row.getProgressSeq();
            String currentStatus = row.getStatus().dbValue();
            if (row.getStatus() != ReadingSessionStatus.IN_PROGRESS) {
                return new Progress(
                        new ProgressView(currentLine, currentElapsed, currentSeq, currentStatus, List.of()),
                        ProgressOutcome.CLOSED);
            }
            List<LineResult> stored = lineResults(row.getLineResults(), row.getLineSaid());
            List<DifferentLine.Dialogue> range = lines(row.getScriptId(), row.getStartLineId(), row.getEndLineId()).dialogues();
            if (change.progressSeq() <= currentSeq) {
                return new Progress(
                        new ProgressView(currentLine, currentElapsed, currentSeq, currentStatus, DifferentLine.of(range, stored)),
                        ProgressOutcome.IGNORED);
            }
            // 위치와 줄 결과는 구간 안 대사 줄만 받는다.
            Map<UUID, String> texts = new HashMap<>();
            range.forEach(line -> texts.put(line.lineId(), line.text()));
            if (change.currentLineId() != null && !texts.containsKey(change.currentLineId())) {
                return new Progress(null, ProgressOutcome.INVALID_LINE);
            }
            if (change.lineResults().stream().anyMatch(result -> !texts.containsKey(result.lineId()))) {
                return new Progress(null, ProgressOutcome.INVALID_LINE);
            }
            List<LineResult> merged = LineResult.merge(stored, change.lineResults(), texts);
            UUID position = change.complete()
                    ? null
                    : change.currentLineId() == null ? currentLine : change.currentLineId();
            int elapsed = change.elapsedSeconds() == null
                    ? currentElapsed
                    : Math.max(currentElapsed, change.elapsedSeconds());
            ReadingSessionStatus state = change.complete() ? ReadingSessionStatus.COMPLETED : ReadingSessionStatus.IN_PROGRESS;
            if (!change.complete()) {
                // 진행 저장은 가장 잦은 쓰기라 디스크 확정이 느려지는 순간 DB 연결 전체가 COMMIT 에 묶였다(SOMA-701).
                // 서버가 갑자기 꺼지면 마지막 약 0.6초의 위치 저장만 잃고(데이터는 깨지지 않는다) 다음 저장이 덮는다.
                // SET LOCAL 이라 이 트랜잭션에만 걸린다. 완료 저장은 지금처럼 확정을 기다린다. HQL 에 없는 문장이라 native SQL 이다.
                entityManager.createNativeQuery("SET LOCAL synchronous_commit = off").executeUpdate();
            }
            sessions.saveProgress(sessionId, position, elapsed, change.progressSeq(), lineResultsJson(merged), lineSaidJson(merged),
                    state, change.complete(), now);
            return new Progress(
                    new ProgressView(position, elapsed, change.progressSeq(), state.dbValue(), DifferentLine.of(range, merged)),
                    ProgressOutcome.APPLIED);
        });
    }

    @Override
    public List<UUID> delete(UUID userId, UUID sessionId, Instant now) {
        return transaction.execute(status -> {
            if (sessions.lockOwned(sessionId, userId).isEmpty()) {
                return null;
            }
            // 녹음 행을 지우면서 객체 키를 같은 트랜잭션에서 장부에 남긴다. 암기 상태는 줄에 매달려 있어 그대로다.
            // 회차 행을 잡고 있어 새 녹음이 들어오지 못하므로, 잠가 읽은 행이 지울 행의 전부다(§5-9).
            List<ReadingRecordingJpaRepository.Stored> stored = recordings.lockOfSession(sessionId);
            List<String> objectKeys = stored.stream().map(ReadingRecordingJpaRepository.Stored::getObjectKey).toList();
            if (!stored.isEmpty()) {
                recordings.deleteAll(stored.stream().map(ReadingRecordingJpaRepository.Stored::getId).toList());
            }
            // 회차 평가(V40)는 회차에 매달려 함께 지운다. 평가의 쓰기도 이 회차 행을 잡으므로 겹쳐도 남지 않는다.
            ratings.deleteOfSession(sessionId);
            sessions.delete(sessionId);
            return objectKeys.isEmpty()
                    ? List.of()
                    : List.of(cleanup.schedule(userId, objectKeys, now));
        });
    }

    private static SessionCardView card(ReadingSessionJpaRepository.Card row, ReadingLayout layout) {
        int startNo = (int) row.getStartDialogueNo();
        int endNo = (int) row.getEndDialogueNo();
        return new SessionCardView(
                row.getId(),
                (int) row.getOrdinal(),
                row.getStatus().dbValue(),
                List.of(row.getMyCharacterIds()),
                split(row.getMyCharacterNames()),
                startNo,
                endNo,
                layout.rangeName(startNo, endNo),
                row.getStatus() == ReadingSessionStatus.IN_PROGRESS
                        ? layout.progress(startNo, endNo, row.getCurrentLineId())
                        : null,
                (int) row.getMyDialogueCount(),
                (int) row.getRecordedLineCount(),
                row.getElapsedSeconds(),
                row.getStartedAt(),
                row.getEndedAt());
    }

    /** 줄 순서의 녹음. 재생 주소는 서비스가 조회할 때마다 붙인다 — 여기서는 비어 있다. */
    private List<RecordingView> recordings(UUID sessionId) {
        return recordings.ofSession(sessionId).stream().map(row -> new RecordingView(
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
                null)).toList();
    }

    private static boolean dialogue(ScriptLineJpaRepository.Outline line) {
        return line.getKind() == ScriptLineKind.DIALOGUE;
    }

    /** 대본의 표시값(대사 번호·장면)과 회차 구간 안 대사 줄의 원문, 줄 순서. */
    private record Range(ReadingLayout layout, List<DifferentLine.Dialogue> dialogues) {
    }

    /**
     * 대본 줄을 한 번 읽어 표시값과 구간 대사를 함께 만든다. 글은 장면 머리(장면 이름)와 구간 안 대사(비교)만 읽고, 구간이
     * 없으면({@code null}) 구간 대사도 없다. 대사 번호는 {@link ReadingLayout} 이 센다 — 대본·회차 응답과 같은 번호다.
     */
    private Range lines(UUID scriptId, UUID startLineId, UUID endLineId) {
        List<ScriptLineJpaRepository.Reading> lines = scriptLines.reading(scriptId, startLineId, endLineId);
        ReadingLayout layout = ReadingLayout.of(lines.stream()
                .map(line -> new ReadingLayout.Line(line.getId(), line.getKind().dbValue(), line.getHeading()))
                .toList());
        List<DifferentLine.Dialogue> dialogues = lines.stream()
                .filter(line -> line.getSpoken() != null)
                .map(line -> new DifferentLine.Dialogue(line.getId(), layout.dialogueNo(line.getId()), line.getSpoken()))
                .toList();
        return new Range(layout, dialogues);
    }

    /** {@code line_results} 에 {@code line_said} 의 말한 것을 붙인다. */
    private List<LineResult> lineResults(JsonNode lineResults, JsonNode lineSaid) {
        try {
            Map<UUID, String> said = json.readerFor(LINE_SAID).readValue(lineSaid);
            List<StoredLineResult> stored = json.readerFor(LINE_RESULTS).readValue(lineResults);
            return stored.stream()
                    .map(result -> new LineResult(result.line_id(), result.outcome(), result.misses(), said.get(result.line_id())))
                    .toList();
        } catch (Exception unreadable) {
            throw new IllegalStateException("reading_sessions.line_results is not a result list", unreadable);
        }
    }

    private JsonNode lineResultsJson(List<LineResult> results) {
        return json.valueToTree(results.stream()
                .map(result -> new StoredLineResult(result.lineId(), result.outcome(), result.misses()))
                .toList());
    }

    private JsonNode lineSaidJson(List<LineResult> results) {
        Map<UUID, String> said = new LinkedHashMap<>();
        results.stream().filter(result -> result.said() != null).forEach(result -> said.put(result.lineId(), result.said()));
        return json.valueToTree(said);
    }

    /** jsonb 에 저장하는 모양 — 키 이름이 API 값과 같다({@code line_id}·{@code outcome}·{@code misses}). */
    private record StoredLineResult(UUID line_id, String outcome, int misses) {
    }
}
