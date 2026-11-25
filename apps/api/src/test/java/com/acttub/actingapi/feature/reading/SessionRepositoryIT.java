package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.SessionRepository;
import com.acttub.actingapi.feature.reading.app.SessionRepository.Progress;
import com.acttub.actingapi.feature.reading.app.SessionRepository.ProgressChange;
import com.acttub.actingapi.feature.reading.app.SessionRepository.ProgressOutcome;
import com.acttub.actingapi.feature.reading.app.SessionRepository.Start;
import com.acttub.actingapi.feature.reading.app.SessionRepository.StartOutcome;
import com.acttub.actingapi.feature.reading.app.SessionViews.ProgressView;
import com.acttub.actingapi.feature.reading.app.SessionViews.SessionCardView;
import com.acttub.actingapi.feature.reading.app.SessionViews.SessionDetailView;
import com.acttub.actingapi.feature.reading.domain.LineReport;
import com.acttub.actingapi.feature.reading.domain.LineResult;
import com.acttub.actingapi.feature.reading.domain.SessionPlan;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 리딩 회차 저장소가 내는 결과·잠금·경합·문장을 고정한다. 시작·진행·완료·조회·삭제의 HTTP 흐름과 화면에 보이는 값은
 * {@link ReadingSessionIT} 가 본다. 여기서는 저장소 한 번의 부름이 적는 칸 전체(배열·jsonb 포함), 회차 번호와 집계의 세는 법,
 * 대본 행과 회차 행의 잠금, 잠금을 기다린 뒤 다시 보는 것(같은 요청 id·앞선 순번·지워진 회차), 요청 하나가 보내는 문장을 본다 —
 * 회차 시작과 진행 저장은 요청이 많은 경로라 문장 수가 늘면 안 되고, 진행 저장은 디스크 확정을 기다리지 않는 설정을 그 트랜잭션에만 건다. *
 * <p>저장소를 네이티브 SQL 에서 JPA 로 옮길 때 문장 테스트 한 곳만 달라졌다 — 회차를 지울 때 녹음의
 * {@code DELETE … RETURNING} 을 잠가 읽기와 id 로 지우기로 나눠, 녹음이 있는 회차를 지울 때 문장이 하나 늘었다. 시작·진행 저장·
 * 상세·목록의 문장 수는 그대로이고 결과·잠금·경합 테스트는 고치지 않았다.
 */
class SessionRepositoryIT extends ReadingRepositoryFixture {

    @Autowired
    SessionRepository sessions;

    private UUID owner;
    private UUID script;
    private UUID nina;
    private UUID kostya;
    private UUID chorus;
    private UUID scene;
    private UUID first;
    private UUID second;
    private UUID together;
    private UUID last;

    @BeforeEach
    void setUp() {
        owner = member();
        script = script(owner);
        nina = character(script, "니나", 0);
        kostya = character(script, "코스챠", 1);
        chorus = character(script, "니나·코스챠", 2);
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("UPDATE script_characters SET member_ids=? WHERE id=?");
            statement.setArray(1, connection.createArrayOf("uuid", new UUID[] {nina, kostya}));
            statement.setObject(2, chorus);
            return statement;
        });
        scene = line(script, 1, "scene", null, "호숫가");
        first = line(script, 2, "dialogue", nina, "안녕하세요");
        second = line(script, 3, "dialogue", kostya, "왔구나");
        together = line(script, 4, "dialogue", chorus, "함께 말해요");
        last = line(script, 5, "dialogue", nina, "잘 가요");
    }

    @Test
    @DisplayName("start: 회차를 만든다 — 내 배역 배열·방식·구간·넘김·녹음을 적고, 진행 중·첫 줄·0초·순번 0·빈 결과로 시작하며 시각을 마이크로초로 반올림한다")
    void startCreatesTheSession() {
        UUID request = UUID.randomUUID();

        Start started = sessions.start(owner, script, request, plan(List.of(nina, kostya), first, last), now.plusNanos(123_456_789));

        assertThat(started.outcome()).isEqualTo(StartOutcome.CREATED);
        assertThat(jdbc.queryForMap("""
                SELECT script_id,user_id,request_id,array_to_string(my_character_ids,',') AS mine,mode,start_line_id,end_line_id,
                       advance,record,status,current_line_id,elapsed_seconds,progress_seq,CAST(line_results AS text) AS results,
                       CAST(line_said AS text) AS said,ended_at
                FROM reading_sessions WHERE id=?
                """, started.sessionId()))
                .containsEntry("script_id", script).containsEntry("user_id", owner).containsEntry("request_id", request)
                .containsEntry("mine", nina + "," + kostya).containsEntry("mode", "read").containsEntry("start_line_id", first)
                .containsEntry("end_line_id", last).containsEntry("advance", "manual").containsEntry("record", true)
                .containsEntry("status", "in_progress").containsEntry("current_line_id", first)
                .containsEntry("elapsed_seconds", 0).containsEntry("progress_seq", 0L).containsEntry("results", "[]")
                .containsEntry("said", "{}").containsEntry("ended_at", null);
        assertThat(instant("SELECT started_at FROM reading_sessions")).isEqualTo(now.plus(123_457, ChronoUnit.MICROS));
        assertThat(instant("SELECT updated_at FROM reading_sessions")).isEqualTo(now.plus(123_457, ChronoUnit.MICROS));
    }

    @Test
    @DisplayName("start: 같은 요청 id 에 같은 계획이면 REPLAYED 로 그 회차를, 다른 계획이면 REQUEST_MISMATCH 를 낸다. 남의 대본·없는 대본은 null 이다")
    void startReplaysTheSameRequest() {
        UUID request = UUID.randomUUID();
        Start created = sessions.start(owner, script, request, plan(List.of(nina), first, last), now);

        assertThat(sessions.start(owner, script, request, plan(List.of(nina), first, last), now.plusSeconds(5)))
                .isEqualTo(new Start(created.sessionId(), StartOutcome.REPLAYED));
        assertThat(sessions.start(owner, script, request, plan(List.of(kostya), first, last), now))
                .isEqualTo(new Start(null, StartOutcome.REQUEST_MISMATCH));
        assertThat(sessions.start(owner, script, request, plan(List.of(nina), first, together), now).outcome())
                .isEqualTo(StartOutcome.REQUEST_MISMATCH);
        assertThat(sessions.start(owner, script, request, new SessionPlan(List.of(nina), "quiz", first, last, "manual", true), now)
                .outcome()).isEqualTo(StartOutcome.REQUEST_MISMATCH);
        assertThat(sessions.start(member(), script, UUID.randomUUID(), plan(List.of(nina), first, last), now)).isNull();
        assertThat(sessions.start(owner, UUID.randomUUID(), UUID.randomUUID(), plan(List.of(nina), first, last), now)).isNull();
        assertThat(count("reading_sessions")).isEqualTo(1);
    }

    @Test
    @DisplayName("start: 대본의 배역이 아니거나 겹치면 INVALID_CHARACTERS, 구간 끝이 대사 줄이 아니면 INVALID_LINE, 구간에 내 차례가 없으면 EMPTY_RANGE 다. 함께 말하는 줄은 내 배역이 든 묶음이면 내 차례이고, 내 배역이 비면 「전체 듣기」라 내 차례가 없어도 된다")
    void startValidatesTheCastAndTheRange() {
        UUID otherScript = script(owner);
        UUID stranger = character(otherScript, "다른 대본의 배역", 0);

        assertThat(sessions.start(owner, script, UUID.randomUUID(), plan(List.of(stranger), first, last), now).outcome())
                .isEqualTo(StartOutcome.INVALID_CHARACTERS);
        assertThat(sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina, nina), first, last), now).outcome())
                .isEqualTo(StartOutcome.INVALID_CHARACTERS);
        assertThat(sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), scene, last), now).outcome())
                .isEqualTo(StartOutcome.INVALID_LINE);
        assertThat(sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, UUID.randomUUID()), now).outcome())
                .isEqualTo(StartOutcome.INVALID_LINE);
        assertThat(sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), second, second), now).outcome())
                .as("구간에 코스챠의 줄만 있다").isEqualTo(StartOutcome.EMPTY_RANGE);
        assertThat(sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), last, first), now).outcome())
                .as("끝이 시작보다 앞이다").isEqualTo(StartOutcome.EMPTY_RANGE);
        assertThat(count("reading_sessions")).isZero();

        assertThat(sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), together, together), now).outcome())
                .as("내 배역이 든 함께 말하는 줄").isEqualTo(StartOutcome.CREATED);
        assertThat(sessions.start(owner, script, UUID.randomUUID(), plan(List.of(), second, second), now).outcome())
                .as("전체 듣기").isEqualTo(StartOutcome.CREATED);
    }

    @Test
    @DisplayName("find: 회차의 칸과 카드의 집계를 낸다 — 회차 번호는 그 대본에서 시작한 순서(같은 시각이면 id 순), 내 배역 이름은 배역 순서, 구간은 대사 번호, 내 대사 수는 함께 말하는 줄까지, 녹음된 줄 수는 줄 기준이다")
    void findReadsTheSessionAndItsCounts() {
        UUID earlier = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, first), now.minusSeconds(60)).sessionId();
        UUID session = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(kostya, nina), first, last), now).sessionId();
        recording(owner, session, first, 1, "reading/first.m4a");
        recording(owner, session, last, 2, "reading/last.m4a");
        recording(owner, earlier, first, 1, "reading/earlier.m4a");

        SessionDetailView detail = sessions.find(owner, session);

        SessionCardView card = detail.card();
        assertThat(card.id()).isEqualTo(session);
        assertThat(card.ordinal()).isEqualTo(2);
        assertThat(card.status()).isEqualTo("in_progress");
        assertThat(card.myCharacterIds()).as("저장한 순서").containsExactly(kostya, nina);
        assertThat(card.myCharacterNames()).as("배역 순서").containsExactly("니나", "코스챠");
        assertThat(List.of(card.startDialogueNo(), card.endDialogueNo())).containsExactly(1, 4);
        assertThat(card.myDialogueCount()).isEqualTo(4);
        assertThat(card.recordedLineCount()).isEqualTo(2);
        assertThat(card.elapsedSeconds()).isZero();
        assertThat(card.startedAt()).isEqualTo(now);
        assertThat(card.endedAt()).isNull();
        assertThat(card.progress()).isNotNull();
        assertThat(detail.scriptId()).isEqualTo(script);
        assertThat(List.of(detail.mode(), detail.advance())).containsExactly("read", "manual");
        assertThat(detail.record()).isTrue();
        assertThat(List.of(detail.startLineId(), detail.endLineId(), detail.currentLineId())).containsExactly(first, last, first);
        assertThat(detail.progressSeq()).isZero();
        assertThat(detail.lineResults()).isEmpty();
        assertThat(detail.differentLines()).isEmpty();
        assertThat(detail.recordings()).extracting(r -> r.objectKey()).as("줄 순서").containsExactly("reading/first.m4a", "reading/last.m4a");
        assertThat(sessions.find(owner, earlier).card()).extracting(SessionCardView::ordinal, SessionCardView::myDialogueCount)
                .containsExactly(1, 1);
        assertThat(sessions.find(member(), session)).isNull();
        assertThat(sessions.find(owner, UUID.randomUUID())).isNull();
    }

    @Test
    @DisplayName("list: 그 대본의 내 회차를 나중에 시작한 것부터(같은 시각이면 id 가 큰 것부터) 카드로 낸다. 회차가 없으면 빈 목록, 남의 대본·없는 대본은 null 이다")
    void listReturnsMySessionsNewestFirst() {
        UUID a = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now.minusSeconds(60)).sessionId();
        UUID b = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now).sessionId();
        UUID c = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now).sessionId();
        UUID otherScript = script(owner);
        UUID otherLine = line(otherScript, 1, "dialogue", character(otherScript, "니나", 0), "다른 대본");
        session(owner, otherScript, otherLine, otherLine);
        // PostgreSQL 의 uuid 순서는 바이트 순이다. Java 의 UUID.compareTo 는 부호 있는 long 으로 견줘 순서가 다를 수 있다.
        List<UUID> tie = b.toString().compareTo(c.toString()) > 0 ? List.of(b, c) : List.of(c, b);

        List<SessionCardView> cards = sessions.list(owner, script);

        assertThat(cards).extracting(SessionCardView::id).containsExactly(tie.get(0), tie.get(1), a);
        assertThat(cards).extracting(SessionCardView::ordinal).containsExactly(3, 2, 1);
        assertThat(cards.getLast()).isEqualTo(sessions.find(owner, a).card());
        assertThat(sessions.list(owner, script(owner))).isEmpty();
        assertThat(sessions.list(member(), script)).isNull();
        assertThat(sessions.list(owner, UUID.randomUUID())).isNull();
    }

    @Test
    @DisplayName("saveProgress: 저장된 순번보다 큰 요청만 반영한다 — 위치·걸린 시간(줄어들지 않는다)·순번·줄 결과와 말한 것을 적고 고친 시각을 바꾼다. 같거나 작은 순번은 IGNORED 로 지금 값을 낸다")
    void saveProgressAppliesOnlyNewerSequences() {
        UUID session = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now).sessionId();

        Progress applied = sessions.saveProgress(owner, session, new ProgressChange(3, last, 40,
                List.of(new LineReport.Said(first, "안녕하세요"), new LineReport.Reported(last, "unmatched", 2)), false),
                now.plusSeconds(10).plusNanos(1_500));

        assertThat(applied.outcome()).isEqualTo(ProgressOutcome.APPLIED);
        assertThat(applied.view()).extracting(ProgressView::currentLineId, ProgressView::elapsedSeconds, ProgressView::progressSeq,
                ProgressView::status).containsExactly(last, 40, 3L, "in_progress");
        assertThat(applied.view().differentLines()).extracting(line -> line.lineId()).containsExactly(last);
        assertThat(jdbc.queryForObject("SELECT line_results = CAST(? AS jsonb) FROM reading_sessions WHERE id=?", Boolean.class,
                "[{\"line_id\":\"" + first + "\",\"outcome\":\"passed\",\"misses\":0},"
                        + "{\"line_id\":\"" + last + "\",\"outcome\":\"unmatched\",\"misses\":2}]", session)).isTrue();
        assertThat(jdbc.queryForObject("SELECT line_said = CAST(? AS jsonb) FROM reading_sessions WHERE id=?", Boolean.class,
                "{\"" + first + "\":\"안녕하세요\"}", session)).isTrue();
        assertThat(jdbc.queryForMap("SELECT status,ended_at FROM reading_sessions WHERE id=?", session))
                .containsEntry("status", "in_progress").containsEntry("ended_at", null);
        assertThat(instant("SELECT updated_at FROM reading_sessions WHERE id=?", session))
                .isEqualTo(now.plusSeconds(10).plus(2, ChronoUnit.MICROS));
        assertThat(sessions.find(owner, session).lineResults()).containsExactly(
                new LineResult(first, "passed", 0, "안녕하세요"), new LineResult(last, "unmatched", 2, null));

        for (long stale : new long[] {3, 1}) {
            Progress ignored = sessions.saveProgress(owner, session, new ProgressChange(stale, first, 99, List.of(), false),
                    now.plusSeconds(20));
            assertThat(ignored.outcome()).isEqualTo(ProgressOutcome.IGNORED);
            assertThat(ignored.view()).isEqualTo(applied.view());
        }
        Progress kept = sessions.saveProgress(owner, session, new ProgressChange(4, null, 5, List.of(), false), now.plusSeconds(30));
        assertThat(kept.view()).as("위치를 보내지 않으면 그대로, 걸린 시간은 줄어들지 않는다")
                .extracting(ProgressView::currentLineId, ProgressView::elapsedSeconds, ProgressView::progressSeq)
                .containsExactly(last, 40, 4L);
    }

    @Test
    @DisplayName("saveProgress: 완료하면 completed 로 닫고 위치를 비우고 끝난 시각을 적는다. 닫힌 회차는 CLOSED 로 지금 값을 내고, 구간 밖 줄은 INVALID_LINE, 남의 회차는 null 이다. 어느 쪽도 쓰지 않는다")
    void saveProgressCompletesAndRefuses() {
        UUID session = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, together), now).sessionId();

        assertThat(sessions.saveProgress(owner, session, new ProgressChange(1, last, 1, List.of(), false), now))
                .as("구간 밖 위치").isEqualTo(new Progress(null, ProgressOutcome.INVALID_LINE));
        assertThat(sessions.saveProgress(owner, session,
                new ProgressChange(1, first, 1, List.of(new LineReport.Reported(scene, "passed", 0)), false), now))
                .as("대사 줄이 아닌 결과").isEqualTo(new Progress(null, ProgressOutcome.INVALID_LINE));
        assertThat(sessions.saveProgress(member(), session, new ProgressChange(1, first, 1, List.of(), false), now)).isNull();
        assertThat(jdbc.queryForObject("SELECT progress_seq FROM reading_sessions WHERE id=?", Long.class, session)).isZero();

        Progress completed = sessions.saveProgress(owner, session, new ProgressChange(2, first, 70, List.of(), true),
                now.plusSeconds(90));
        assertThat(completed.outcome()).isEqualTo(ProgressOutcome.APPLIED);
        assertThat(completed.view()).isEqualTo(new ProgressView(null, 70, 2, "completed", List.of()));
        assertThat(jdbc.queryForMap("SELECT status,current_line_id FROM reading_sessions WHERE id=?", session))
                .containsEntry("status", "completed").containsEntry("current_line_id", null);
        assertThat(instant("SELECT ended_at FROM reading_sessions WHERE id=?", session)).isEqualTo(now.plusSeconds(90));
        assertThat(sessions.find(owner, session).card().progress()).as("끝난 회차는 진행을 내지 않는다").isNull();

        assertThat(sessions.saveProgress(owner, session, new ProgressChange(9, first, 99, List.of(), false), now.plusSeconds(99)))
                .isEqualTo(new Progress(new ProgressView(null, 70, 2, "completed", List.of()), ProgressOutcome.CLOSED));
        assertThat(instant("SELECT updated_at FROM reading_sessions WHERE id=?", session)).isEqualTo(now.plusSeconds(90));
    }

    @Test
    @DisplayName("delete: 회차와 그 녹음·평가를 지우고 녹음의 객체를 장부 한 줄에 올린다. 녹음이 없으면 장부에 올리지 않는다. 암기 표시와 다른 회차는 그대로다. 남의 회차·없는 회차는 null 이다")
    void deleteRemovesTheSessionWithItsRecordingsAndRating() {
        UUID session = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now).sessionId();
        UUID other = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now).sessionId();
        recording(owner, session, first, 1, "reading/first.m4a");
        recording(owner, session, last, 1, "reading/last.m4a");
        recording(owner, other, first, 1, "reading/other.m4a");
        jdbc.update("INSERT INTO reading_session_ratings(id,session_id,user_id,rating,request_id) VALUES (?,?,?,'good',?)",
                UUID.randomUUID(), session, owner, UUID.randomUUID());
        jdbc.update("INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (?,?,?,'memorized')",
                UUID.randomUUID(), owner, first);

        assertThat(sessions.delete(member(), session, now)).isNull();
        assertThat(sessions.delete(owner, UUID.randomUUID(), now)).isNull();
        assertThat(count("reading_sessions")).isEqualTo(2);

        assertThat(sessions.delete(owner, session, now)).singleElement().satisfies(operation ->
                assertThat(scheduledKeys(operation)).containsExactlyInAnyOrder("reading/first.m4a", "reading/last.m4a"));
        assertThat(jdbc.queryForList("SELECT id FROM reading_sessions", UUID.class)).containsExactly(other);
        assertThat(jdbc.queryForList("SELECT object_key FROM reading_recordings", String.class)).containsExactly("reading/other.m4a");
        assertThat(count("reading_session_ratings")).isZero();
        assertThat(count("line_memorization")).isEqualTo(1);

        jdbc.update("DELETE FROM reading_recordings");
        assertThat(sessions.delete(owner, other, now)).as("녹음이 없다").isEmpty();
        assertThat(count("account_cleanup_operations")).isEqualTo(1);
    }

    @Test
    @DisplayName("start 는 대본 행을, saveProgress 와 delete 는 회차 행을 FOR UPDATE 로 잡는다 — 바깥 연결이 그 행을 FOR KEY SHARE 로 잡고 있으면 그 뒤에서 기다린다")
    void writesLockTheirRows() throws Exception {
        UUID session = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now).sessionId();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM scripts WHERE id=? FOR KEY SHARE", script);
            Future<Start> starting = pool.submit(() ->
                    sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now));
            String onScript = awaitWaiting("from scripts");
            probe.rollback();
            assertThat(onScript).startsWith("select").contains("for update");
            assertThat(starting.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(StartOutcome.CREATED);

            run(probe, "SELECT 1 FROM reading_sessions WHERE id=? FOR KEY SHARE", session);
            Future<Progress> saving = pool.submit(() ->
                    sessions.saveProgress(owner, session, new ProgressChange(1, last, 1, List.of(), false), now));
            String onSession = awaitWaiting("from reading_sessions");
            probe.rollback();
            assertThat(onSession).startsWith("select").contains("for update");
            assertThat(saving.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(ProgressOutcome.APPLIED);

            run(probe, "SELECT 1 FROM reading_sessions WHERE id=? FOR KEY SHARE", session);
            Future<List<UUID>> deleting = pool.submit(() -> sessions.delete(owner, session, now));
            String onDelete = awaitWaiting("from reading_sessions");
            probe.rollback();
            assertThat(onDelete).startsWith("select").contains("for update");
            assertThat(deleting.get(20, TimeUnit.SECONDS)).isEmpty();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("회차 행을 잡고 있는 동안 그 회차의 새 녹음은 들어오지 못한다 — 녹음 INSERT 가 회차 행의 잠금 뒤에서 기다린다. 그래서 회차를 지울 때 읽은 녹음이 지우는 녹음의 전부다")
    void aHeldSessionLockKeepsNewRecordingsOut() throws Exception {
        UUID session = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now).sessionId();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM reading_sessions WHERE id=? FOR UPDATE", session);
            Future<UUID> inserting = pool.submit(() -> recording(owner, session, first, 1, "reading/late.m4a"));
            String waiting = awaitWaiting("insert into reading_recordings");
            assertThat(count("reading_recordings")).isZero();
            probe.rollback();

            assertThat(waiting).startsWith("insert into reading_recordings");
            inserting.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("회차를 지우는 사이 다른 연결이 그 회차의 녹음 하나를 지우고 있으면 그 커밋을 기다렸다가 건너뛴다 — 지워진 녹음의 키를 장부에 올리지 않는다. 되돌리면 그 키도 올린다")
    void deleteSkipsARecordingDeletedUnderneathIt() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            for (boolean commit : new boolean[] {true, false}) {
                UUID session = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now).sessionId();
                UUID gone = recording(owner, session, first, 1, "reading/gone-" + commit + ".m4a");
                recording(owner, session, last, 1, "reading/kept-" + commit + ".m4a");
                run(probe, "DELETE FROM reading_recordings WHERE id=?", gone);
                Future<List<UUID>> deleting = pool.submit(() -> sessions.delete(owner, session, now));
                awaitWaiting("reading_recordings");
                if (commit) {
                    probe.commit();
                } else {
                    probe.rollback();
                }

                List<String> keys = scheduledKeys(deleting.get(20, TimeUnit.SECONDS).getFirst());
                if (commit) {
                    assertThat(keys).containsExactly("reading/kept-true.m4a");
                } else {
                    assertThat(keys).containsExactlyInAnyOrder("reading/gone-false.m4a", "reading/kept-false.m4a");
                }
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(count("reading_recordings")).isZero();
    }

    @Test
    @DisplayName("같은 요청 id 의 시작 둘이 겹치면 뒤의 것이 대본 행에서 앞의 커밋을 기다렸다가 REPLAYED 로 같은 회차를 낸다. 회차는 하나다")
    void twoStartsOfTheSameRequest() throws Exception {
        UUID request = UUID.randomUUID();
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Start> firstStart = pool.submit(() -> inTransaction(() -> {
                Start start = sessions.start(owner, script, request, plan(List.of(nina), first, last), now);
                started.countDown();
                await(release);
                return start;
            }));
            await(started);
            Future<Start> secondStart = pool.submit(() ->
                    sessions.start(owner, script, request, plan(List.of(nina), first, last), now.plusSeconds(1)));
            assertThat(awaitWaiting("from scripts")).contains("for update");
            release.countDown();

            Start created = firstStart.get(20, TimeUnit.SECONDS);
            assertThat(created.outcome()).isEqualTo(StartOutcome.CREATED);
            assertThat(secondStart.get(20, TimeUnit.SECONDS)).isEqualTo(new Start(created.sessionId(), StartOutcome.REPLAYED));
        } finally {
            pool.shutdownNow();
        }
        assertThat(count("reading_sessions")).isEqualTo(1);
    }

    @Test
    @DisplayName("진행 저장 둘이 겹치면 뒤의 것이 회차 행에서 앞의 커밋을 기다렸다가 순번을 다시 본다 — 앞선 순번이 뒤에 오면 IGNORED 이고 큰 순번이 뒤에 오면 반영한다. 지우는 사이에 온 저장은 null 이다")
    void twoProgressSavesAtOnce() throws Exception {
        UUID session = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now).sessionId();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (long[] sequences : new long[][] {{5, 4}, {6, 7}}) {
                CountDownLatch saved = new CountDownLatch(1);
                CountDownLatch release = new CountDownLatch(1);
                Future<Progress> ahead = pool.submit(() -> inTransaction(() -> {
                    Progress progress = sessions.saveProgress(owner, session,
                            new ProgressChange(sequences[0], last, 10, List.of(), false), now);
                    saved.countDown();
                    await(release);
                    return progress;
                }));
                await(saved);
                Future<Progress> behind = pool.submit(() -> sessions.saveProgress(owner, session,
                        new ProgressChange(sequences[1], first, 20, List.of(), false), now));
                assertThat(awaitWaiting("from reading_sessions")).contains("for update");
                release.countDown();

                assertThat(ahead.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(ProgressOutcome.APPLIED);
                Progress late = behind.get(20, TimeUnit.SECONDS);
                assertThat(late.outcome()).isEqualTo(sequences[1] > sequences[0] ? ProgressOutcome.APPLIED : ProgressOutcome.IGNORED);
                assertThat(late.view().progressSeq()).isEqualTo(Math.max(sequences[0], sequences[1]));
            }
            try (Connection probe = probe()) {
                run(probe, "DELETE FROM reading_sessions WHERE id=?", session);
                Future<Progress> afterDelete = pool.submit(() -> sessions.saveProgress(owner, session,
                        new ProgressChange(99, first, 1, List.of(), false), now));
                awaitWaiting("from reading_sessions");
                probe.commit();
                assertThat(afterDelete.get(20, TimeUnit.SECONDS)).isNull();
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("요청 하나가 보내는 문장: 시작은 대본 잠금·재전송 확인·배역·줄·INSERT 다섯, 진행 저장은 회차 잠금·줄·확정을 기다리지 않는 설정·UPDATE 넷이고 완료 저장은 그 설정 없이 셋이다. 상세는 셋, 목록은 셋이다")
    void eachRequestSendsTheseStatements() {
        String scriptLock = "select scripts for update";
        String sessionLock = "select reading_sessions for update";
        String sessionRead = "select reading_sessions";
        String lines = "select script_lines";
        String asyncCommit = "set local synchronous_commit = off";
        UUID request = UUID.randomUUID();

        assertThat(statementsOf(() -> sessions.start(owner, script, request, plan(List.of(nina), first, last), now)))
                .as("시작").containsExactly(scriptLock, sessionRead, "select script_characters", lines, "insert reading_sessions");
        assertThat(statementsOf(() -> sessions.start(owner, script, request, plan(List.of(nina), first, last), now)))
                .as("재전송").containsExactly(scriptLock, sessionRead);
        assertThat(statementsOf(() -> sessions.start(member(), script, UUID.randomUUID(), plan(List.of(nina), first, last), now)))
                .as("남의 대본").containsExactly(scriptLock);
        UUID session = jdbc.queryForObject("SELECT id FROM reading_sessions", UUID.class);
        recording(owner, session, first, 1, "reading/first.m4a");

        assertThat(statementsOf(() -> sessions.saveProgress(owner, session, new ProgressChange(1, last, 1, List.of(), false), now)))
                .as("진행 저장").containsExactly(sessionLock, lines, asyncCommit, "update reading_sessions");
        assertThat(statementsOf(() -> sessions.saveProgress(owner, session, new ProgressChange(1, last, 1, List.of(), false), now)))
                .as("앞선 순번").containsExactly(sessionLock, lines);
        assertThat(statementsOf(() -> sessions.find(owner, session))).as("상세")
                .containsExactly(sessionRead, lines, "select reading_recordings");
        assertThat(statementsOf(() -> sessions.list(owner, script))).as("목록").containsExactly("select scripts", lines, sessionRead);
        assertThat(statementsOf(() -> sessions.list(member(), script))).containsExactly("select scripts");
        assertThat(statementsOf(() -> sessions.saveProgress(owner, session, new ProgressChange(2, last, 1, List.of(), true), now)))
                .as("완료 저장은 확정을 기다린다").containsExactly(sessionLock, lines, "update reading_sessions");
        assertThat(statementsOf(() -> sessions.saveProgress(owner, session, new ProgressChange(3, last, 1, List.of(), false), now)))
                .as("닫힌 회차").containsExactly(sessionLock);
        assertThat(statementsOf(() -> sessions.delete(owner, session, now))).as("녹음이 있는 회차 지우기").containsExactly(
                sessionLock, "select reading_recordings for update", "delete reading_recordings", "delete reading_session_ratings",
                "delete reading_sessions", "insert account_cleanup_operations");
        assertThat(statementsOf(() -> sessions.delete(owner, session, now))).containsExactly(sessionLock);
        UUID bare = sessions.start(owner, script, UUID.randomUUID(), plan(List.of(nina), first, last), now).sessionId();
        assertThat(statementsOf(() -> sessions.delete(owner, bare, now))).as("녹음이 없는 회차 지우기").containsExactly(
                sessionLock, "select reading_recordings for update", "delete reading_session_ratings", "delete reading_sessions");
    }

    /** 읽기 방식, 손으로 넘김, 녹음 켬. */
    private static SessionPlan plan(List<UUID> myCharacterIds, UUID startLineId, UUID endLineId) {
        return new SessionPlan(myCharacterIds, "read", startLineId, endLineId, "manual", true);
    }
}
