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

import com.acttub.actingapi.feature.reading.app.RecordingRepository;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.NewRecording;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.Precheck;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.PrecheckOutcome;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.StoreOutcome;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.Stored;
import com.acttub.actingapi.feature.reading.app.SessionViews.RecordingView;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 줄 단위 녹음 저장소가 내는 결과·잠금·경합·문장을 고정한다. 올리기·변환·크기 한도·재생 주소의 HTTP 흐름과 같은 요청 id 가
 * 겹칠 때의 응답은 {@link ReadingRecordingIT} 가 본다. 여기서는 저장소 한 번의 부름이 내는 값과 장부에 올리는 키, 회차 행과
 * 녹음 행의 잠금, 잠금을 기다린 뒤 다시 보는 것(같은 요청 id·같은 줄·옮겨진 회차), 요청 하나가 보내는 문장을 본다 — 녹음
 * 올리기는 요청이 많은 경로라 문장 수가 늘면 안 된다.
 */
class RecordingRepositoryIT extends ReadingRepositoryFixture {

    private static final long QUOTA = 1_000_000L;

    @Autowired
    RecordingRepository recordings;

    private UUID owner;
    private UUID script;
    private UUID nina;
    private UUID mine;
    private UUID mineToo;
    private UUID theirs;
    private UUID session;

    @BeforeEach
    void setUp() {
        owner = member();
        script = script(owner);
        nina = character(script, "니나", 0);
        UUID kostya = character(script, "코스챠", 1);
        mine = line(script, 1, "dialogue", nina, "안녕하세요");
        theirs = line(script, 2, "dialogue", kostya, "왔구나");
        mineToo = line(script, 3, "dialogue", nina, "잘 가요");
        session = session(owner, script, mine, mineToo, nina);
    }

    @Test
    @DisplayName("store: 처음 말한 줄은 행을 만든다 — 넘긴 값과 전사를 원문과 견준 결과를 적고 시각을 마이크로초로 반올림한다. 장부에 올릴 것은 없다")
    void storeCreatesTheRow() {
        UUID request = UUID.randomUUID();

        Stored stored = recordings.store(owner, session, take(request, mine, 1, "reading/a.m4a", 1000, "안녕하세요", "stt"),
                QUOTA, now.plusNanos(123_456_789));

        UUID id = jdbc.queryForObject("SELECT id FROM reading_recordings", UUID.class);
        assertThat(stored).isEqualTo(new Stored(StoreOutcome.CREATED,
                new RecordingView(id, mine, 1, 1200, "audio/mp4", 1000, "안녕하세요", "stt", true, "reading/a.m4a", null, null),
                List.of()));
        assertThat(jdbc.queryForMap("SELECT user_id,reading_session_id,line_id,request_id FROM reading_recordings"))
                .containsEntry("user_id", owner).containsEntry("reading_session_id", session).containsEntry("line_id", mine)
                .containsEntry("request_id", request);
        assertThat(instant("SELECT created_at FROM reading_recordings")).isEqualTo(now.plus(123_457, ChronoUnit.MICROS));
        assertThat(instant("SELECT updated_at FROM reading_recordings")).isEqualTo(now.plus(123_457, ChronoUnit.MICROS));
        assertThat(count("account_cleanup_operations")).isZero();

        assertThat(recordings.store(owner, session, take(UUID.randomUUID(), mineToo, 1, "reading/b.m4a", 10, "전혀 다른 말", "stt"),
                QUOTA, now).recording().matched()).as("원문과 다르다").isFalse();
        UUID silentSession = session(owner, script, mine, mineToo, nina);
        assertThat(recordings.store(owner, silentSession, take(UUID.randomUUID(), mine, 1, "reading/c.m4a", 10, null, "none"),
                QUOTA, now).recording())
                .as("전사 없이").extracting(RecordingView::transcript, RecordingView::transcriptSource, RecordingView::matched)
                .containsExactly(null, "none", null);
    }

    @Test
    @DisplayName("store: 같은 줄을 더 큰 시도 번호로 다시 말하면 같은 행을 대체하고 앞 객체를 장부에 올린다. 만든 시각과 id 는 그대로다. 같거나 작은 시도 번호는 IGNORED 로 지금 행을 내고 올린 객체를 장부에 올린다")
    void storeReplacesOrIgnoresByAttemptNumber() {
        Stored first = recordings.store(owner, session, take(UUID.randomUUID(), mine, 2, "reading/2.m4a", 1000, "안녕하세요", "stt"),
                QUOTA, now);
        UUID request = UUID.randomUUID();

        Stored replaced = recordings.store(owner, session, take(request, mine, 3, "reading/3.m4a", 500, null, "none"), QUOTA,
                now.plusSeconds(60));

        assertThat(replaced.outcome()).isEqualTo(StoreOutcome.REPLACED);
        assertThat(replaced.recording()).isEqualTo(new RecordingView(first.recording().id(), mine, 3, 1200, "audio/mp4", 500,
                null, "none", null, "reading/3.m4a", null, null));
        assertThat(replaced.cleanupOperationIds()).singleElement()
                .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly("reading/2.m4a"));
        assertThat(jdbc.queryForObject("SELECT request_id FROM reading_recordings", UUID.class)).isEqualTo(request);
        assertThat(instant("SELECT created_at FROM reading_recordings")).isEqualTo(now);
        assertThat(instant("SELECT updated_at FROM reading_recordings")).isEqualTo(now.plusSeconds(60));

        for (int late : new int[] {3, 1}) {
            Stored ignored = recordings.store(owner, session,
                    take(UUID.randomUUID(), mine, late, "reading/late-" + late + ".m4a", 10, null, "none"), QUOTA, now);
            assertThat(ignored.outcome()).isEqualTo(StoreOutcome.IGNORED);
            assertThat(ignored.recording()).isEqualTo(replaced.recording());
            assertThat(ignored.cleanupOperationIds()).singleElement()
                    .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly("reading/late-" + late + ".m4a"));
        }
        assertThat(count("reading_recordings")).isEqualTo(1);
    }

    @Test
    @DisplayName("store: 같은 요청 id 의 재전송은 REPLAYED 로 저장된 행을 낸다. 저장된 행이 가리키는 키는 장부에 올리지 않고, 다른 키로 올린 객체는 올린다")
    void storeReplaysTheSameRequest() {
        UUID request = UUID.randomUUID();
        Stored first = recordings.store(owner, session, take(request, mine, 1, "reading/a.m4a", 1000, null, "none"), QUOTA, now);

        Stored sameKey = recordings.store(owner, session, take(request, mine, 1, "reading/a.m4a", 1000, null, "none"), QUOTA, now);
        Stored otherLine = recordings.store(owner, session, take(request, mineToo, 1, "reading/other.m4a", 10, null, "none"),
                QUOTA, now);

        assertThat(sameKey).isEqualTo(new Stored(StoreOutcome.REPLAYED, first.recording(), List.of()));
        assertThat(otherLine.outcome()).isEqualTo(StoreOutcome.REPLAYED);
        assertThat(otherLine.recording()).isEqualTo(first.recording());
        assertThat(otherLine.cleanupOperationIds()).singleElement()
                .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly("reading/other.m4a"));
        assertThat(count("reading_recordings")).isEqualTo(1);
    }

    @Test
    @DisplayName("store: 남의 회차·없는 회차는 NOT_FOUND, 구간 안 내 대사 줄이 아니면 INVALID_LINE 이고 올린 객체를 장부에 올린다. 그 키를 이 회차의 행이나 회차 연결이 빈 보관 행이 가리키면 올리지 않는다")
    void storeRejectsAndSchedulesTheUploadedObject() {
        UUID stranger = member();

        Stored notMine = recordings.store(stranger, session, take(UUID.randomUUID(), mine, 1, "reading/x.m4a", 10, null, "none"),
                QUOTA, now);
        assertThat(notMine.outcome()).isEqualTo(StoreOutcome.NOT_FOUND);
        assertThat(notMine.recording()).isNull();
        assertThat(notMine.cleanupOperationIds()).singleElement()
                .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly("reading/x.m4a"));
        assertThat(recordings.store(owner, UUID.randomUUID(), take(UUID.randomUUID(), mine, 1, "reading/y.m4a", 10, null, "none"),
                QUOTA, now).outcome()).isEqualTo(StoreOutcome.NOT_FOUND);
        Stored notMyLine = recordings.store(owner, session, take(UUID.randomUUID(), theirs, 1, "reading/z.m4a", 10, null, "none"),
                QUOTA, now);
        assertThat(notMyLine.outcome()).isEqualTo(StoreOutcome.INVALID_LINE);
        assertThat(notMyLine.cleanupOperationIds()).hasSize(1);
        assertThat(count("reading_recordings")).isZero();

        recordings.store(owner, session, take(UUID.randomUUID(), mine, 1, "reading/kept.m4a", 10, null, "none"), QUOTA, now);
        assertThat(recordings.store(owner, session, take(UUID.randomUUID(), theirs, 1, "reading/kept.m4a", 10, null, "none"),
                QUOTA, now).cleanupOperationIds()).as("이 회차의 행이 가리키는 키").isEmpty();
        jdbc.update("UPDATE reading_recordings SET reading_session_id=NULL, line_id=NULL");
        assertThat(recordings.store(stranger, session, take(UUID.randomUUID(), mine, 1, "reading/kept.m4a", 10, null, "none"),
                QUOTA, now).cleanupOperationIds()).as("회차 연결이 빈 보관 행이 가리키는 키").isEmpty();
    }

    @Test
    @DisplayName("store: 총량은 그 사람의 모든 녹음을 세고 대체되는 앞 녹음은 뺀다. 상한과 같으면 저장하고 넘으면 QUOTA 로 올린 객체를 장부에 올린다")
    void storeEnforcesTheQuota() {
        recordings.store(owner, session, take(UUID.randomUUID(), mine, 1, "reading/a.m4a", 600, null, "none"), 1000, now);

        Stored over = recordings.store(owner, session, take(UUID.randomUUID(), mineToo, 1, "reading/b.m4a", 401, null, "none"),
                1000, now);
        assertThat(over.outcome()).isEqualTo(StoreOutcome.QUOTA);
        assertThat(over.recording()).isNull();
        assertThat(over.cleanupOperationIds()).singleElement()
                .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly("reading/b.m4a"));

        assertThat(recordings.store(owner, session, take(UUID.randomUUID(), mineToo, 1, "reading/c.m4a", 400, null, "none"),
                1000, now).outcome()).as("상한과 같다").isEqualTo(StoreOutcome.CREATED);
        assertThat(recordings.store(owner, session, take(UUID.randomUUID(), mine, 2, "reading/d.m4a", 600, null, "none"),
                1000, now).outcome()).as("앞 녹음 600을 빼고 센다").isEqualTo(StoreOutcome.REPLACED);
        assertThat(recordings.store(owner, session, take(UUID.randomUUID(), mine, 3, "reading/e.m4a", 601, null, "none"),
                1000, now).outcome()).isEqualTo(StoreOutcome.QUOTA);
    }

    @Test
    @DisplayName("precheck: 잠그지 않고 같은 것을 본다 — 남의 회차 NOT_FOUND, 내 대사 줄이 아니면 INVALID_LINE, 같은 요청 id 는 REPLAYED, 같거나 큰 시도 번호가 있으면 IGNORED, 아니면 OK 다")
    void precheckSeesTheSameThingsWithoutLocking() throws Exception {
        UUID request = UUID.randomUUID();
        RecordingView stored = recordings.store(owner, session, take(request, mine, 2, "reading/a.m4a", 10, null, "none"),
                QUOTA, now).recording();

        assertThat(recordings.precheck(member(), session, mine, UUID.randomUUID(), 3))
                .isEqualTo(new Precheck(PrecheckOutcome.NOT_FOUND, null));
        assertThat(recordings.precheck(owner, session, theirs, UUID.randomUUID(), 1))
                .isEqualTo(new Precheck(PrecheckOutcome.INVALID_LINE, null));
        assertThat(recordings.precheck(owner, session, mineToo, request, 1)).isEqualTo(new Precheck(PrecheckOutcome.REPLAYED, stored));
        assertThat(recordings.precheck(owner, session, mine, UUID.randomUUID(), 2))
                .isEqualTo(new Precheck(PrecheckOutcome.IGNORED, stored));
        assertThat(recordings.precheck(owner, session, mine, UUID.randomUUID(), 3)).isEqualTo(new Precheck(PrecheckOutcome.OK, null));
        assertThat(recordings.precheck(owner, session, mineToo, UUID.randomUUID(), 1)).isEqualTo(new Precheck(PrecheckOutcome.OK, null));

        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM reading_sessions WHERE id=? FOR UPDATE", session);
            run(probe, "SELECT 1 FROM reading_recordings WHERE id=? FOR UPDATE", stored.id());
            assertThat(recordings.precheck(owner, session, mine, UUID.randomUUID(), 3).outcome())
                    .as("회차와 녹음 행이 잠겨 있어도 기다리지 않는다").isEqualTo(PrecheckOutcome.OK);
            probe.rollback();
        }
    }

    @Test
    @DisplayName("delete: 내 녹음의 행을 지우고 객체를 장부에 올린다. 남의 녹음·없는 녹음은 null 이고 아무것도 지우지 않는다")
    void deleteRemovesTheRowAndSchedulesTheObject() {
        UUID id = recordings.store(owner, session, take(UUID.randomUUID(), mine, 1, "reading/a.m4a", 10, null, "none"), QUOTA, now)
                .recording().id();

        assertThat(recordings.delete(member(), id, now)).isNull();
        assertThat(recordings.delete(owner, UUID.randomUUID(), now)).isNull();
        assertThat(count("reading_recordings")).isEqualTo(1);

        assertThat(recordings.delete(owner, id, now)).singleElement()
                .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly("reading/a.m4a"));
        assertThat(count("reading_recordings")).isZero();
        assertThat(recordings.delete(owner, id, now)).isNull();
    }

    @Test
    @DisplayName("store 는 회차 행을, 같은 줄의 앞 녹음이 있으면 그 행도 FOR UPDATE 로 잡는다. delete 는 녹음 행을 잡는다 — 바깥 연결이 그 행을 FOR KEY SHARE 로 잡고 있으면 그 뒤에서 기다린다")
    void storeAndDeleteLockTheirRows() throws Exception {
        UUID id = recordings.store(owner, session, take(UUID.randomUUID(), mine, 1, "reading/a.m4a", 10, null, "none"), QUOTA, now)
                .recording().id();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM reading_sessions WHERE id=? FOR KEY SHARE", session);
            Future<Stored> onSession = pool.submit(() ->
                    recordings.store(owner, session, take(UUID.randomUUID(), mine, 2, "reading/b.m4a", 10, null, "none"), QUOTA, now));
            String waitingOnSession = awaitWaiting("from reading_sessions");
            probe.rollback();
            assertThat(waitingOnSession).startsWith("select").contains("for update");
            assertThat(onSession.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(StoreOutcome.REPLACED);

            run(probe, "SELECT 1 FROM reading_recordings WHERE id=? FOR KEY SHARE", id);
            Future<Stored> onRecording = pool.submit(() ->
                    recordings.store(owner, session, take(UUID.randomUUID(), mine, 3, "reading/c.m4a", 10, null, "none"), QUOTA, now));
            String waitingOnRecording = awaitWaiting("from reading_recordings");
            probe.rollback();
            assertThat(waitingOnRecording).startsWith("select").contains("for update");
            assertThat(onRecording.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(StoreOutcome.REPLACED);

            run(probe, "SELECT 1 FROM reading_recordings WHERE id=? FOR KEY SHARE", id);
            Future<List<UUID>> deletion = pool.submit(() -> recordings.delete(owner, id, now));
            String waitingToDelete = awaitWaiting("from reading_recordings");
            probe.rollback();
            assertThat(waitingToDelete).startsWith("select").contains("for update");
            assertThat(deletion.get(20, TimeUnit.SECONDS)).hasSize(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("같은 요청 id 의 올리기 둘이 겹치면 뒤의 것이 회차 행에서 앞의 커밋을 기다렸다가 REPLAYED 다 — 행은 하나이고 저장된 행이 가리키는 키를 장부에 올리지 않는다(SOMA-1115)")
    void twoStoresOfTheSameRequest() throws Exception {
        UUID request = UUID.randomUUID();
        NewRecording same = take(request, mine, 1, "reading/same.m4a", 10, null, "none");
        CountDownLatch stored = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Stored> first = pool.submit(() -> inTransaction(() -> {
                Stored mineFirst = recordings.store(owner, session, same, QUOTA, now);
                stored.countDown();
                await(release);
                return mineFirst;
            }));
            await(stored);
            Future<Stored> second = pool.submit(() -> recordings.store(owner, session, same, QUOTA, now.plusSeconds(1)));
            assertThat(awaitWaiting("from reading_sessions")).contains("for update");
            release.countDown();

            assertThat(first.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(StoreOutcome.CREATED);
            assertThat(second.get(20, TimeUnit.SECONDS))
                    .isEqualTo(new Stored(StoreOutcome.REPLAYED, first.get().recording(), List.of()));
        } finally {
            pool.shutdownNow();
        }
        assertThat(count("reading_recordings")).isEqualTo(1);
        assertThat(count("account_cleanup_operations")).as("저장된 행의 객체를 지우지 않는다").isZero();
    }

    @Test
    @DisplayName("같은 줄을 두 요청이 함께 올리면 뒤의 것이 기다렸다가 앞의 행을 시도 번호로 판정한다 — 큰 번호가 뒤면 대체하고 작은 번호가 뒤면 IGNORED 다. 행은 하나다")
    void twoStoresOfTheSameLine() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int[] attempts : new int[][] {{1, 2}, {4, 3}}) {
                CountDownLatch stored = new CountDownLatch(1);
                CountDownLatch release = new CountDownLatch(1);
                Future<Stored> first = pool.submit(() -> inTransaction(() -> {
                    Stored mineFirst = recordings.store(owner, session,
                            take(UUID.randomUUID(), mine, attempts[0], "reading/" + attempts[0] + ".m4a", 10, null, "none"), QUOTA, now);
                    stored.countDown();
                    await(release);
                    return mineFirst;
                }));
                await(stored);
                Future<Stored> second = pool.submit(() -> recordings.store(owner, session,
                        take(UUID.randomUUID(), mine, attempts[1], "reading/" + attempts[1] + ".m4a", 10, null, "none"), QUOTA, now));
                awaitWaiting("from reading_sessions");
                release.countDown();

                first.get(20, TimeUnit.SECONDS);
                assertThat(second.get(20, TimeUnit.SECONDS).outcome())
                        .isEqualTo(attempts[1] > attempts[0] ? StoreOutcome.REPLACED : StoreOutcome.IGNORED);
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT attempt_no FROM reading_recordings", Integer.class)).containsExactly(4);
    }

    @Test
    @DisplayName("회차를 옮기는 사이에 온 올리기는 회차 행에서 기다렸다가 다시 본다 — 커밋되면 남의 것이라 NOT_FOUND 이고 올린 객체를 장부에 올린다. 되돌리면 저장한다")
    void storeRechecksTheOwnerAfterWaiting() throws Exception {
        UUID member = member();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "UPDATE reading_sessions SET user_id=? WHERE id=?", member, session);
            Future<Stored> rolledBack = pool.submit(() ->
                    recordings.store(owner, session, take(UUID.randomUUID(), mine, 1, "reading/a.m4a", 10, null, "none"), QUOTA, now));
            awaitWaiting("from reading_sessions");
            probe.rollback();
            assertThat(rolledBack.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(StoreOutcome.CREATED);

            run(probe, "UPDATE reading_sessions SET user_id=? WHERE id=?", member, session);
            Future<Stored> committed = pool.submit(() ->
                    recordings.store(owner, session, take(UUID.randomUUID(), mine, 2, "reading/b.m4a", 10, null, "none"), QUOTA, now));
            awaitWaiting("from reading_sessions");
            probe.commit();
            Stored late = committed.get(20, TimeUnit.SECONDS);
            assertThat(late.outcome()).isEqualTo(StoreOutcome.NOT_FOUND);
            assertThat(late.cleanupOperationIds()).singleElement()
                    .satisfies(operation -> assertThat(scheduledKeys(operation)).containsExactly("reading/b.m4a"));
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT object_key FROM reading_recordings", String.class)).containsExactly("reading/a.m4a");
    }

    @Test
    @DisplayName("요청 하나가 보내는 문장: 검사는 조회 넷, 새 녹음 저장은 회차 잠금·줄·요청 id·줄의 앞 녹음 잠금·총량·INSERT·다시 읽기 일곱이다. 대체는 UPDATE 와 장부 한 줄이 되고, 거절은 거기서 멈추고 장부에 올린다")
    void eachRequestSendsTheseStatements() {
        String sessionRead = "select reading_sessions";
        String sessionLock = "select reading_sessions for update";
        String read = "select reading_recordings";
        String lock = "select reading_recordings for update";
        String ledger = "insert account_cleanup_operations";
        UUID request = UUID.randomUUID();

        assertThat(statementsOf(() -> recordings.precheck(owner, session, mine, request, 1)))
                .containsExactly(sessionRead, sessionRead, read, read);
        assertThat(statementsOf(() -> recordings.store(owner, session, take(request, mine, 1, "reading/a.m4a", 10, null, "none"),
                QUOTA, now))).as("새 녹음")
                .containsExactly(sessionLock, sessionRead, read, lock, read, "insert reading_recordings", read);
        UUID id = jdbc.queryForObject("SELECT id FROM reading_recordings", UUID.class);
        assertThat(statementsOf(() -> recordings.store(owner, session, take(UUID.randomUUID(), mine, 2, "reading/b.m4a", 10, null, "none"),
                QUOTA, now))).as("대체")
                .containsExactly(sessionLock, sessionRead, read, lock, read, "update reading_recordings", read, ledger);
        assertThat(statementsOf(() -> recordings.store(owner, session, take(request, mine, 1, "reading/a.m4a", 10, null, "none"),
                QUOTA, now))).as("다른 키로 온 같은 줄의 늦은 시도")
                .containsExactly(sessionLock, sessionRead, read, lock, read, ledger);
        assertThat(statementsOf(() -> recordings.store(owner, session, take(UUID.randomUUID(), theirs, 1, "reading/c.m4a", 10, null, "none"),
                QUOTA, now))).as("내 대사 줄이 아니다").containsExactly(sessionLock, sessionRead, read, ledger);
        assertThat(statementsOf(() -> recordings.store(member(), session, take(UUID.randomUUID(), mine, 1, "reading/d.m4a", 10, null, "none"),
                QUOTA, now))).as("남의 회차").containsExactly(sessionLock, read, ledger);
        assertThat(statementsOf(() -> recordings.delete(owner, id, now))).containsExactly(lock, "delete reading_recordings", ledger);
        assertThat(statementsOf(() -> recordings.delete(owner, id, now))).containsExactly(lock);
    }

    /** 길이 1200ms 의 audio/mp4 녹음. */
    private static NewRecording take(UUID request, UUID line, int attemptNo, String objectKey, long byteSize, String transcript,
            String transcriptSource) {
        return new NewRecording(request, line, attemptNo, objectKey, "audio/mp4", byteSize, 1200, transcript, transcriptSource);
    }
}
