package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
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
import com.acttub.actingapi.feature.reading.domain.LineResult;
import com.acttub.actingapi.feature.reading.domain.SessionPlan;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.schema.ReadingAdvance;
import com.acttub.actingapi.platform.schema.ReadingMode;
import com.acttub.actingapi.platform.schema.ReadingSessionStatus;
import com.acttub.actingapi.platform.schema.ScriptLineKind;
import com.acttub.actingapi.platform.schema.TranscriptSource;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 회차의 쓰기는 <b>회차 행(시작은 대본 행)을 {@code FOR UPDATE} 로 잡고 주인이 맞는지 다시 본다</b>. 이관은 게스트의
 * {@code users} 행을 잡은 뒤 리딩 행의 주인을 바꾸고 탈퇴·삭제는 행을 지우므로, 잠금을 기다린 뒤 다시 본 행이 없거나
 * 남의 것이면 그대로 404 다 — 옛 계정에 아무것도 남지 않는다(03-reading 「리딩 자료의 이관·삭제·탈퇴」).
 *
 * <p>같은 대본의 시작이 겹치면 대본 행에서 줄을 선다 — 뒤의 것이 앞의 회차를 {@code stopped} 로 닫고 자기 회차를 만들어
 * 열린 회차는 언제나 하나다(부분 유일 인덱스 {@code uq_reading_sessions_open_script} 가 그물이다).
 *
 * <p>회차 번호·구간의 대사 번호·내 대사 수·녹음된 줄 수는 저장하지 않고 조회할 때 센다. 배열 컬럼과 jsonb 는 텍스트로
 * 읽는다 — Hibernate 의 네이티브 결과가 Postgres 배열·jsonb 를 어떻게 돌려주는지에 기대지 않는다.
 */
@Repository
class PostgresSessionRepository implements SessionRepository {
    /** 이름·id 목록을 한 칸에 이어 붙일 때 쓰는 구분자. 이름에 나올 수 없는 제어 문자다. */
    private static final String SEPARATOR = "\u001f";
    private static final TypeReference<List<StoredLineResult>> LINE_RESULTS = new TypeReference<>() { };

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final ReadingRecordingCleanup cleanup;
    private final ObjectMapper json;

    PostgresSessionRepository(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            ReadingRecordingCleanup cleanup,
            ObjectMapper json) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.cleanup = cleanup;
        this.json = json;
    }

    @Override
    public Start start(UUID userId, UUID scriptId, UUID requestId, SessionPlan plan, Instant now) {
        return transaction.execute(status -> {
            // 대본 행을 잡는다 — 같은 대본의 시작이 여기서 줄을 서고, 이관·삭제 뒤에는 남의 것이라 404 다.
            boolean owned = !NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id FROM scripts WHERE id=:scriptId AND user_id=:userId FOR UPDATE
                    """, Tuple.class)
                    .setParameter("scriptId", scriptId)
                    .setParameter("userId", userId)).isEmpty();
            if (!owned) {
                return null;
            }
            List<Tuple> existing = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id,script_id,array_to_string(my_character_ids,:sep) AS my_character_ids,mode,start_line_id,
                           end_line_id,advance,record
                    FROM reading_sessions
                    WHERE user_id=:userId
                      AND request_id=:requestId
                    """, Tuple.class)
                    .setParameter("sep", SEPARATOR)
                    .setParameter("userId", userId)
                    .setParameter("requestId", requestId));
            if (!existing.isEmpty()) {
                Tuple row = existing.getFirst();
                boolean same = scriptId.equals(row.get("script_id", UUID.class))
                        && plan.myCharacterIds().equals(uuids(row.get("my_character_ids", String.class)))
                        && plan.mode().equals(row.get("mode", String.class))
                        && plan.startLineId().equals(row.get("start_line_id", UUID.class))
                        && plan.endLineId().equals(row.get("end_line_id", UUID.class))
                        && plan.advance().equals(row.get("advance", String.class))
                        && plan.record() == Boolean.TRUE.equals(row.get("record", Boolean.class));
                return same
                        ? new Start(row.get("id", UUID.class), StartOutcome.REPLAYED)
                        : new Start(null, StartOutcome.REQUEST_MISMATCH);
            }
            Set<UUID> characters = new HashSet<>(NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT id FROM script_characters WHERE script_id=:scriptId", Tuple.class)
                    .setParameter("scriptId", scriptId)).stream()
                    .map(row -> row.get("id", UUID.class))
                    .toList());
            if (plan.myCharacterIds().isEmpty()
                    || new HashSet<>(plan.myCharacterIds()).size() != plan.myCharacterIds().size()
                    || !characters.containsAll(plan.myCharacterIds())) {
                return new Start(null, StartOutcome.INVALID_CHARACTERS);
            }
            Map<UUID, Tuple> lines = new LinkedHashMap<>();
            for (Tuple line : NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id,ordinal,kind,character_id FROM script_lines WHERE script_id=:scriptId ORDER BY ordinal
                    """, Tuple.class)
                    .setParameter("scriptId", scriptId))) {
                lines.put(line.get("id", UUID.class), line);
            }
            Tuple start = lines.get(plan.startLineId());
            Tuple end = lines.get(plan.endLineId());
            if (start == null || end == null || !dialogue(start) || !dialogue(end)) {
                return new Start(null, StartOutcome.INVALID_LINE);
            }
            int from = start.get("ordinal", Integer.class);
            int to = end.get("ordinal", Integer.class);
            boolean mine = from <= to && lines.values().stream().anyMatch(line -> {
                int ordinal = line.get("ordinal", Integer.class);
                return ordinal >= from && ordinal <= to && dialogue(line)
                        && plan.myCharacterIds().contains(line.get("character_id", UUID.class));
            });
            if (!mine) {
                return new Start(null, StartOutcome.EMPTY_RANGE);
            }
            // "새로운 연습" — 열린 회차를 닫고 새 회차를 만든다. 한 트랜잭션이다.
            entityManager.createNativeQuery("""
                    UPDATE reading_sessions
                    SET status='stopped',updated_at=:now
                    WHERE script_id=:scriptId
                      AND status='in_progress'
                    """)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("scriptId", scriptId)
                    .executeUpdate();
            UUID sessionId = UUID.randomUUID();
            entityManager.createNativeQuery("""
                    INSERT INTO reading_sessions(id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,
                                                 advance,record,status,current_line_id,elapsed_seconds,progress_seq,line_results,
                                                 started_at,updated_at)
                    VALUES (:id,:scriptId,:userId,:requestId,CAST(:characters AS uuid[]),:mode,:startLineId,:endLineId,
                            :advance,:record,'in_progress',:startLineId,0,0,CAST('[]' AS jsonb),:now,:now)
                    """)
                    .setParameter("id", sessionId)
                    .setParameter("scriptId", scriptId)
                    .setParameter("userId", userId)
                    .setParameter("requestId", requestId)
                    .setParameter("characters", uuidArray(plan.myCharacterIds()))
                    .setParameter("mode", ReadingMode.valueOf(plan.mode().toUpperCase(Locale.ROOT)).dbValue())
                    .setParameter("startLineId", plan.startLineId())
                    .setParameter("endLineId", plan.endLineId())
                    .setParameter("advance", ReadingAdvance.valueOf(plan.advance().toUpperCase(Locale.ROOT)).dbValue())
                    .setParameter("record", plan.record())
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .executeUpdate();
            return new Start(sessionId, StartOutcome.CREATED);
        });
    }

    @Override
    public SessionDetailView find(UUID userId, UUID sessionId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                CARD_SELECT + """
                       ,rs.script_id,rs.mode,rs.advance,rs.record,rs.start_line_id,rs.end_line_id,rs.current_line_id,
                       rs.progress_seq,CAST(rs.line_results AS text) AS line_results
                """ + CARD_FROM + """
                WHERE rs.id=:sessionId
                  AND rs.user_id=:userId
                """, Tuple.class)
                .setParameter("sep", SEPARATOR)
                .setParameter("sessionId", sessionId)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        return new SessionDetailView(
                card(row),
                row.get("script_id", UUID.class),
                ReadingMode.valueOf(row.get("mode", String.class).toUpperCase(Locale.ROOT)).dbValue(),
                ReadingAdvance.valueOf(row.get("advance", String.class).toUpperCase(Locale.ROOT)).dbValue(),
                Boolean.TRUE.equals(row.get("record", Boolean.class)),
                row.get("start_line_id", UUID.class),
                row.get("end_line_id", UUID.class),
                row.get("current_line_id", UUID.class),
                row.get("progress_seq", Number.class).longValue(),
                lineResults(row.get("line_results", String.class)),
                recordings(sessionId));
    }

    @Override
    public List<SessionCardView> list(UUID userId, UUID scriptId) {
        boolean owned = !NativeTuples.list(entityManager.createNativeQuery(
                "SELECT id FROM scripts WHERE id=:scriptId AND user_id=:userId", Tuple.class)
                .setParameter("scriptId", scriptId)
                .setParameter("userId", userId)).isEmpty();
        if (!owned) {
            return null;
        }
        return NativeTuples.list(entityManager.createNativeQuery(
                CARD_SELECT + CARD_FROM + """
                WHERE rs.script_id=:scriptId
                  AND rs.user_id=:userId
                ORDER BY rs.started_at DESC,rs.id DESC
                """, Tuple.class)
                .setParameter("sep", SEPARATOR)
                .setParameter("scriptId", scriptId)
                .setParameter("userId", userId)).stream()
                .map(PostgresSessionRepository::card)
                .toList();
    }

    @Override
    public Progress saveProgress(UUID userId, UUID sessionId, ProgressChange change, Instant now) {
        return transaction.execute(status -> {
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT rs.id,rs.script_id,rs.status,rs.start_line_id,rs.end_line_id,rs.current_line_id,rs.elapsed_seconds,
                           rs.progress_seq,CAST(rs.line_results AS text) AS line_results
                    FROM reading_sessions rs
                    WHERE rs.id=:sessionId
                      AND rs.user_id=:userId
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("sessionId", sessionId)
                    .setParameter("userId", userId));
            if (rows.isEmpty()) {
                return null;
            }
            Tuple row = rows.getFirst();
            ProgressView current = new ProgressView(
                    row.get("current_line_id", UUID.class),
                    row.get("elapsed_seconds", Integer.class),
                    row.get("progress_seq", Number.class).longValue(),
                    ReadingSessionStatus.valueOf(row.get("status", String.class).toUpperCase(Locale.ROOT)).dbValue());
            if (!ReadingSessionStatus.IN_PROGRESS.dbValue().equals(current.status())) {
                return new Progress(current, ProgressOutcome.CLOSED);
            }
            if (change.progressSeq() <= current.progressSeq()) {
                return new Progress(current, ProgressOutcome.IGNORED);
            }
            // 위치와 줄 결과는 구간 안 대사 줄만 받는다.
            Set<UUID> inRange = new HashSet<>(NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT l.id
                    FROM script_lines l
                    JOIN script_lines s ON s.id=:startLineId
                    JOIN script_lines e ON e.id=:endLineId
                    WHERE l.script_id=:scriptId
                      AND l.kind='dialogue'
                      AND l.ordinal BETWEEN s.ordinal AND e.ordinal
                    """, Tuple.class)
                    .setParameter("startLineId", row.get("start_line_id", UUID.class))
                    .setParameter("endLineId", row.get("end_line_id", UUID.class))
                    .setParameter("scriptId", row.get("script_id", UUID.class))).stream()
                    .map(line -> line.get("id", UUID.class))
                    .toList());
            if (change.currentLineId() != null && !inRange.contains(change.currentLineId())) {
                return new Progress(null, ProgressOutcome.INVALID_LINE);
            }
            if (change.lineResults().stream().anyMatch(result -> !inRange.contains(result.lineId()))) {
                return new Progress(null, ProgressOutcome.INVALID_LINE);
            }
            List<LineResult> merged = LineResult.merge(lineResults(row.get("line_results", String.class)), change.lineResults());
            UUID position = change.complete()
                    ? null
                    : change.currentLineId() == null ? current.currentLineId() : change.currentLineId();
            int elapsed = change.elapsedSeconds() == null
                    ? current.elapsedSeconds()
                    : Math.max(current.elapsedSeconds(), change.elapsedSeconds());
            String state = change.complete()
                    ? ReadingSessionStatus.COMPLETED.dbValue()
                    : ReadingSessionStatus.IN_PROGRESS.dbValue();
            entityManager.createNativeQuery("""
                    UPDATE reading_sessions
                    SET current_line_id=CAST(:position AS uuid),
                        elapsed_seconds=:elapsed,
                        progress_seq=:seq,
                        line_results=CAST(:lineResults AS jsonb),
                        status=:status,
                        ended_at=CASE WHEN :complete THEN CAST(:now AS timestamptz) ELSE ended_at END,
                        updated_at=:now
                    WHERE id=:sessionId
                    """)
                    .setParameter("position", position)
                    .setParameter("elapsed", elapsed)
                    .setParameter("seq", change.progressSeq())
                    .setParameter("lineResults", lineResultsJson(merged))
                    .setParameter("status", state)
                    .setParameter("complete", change.complete())
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("sessionId", sessionId)
                    .executeUpdate();
            return new Progress(new ProgressView(position, elapsed, change.progressSeq(), state), ProgressOutcome.APPLIED);
        });
    }

    @Override
    public List<UUID> delete(UUID userId, UUID sessionId, Instant now) {
        return transaction.execute(status -> {
            boolean owned = !NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id FROM reading_sessions WHERE id=:sessionId AND user_id=:userId FOR UPDATE
                    """, Tuple.class)
                    .setParameter("sessionId", sessionId)
                    .setParameter("userId", userId)).isEmpty();
            if (!owned) {
                return null;
            }
            // 녹음 행을 지우면서 객체 키를 같은 트랜잭션에서 장부에 남긴다. 암기 상태는 줄에 매달려 있어 그대로다.
            List<String> objectKeys = NativeTuples.list(entityManager.createNativeQuery("""
                    WITH removed AS (
                        DELETE FROM reading_recordings
                        WHERE reading_session_id=:sessionId
                        RETURNING object_key
                    )
                    SELECT object_key FROM removed
                    """, Tuple.class)
                    .setParameter("sessionId", sessionId)).stream()
                    .map(row -> row.get("object_key", String.class))
                    .toList();
            entityManager.createNativeQuery("DELETE FROM reading_sessions WHERE id=:sessionId")
                    .setParameter("sessionId", sessionId)
                    .executeUpdate();
            return objectKeys.isEmpty()
                    ? List.of()
                    : List.of(cleanup.schedule(userId, objectKeys, now));
        });
    }

    /** 카드의 집계 — 회차 번호, 내 배역, 구간의 대사 번호, 내 대사 수, 녹음된 줄 수. */
    private static final String CARD_SELECT = """
            SELECT rs.id,rs.status,rs.elapsed_seconds,rs.started_at,rs.ended_at,
                   (SELECT count(*) FROM reading_sessions o
                    WHERE o.script_id=rs.script_id AND (o.started_at,o.id) <= (rs.started_at,rs.id)) AS ordinal,
                   array_to_string(rs.my_character_ids,:sep) AS my_character_ids,
                   (SELECT string_agg(c.name,:sep ORDER BY c.sort_order) FROM script_characters c
                    WHERE c.id=ANY(rs.my_character_ids)) AS my_character_names,
                   (SELECT count(*) FROM script_lines l
                    WHERE l.script_id=rs.script_id AND l.kind='dialogue' AND l.ordinal<=sl.ordinal) AS start_dialogue_no,
                   (SELECT count(*) FROM script_lines l
                    WHERE l.script_id=rs.script_id AND l.kind='dialogue' AND l.ordinal<=el.ordinal) AS end_dialogue_no,
                   (SELECT count(*) FROM script_lines l
                    WHERE l.script_id=rs.script_id AND l.kind='dialogue' AND l.ordinal BETWEEN sl.ordinal AND el.ordinal
                      AND l.character_id=ANY(rs.my_character_ids)) AS my_dialogue_count,
                   (SELECT count(DISTINCT r.line_id) FROM reading_recordings r
                    WHERE r.reading_session_id=rs.id) AS recorded_line_count
            """;

    private static final String CARD_FROM = """
            FROM reading_sessions rs
            JOIN script_lines sl ON sl.id=rs.start_line_id
            JOIN script_lines el ON el.id=rs.end_line_id
            """;

    private static SessionCardView card(Tuple row) {
        return new SessionCardView(
                row.get("id", UUID.class),
                row.get("ordinal", Number.class).intValue(),
                ReadingSessionStatus.valueOf(row.get("status", String.class).toUpperCase(Locale.ROOT)).dbValue(),
                uuids(row.get("my_character_ids", String.class)),
                split(row.get("my_character_names", String.class)),
                row.get("start_dialogue_no", Number.class).intValue(),
                row.get("end_dialogue_no", Number.class).intValue(),
                row.get("my_dialogue_count", Number.class).intValue(),
                row.get("recorded_line_count", Number.class).intValue(),
                row.get("elapsed_seconds", Integer.class),
                row.get("started_at", Instant.class),
                row.get("ended_at", Instant.class));
    }

    /** 줄 순서의 녹음. 재생 주소는 서비스가 조회할 때마다 붙인다 — 여기서는 비어 있다. */
    private List<RecordingView> recordings(UUID sessionId) {
        List<RecordingView> recordings = new ArrayList<>();
        for (Tuple row : NativeTuples.list(entityManager.createNativeQuery("""
                SELECT r.id,r.line_id,r.attempt_no,r.duration_ms,r.content_type,r.byte_size,r.transcript,r.transcript_source,
                       r.matched,r.object_key
                FROM reading_recordings r
                JOIN script_lines l ON l.id=r.line_id
                WHERE r.reading_session_id=:sessionId
                ORDER BY l.ordinal
                """, Tuple.class)
                .setParameter("sessionId", sessionId))) {
            recordings.add(new RecordingView(
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
                    null));
        }
        return recordings;
    }

    private static boolean dialogue(Tuple line) {
        return ScriptLineKind.DIALOGUE.dbValue().equals(line.get("kind", String.class));
    }

    private List<LineResult> lineResults(String stored) {
        try {
            List<LineResult> results = new ArrayList<>();
            for (StoredLineResult result : json.readValue(stored, LINE_RESULTS)) {
                results.add(new LineResult(result.line_id(), result.outcome(), result.misses()));
            }
            return results;
        } catch (Exception unreadable) {
            throw new IllegalStateException("reading_sessions.line_results is not a result list", unreadable);
        }
    }

    private String lineResultsJson(List<LineResult> results) {
        try {
            return json.writeValueAsString(results.stream()
                    .map(result -> new StoredLineResult(result.lineId(), result.outcome(), result.misses()))
                    .toList());
        } catch (Exception failure) {
            throw new IllegalStateException("failed to write line results", failure);
        }
    }

    /** jsonb 에 저장하는 모양 — 키 이름이 API 값과 같다({@code line_id}·{@code outcome}·{@code misses}). */
    private record StoredLineResult(UUID line_id, String outcome, int misses) {
    }

    private static List<UUID> uuids(String joined) {
        return split(joined).stream().map(UUID::fromString).toList();
    }

    private static List<String> split(String joined) {
        return joined == null || joined.isEmpty() ? List.of() : Arrays.asList(joined.split(SEPARATOR, -1));
    }

    private static String uuidArray(List<UUID> ids) {
        return "{" + String.join(",", ids.stream().map(UUID::toString).toList()) + "}";
    }
}
