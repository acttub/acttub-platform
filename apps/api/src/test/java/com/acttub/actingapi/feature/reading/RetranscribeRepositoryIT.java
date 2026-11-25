package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.RetranscribeRepository;
import com.acttub.actingapi.feature.reading.app.RetranscribeRepository.Claimed;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 리딩 녹음 서버 다시 받아쓰기 큐가 내는 결과·선점·경합·문장을 고정한다. 줄 세우기에서 받아쓰기까지의 흐름과 하루 한도,
 * 탈퇴 뒤의 녹음은 {@link ReadingRetranscribeIT} 가 본다. 여기서는 그 테스트가 밟지 않는 집는 순서, 다른 워커가 잡은 행
 * 건너뛰기, 두 워커가 함께 집을 때, 임대가 끝난 행을 다시 집거나 닫는 경계, 다시 줄 세울 때 비우는 칸, 임대 없이 온 완료·실패·
 * 미루기, 대조할 원문을 고르는 규칙(구간·내 배역·함께 말하는 줄), 시각의 정밀도, 나가는 문장을 본다.
 *
 * <p>저장소를 네이티브 SQL 에서 JPA 로 옮길 때 문장 테스트 한 곳만 달라졌다 — 집는 문장
 * ({@code UPDATE … WHERE recording_id=(SELECT … FOR UPDATE SKIP LOCKED) RETURNING})을 잠가 읽기와 임대 적기로 나눠 집을 것이
 * 있을 때 문장이 하나 늘었다. 결과·선점·경합 테스트는 고치지 않았다.
 */
class RetranscribeRepositoryIT extends ReadingRepositoryFixture {

    private static final Duration LEASE = Duration.ofMinutes(5);

    @Autowired
    RetranscribeRepository queue;

    private UUID owner;
    private UUID script;
    private UUID nina;
    private UUID kostya;
    private UUID mine;
    private UUID theirs;
    private UUID session;

    @BeforeEach
    void setUp() {
        owner = member();
        script = script(owner);
        nina = character(script, "니나", 0);
        kostya = character(script, "코스챠", 1);
        mine = line(script, 1, "dialogue", nina, "안녕하세요");
        theirs = line(script, 2, "dialogue", kostya, "왔구나");
        session = session(owner, script, mine, theirs, nina);
    }

    @Test
    @DisplayName("enqueue: queued 행을 만들고, 같은 녹음을 다시 줄 세우면 새 객체 키로 처음부터다 — 시도·임대·소리 크기·받아쓴 글·실패를 비우고 만든 시각과 모델을 부른 시각은 그대로 둔다")
    void enqueueCreatesOrResetsTheRow() {
        UUID recording = recording("reading/a.m4a", mine);

        queue.enqueue(recording, "reading/a.m4a", now.plusNanos(123_456_789));
        assertThat(row(recording)).containsEntry("object_key", "reading/a.m4a").containsEntry("status", "queued")
                .containsEntry("attempt_count", 0).containsEntry("lease_token", null).containsEntry("transcript", null);
        Instant created = now.plus(123_457, ChronoUnit.MICROS);
        assertThat(instant("SELECT created_at FROM reading_recording_retranscripts")).isEqualTo(created);
        assertThat(instant("SELECT updated_at FROM reading_recording_retranscripts")).isEqualTo(created);

        jdbc.update("""
                UPDATE reading_recording_retranscripts
                SET status='failed', attempt_count=2, lease_token=gen_random_uuid(), lease_until=now(), peak_db=-12.5,
                    transcript='옛 글', failure='boom', transcribed_at=?
                """, utc(now.plusSeconds(30)));
        queue.enqueue(recording, "reading/b.m4a", now.plusSeconds(60));

        assertThat(row(recording)).containsEntry("object_key", "reading/b.m4a").containsEntry("status", "queued")
                .containsEntry("attempt_count", 0).containsEntry("lease_token", null).containsEntry("lease_until", null)
                .containsEntry("peak_db", null).containsEntry("transcript", null).containsEntry("failure", null);
        assertThat(instant("SELECT created_at FROM reading_recording_retranscripts")).isEqualTo(created);
        assertThat(instant("SELECT updated_at FROM reading_recording_retranscripts")).isEqualTo(now.plusSeconds(60));
        assertThat(instant("SELECT transcribed_at FROM reading_recording_retranscripts")).isEqualTo(now.plusSeconds(30));
        assertThat(count("reading_recording_retranscripts")).isEqualTo(1);
    }

    @Test
    @DisplayName("claimNext: 먼저 줄 세운 것을 running 으로 집고 임대와 시도 수를 적는다. 녹음 길이와, 그 녹음이 아직 줄 세운 그 녹음이고 기기 전사가 비어 있는지를 함께 낸다. 없으면 null 이다")
    void claimNextTakesTheOldestAndReportsWhetherItIsCurrent() {
        UUID later = enqueued("reading/later.m4a", mine, now.plusSeconds(10));
        UUID otherSession = session(owner, script, mine, theirs, nina);
        UUID earlier = recording(owner, otherSession, mine, 1, "reading/earlier.m4a");
        jdbc.update("UPDATE reading_recordings SET transcript_source='stt', transcript='기기가 받아쓴 글' WHERE id=?", earlier);
        queue.enqueue(earlier, "reading/earlier.m4a", now);
        UUID token = UUID.randomUUID();

        Claimed first = queue.claimNext(token, LEASE, 3, now.plusSeconds(60).plusNanos(1_500));

        assertThat(first).as("기기 전사가 이미 있다").isEqualTo(new Claimed(earlier, "reading/earlier.m4a", 1200, 1, false));
        Instant stamp = now.plusSeconds(60).plus(2, ChronoUnit.MICROS);
        assertThat(row(earlier)).containsEntry("status", "running").containsEntry("lease_token", token)
                .containsEntry("attempt_count", 1);
        assertThat(instant("SELECT lease_until FROM reading_recording_retranscripts WHERE recording_id=?", earlier))
                .isEqualTo(stamp.plus(LEASE));
        assertThat(instant("SELECT updated_at FROM reading_recording_retranscripts WHERE recording_id=?", earlier)).isEqualTo(stamp);

        assertThat(queue.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(61)))
                .isEqualTo(new Claimed(later, "reading/later.m4a", 1200, 1, true));
        assertThat(queue.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(62))).isNull();
    }

    @Test
    @DisplayName("claimNext: 줄 세운 뒤 녹음이 다른 객체로 바뀌었거나 주인이 활성이 아니면 current 가 false 다")
    void claimNextSeesAReplacedRecordingOrAClosedAccount() {
        UUID replaced = enqueued("reading/old.m4a", mine, now);
        jdbc.update("UPDATE reading_recordings SET object_key='reading/new.m4a' WHERE id=?", replaced);
        assertThat(queue.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(1)).current()).isFalse();

        UUID closedOwners = enqueued("reading/closed.m4a", theirs, now.plusSeconds(2));
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", owner);
        assertThat(queue.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(3)))
                .isEqualTo(new Claimed(closedOwners, "reading/closed.m4a", 1200, 1, false));
    }

    @Test
    @DisplayName("claimNext: 임대가 끝난 running 은 시도가 남았으면 다시 집고(시도 +1, 새 임대), 다 썼으면 failed·lease_expired 로 닫는다. 임대가 끝나는 바로 그 시각에는 아직 집지 않는다")
    void claimNextReclaimsOrClosesExpiredLeases() {
        UUID recording = enqueued("reading/a.m4a", mine, now);
        queue.claimNext(UUID.randomUUID(), LEASE, 2, now);
        Instant leaseEnd = now.plus(LEASE);

        assertThat(queue.claimNext(UUID.randomUUID(), LEASE, 2, leaseEnd)).as("임대가 끝나는 시각").isNull();
        UUID second = UUID.randomUUID();
        assertThat(queue.claimNext(second, LEASE, 2, leaseEnd.plusSeconds(1)).attempt()).isEqualTo(2);
        assertThat(row(recording)).containsEntry("lease_token", second);

        Instant afterSecond = leaseEnd.plusSeconds(1).plus(LEASE).plusSeconds(1);
        assertThat(queue.claimNext(UUID.randomUUID(), LEASE, 2, afterSecond)).as("시도를 다 썼다").isNull();
        assertThat(row(recording)).containsEntry("status", "failed").containsEntry("failure", "lease_expired")
                .containsEntry("lease_token", null).containsEntry("lease_until", null).containsEntry("attempt_count", 2);
        assertThat(instant("SELECT updated_at FROM reading_recording_retranscripts")).isEqualTo(afterSecond);
    }

    @Test
    @DisplayName("claimNext 는 다른 연결이 잡고 있는 행을 기다리지 않고 건너뛴다(SKIP LOCKED) — 그다음 것을 집고, 남은 것이 그 행뿐이면 null 이다")
    void claimNextSkipsARowLockedByAnotherWorker() throws Exception {
        UUID locked = enqueued("reading/locked.m4a", mine, now);
        UUID next = enqueued("reading/next.m4a", theirs, now.plusSeconds(10));
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM reading_recording_retranscripts WHERE recording_id=? FOR UPDATE", locked);

            assertThat(queue.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(60)).recordingId()).isEqualTo(next);
            assertThat(queue.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(61))).isNull();
            assertNothingWaits();
            probe.rollback();
        }
        assertThat(queue.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(62)).recordingId()).isEqualTo(locked);
    }

    @Test
    @DisplayName("두 워커가 함께 집으면 서로 다른 행을 집는다. 한 워커가 집은 행은 그 트랜잭션이 끝날 때까지 잠겨 있어 다른 워커가 건너뛴다")
    void twoWorkersClaimDifferentRecordings() throws Exception {
        UUID first = enqueued("reading/first.m4a", mine, now);
        UUID second = enqueued("reading/second.m4a", theirs, now.plusSeconds(10));
        CountDownLatch claimed = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<Claimed> holder = pool.submit(() -> inTransaction(() -> {
                Claimed taken = queue.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(60));
                claimed.countDown();
                await(release);
                return taken;
            }));
            await(claimed);
            Claimed other = queue.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(60));
            Claimed none = queue.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(60));
            release.countDown();

            assertThat(holder.get(20, TimeUnit.SECONDS).recordingId()).isEqualTo(first);
            assertThat(other.recordingId()).isEqualTo(second);
            assertThat(none).isNull();
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT attempt_count FROM reading_recording_retranscripts", Integer.class)).containsExactly(1, 1);
    }

    @Test
    @DisplayName("markTranscribing·transcribedSince: 임대를 쥔 워커만 모델을 부른 시각을 남기고, 그 시각부터(같은 시각 포함) 부른 횟수를 센다")
    void markTranscribingCountsTowardTheDailyLimit() {
        UUID recording = enqueued("reading/a.m4a", mine, now);
        UUID token = UUID.randomUUID();
        queue.claimNext(token, LEASE, 3, now);

        queue.markTranscribing(recording, UUID.randomUUID(), now.plusSeconds(5));
        assertThat(queue.transcribedSince(now.minusSeconds(3600))).isZero();

        queue.markTranscribing(recording, token, now.plusSeconds(5));
        assertThat(instant("SELECT transcribed_at FROM reading_recording_retranscripts")).isEqualTo(now.plusSeconds(5));
        assertThat(instant("SELECT updated_at FROM reading_recording_retranscripts")).isEqualTo(now.plusSeconds(5));
        assertThat(queue.transcribedSince(now.plusSeconds(5))).isEqualTo(1);
        assertThat(queue.transcribedSince(now.plusSeconds(5).plusNanos(1_000))).isZero();
    }

    @Test
    @DisplayName("fill: 내 대사 줄의 녹음이면 받아쓴 글과 원문 대조를 녹음에 채우고 done 으로 닫는다. 구간 안 내 배역의 줄이 아니면 글만 채우고 대조는 비운다. 함께 말하는 줄은 내 배역이 든 묶음이면 대조한다")
    void fillWritesTheTranscriptAndTheMatch() {
        UUID chorus = character(script, "니나·코스챠", 2);
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("UPDATE script_characters SET member_ids=? WHERE id=?");
            statement.setArray(1, connection.createArrayOf("uuid", new UUID[] {nina, kostya}));
            statement.setObject(2, chorus);
            return statement;
        });
        UUID together = line(script, 3, "dialogue", chorus, "함께 말해요");
        jdbc.update("UPDATE reading_sessions SET end_line_id=? WHERE id=?", together, session);
        UUID outside = line(script, 4, "dialogue", nina, "구간 밖");

        assertThat(fill(mine, "reading/mine.m4a", "안녕하세요", -20.5)).isTrue();
        assertThat(recordingRow("reading/mine.m4a")).containsEntry("transcript", "안녕하세요").containsEntry("matched", true);
        assertThat(jdbc.queryForMap("SELECT status,transcript,peak_db,failure,lease_token,lease_until "
                + "FROM reading_recording_retranscripts WHERE object_key='reading/mine.m4a'"))
                .containsEntry("status", "done").containsEntry("transcript", "안녕하세요").containsEntry("peak_db", -20.5)
                .containsEntry("failure", null).containsEntry("lease_token", null).containsEntry("lease_until", null);

        assertThat(fill(theirs, "reading/theirs.m4a", "왔구나", null)).isTrue();
        assertThat(recordingRow("reading/theirs.m4a")).as("상대역의 줄").containsEntry("transcript", "왔구나")
                .containsEntry("matched", null);
        assertThat(fill(together, "reading/together.m4a", "전혀 다른 말", null)).isTrue();
        assertThat(recordingRow("reading/together.m4a")).as("내 배역이 든 함께 말하는 줄").containsEntry("matched", false);
        assertThat(fill(outside, "reading/outside.m4a", "구간 밖", null)).isTrue();
        assertThat(recordingRow("reading/outside.m4a")).as("구간 밖의 줄").containsEntry("matched", null);
    }

    @Test
    @DisplayName("fill: 녹음이 바뀌었거나 이미 전사가 있거나 주인이 활성이 아니면 녹음을 건드리지 않고 stale 로 닫는다. 임대를 잃었으면 녹음을 고친 것까지 되돌리고 false 다")
    void fillLeavesAStaleRecordingAloneAndNeedsTheLease() {
        UUID replaced = enqueued("reading/old.m4a", mine, now);
        UUID token = UUID.randomUUID();
        queue.claimNext(token, LEASE, 3, now);
        jdbc.update("UPDATE reading_recordings SET object_key='reading/new.m4a' WHERE id=?", replaced);

        assertThat(queue.fill(replaced, token, "reading/old.m4a", "받아쓴 글", -3.0, now.plusSeconds(9))).isFalse();
        assertThat(row(replaced)).containsEntry("status", "stale").containsEntry("transcript", "받아쓴 글")
                .containsEntry("lease_token", null);
        assertThat(recordingRow("reading/new.m4a")).containsEntry("transcript", null);
        assertThat(instant("SELECT updated_at FROM reading_recording_retranscripts WHERE recording_id=?", replaced))
                .isEqualTo(now.plusSeconds(9));

        UUID lost = enqueued("reading/lost.m4a", theirs, now.plusSeconds(10));
        queue.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(11));
        assertThat(queue.fill(lost, UUID.randomUUID(), "reading/lost.m4a", "받아쓴 글", null, now.plusSeconds(12))).isFalse();
        assertThat(recordingRow("reading/lost.m4a")).as("임대 없이 온 완료는 녹음을 고치지 않는다").containsEntry("transcript", null);
        assertThat(row(lost)).containsEntry("status", "running");
    }

    @Test
    @DisplayName("finish·fail·release: 임대를 쥔 워커만 닫는다 — finish 는 넘긴 상태와 소리 크기, fail 은 queued 나 failed 와 이유, release 는 queued 로 돌리고 시도 수를 하나 되돌린다(0 아래로 가지 않는다)")
    void finishFailAndReleaseNeedTheLease() {
        UUID finished = enqueued("reading/finished.m4a", mine, now);
        UUID token = UUID.randomUUID();
        queue.claimNext(token, LEASE, 3, now);
        queue.finish(finished, UUID.randomUUID(), "silent", -60.0, now.plusSeconds(1));
        assertThat(row(finished)).containsEntry("status", "running");
        queue.finish(finished, token, "silent", -60.0, now.plusSeconds(1));
        assertThat(row(finished)).containsEntry("status", "silent").containsEntry("peak_db", -60.0).containsEntry("failure", null)
                .containsEntry("lease_token", null).containsEntry("lease_until", null);

        UUID failing = enqueued("reading/failing.m4a", theirs, now.plusSeconds(2));
        UUID retry = UUID.randomUUID();
        queue.claimNext(retry, LEASE, 3, now.plusSeconds(3));
        queue.fail(failing, retry, "model_down", true, now.plusSeconds(4));
        assertThat(row(failing)).containsEntry("status", "queued").containsEntry("failure", "model_down")
                .containsEntry("attempt_count", 1).containsEntry("lease_token", null);
        UUID last = UUID.randomUUID();
        queue.claimNext(last, LEASE, 3, now.plusSeconds(5));
        queue.release(failing, UUID.randomUUID(), now.plusSeconds(6));
        assertThat(row(failing)).as("임대 없이 온 미루기").containsEntry("status", "running").containsEntry("attempt_count", 2);
        queue.release(failing, last, now.plusSeconds(6));
        assertThat(row(failing)).containsEntry("status", "queued").containsEntry("attempt_count", 1)
                .containsEntry("lease_token", null).containsEntry("lease_until", null);
        assertThat(instant("SELECT updated_at FROM reading_recording_retranscripts WHERE recording_id=?", failing))
                .isEqualTo(now.plusSeconds(6));

        jdbc.update("UPDATE reading_recording_retranscripts SET status='running', attempt_count=0, lease_token=? WHERE recording_id=?",
                last, failing);
        queue.release(failing, last, now.plusSeconds(7));
        assertThat(row(failing)).as("0 아래로 가지 않는다").containsEntry("attempt_count", 0);

        UUID closing = UUID.randomUUID();
        queue.claimNext(closing, LEASE, 3, now.plusSeconds(8));
        queue.fail(failing, closing, "bad_audio", false, now.plusSeconds(9));
        assertThat(row(failing)).containsEntry("status", "failed").containsEntry("failure", "bad_audio");
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장: 줄 세우기는 upsert 하나, 집기는 시한 지난 것 닫기·SKIP LOCKED 로 잠가 읽기·임대 적기·녹음 읽기다. 집을 것이 없으면 잠가 읽기에서 멈춘다. 채우기는 원문 읽기·녹음 고치기·큐 닫기이고 그 밖의 닫기와 세기는 한 문장이다")
    void eachPortMethodSendsTheseStatements() {
        UUID recording = recording("reading/a.m4a", mine);
        String update = "update reading_recording_retranscripts";
        UUID token = UUID.randomUUID();

        assertThat(statementsOf(() -> queue.enqueue(recording, "reading/a.m4a", now)))
                .containsExactly("insert reading_recording_retranscripts on conflict");
        String lockNext = "select reading_recording_retranscripts for update skip locked";
        assertThat(statementsOf(() -> queue.claimNext(token, LEASE, 3, now))).as("잠가 읽은 행에 임대를 적는다")
                .containsExactly(update, lockNext, update, "select reading_recordings");
        assertThat(statementsOf(() -> queue.claimNext(UUID.randomUUID(), LEASE, 3, now))).as("집을 것이 없을 때")
                .containsExactly(update, lockNext);
        assertThat(statementsOf(() -> queue.transcribedSince(now))).containsExactly("count reading_recording_retranscripts");
        assertThat(statementsOf(() -> queue.markTranscribing(recording, token, now))).containsExactly(update);
        assertThat(statementsOf(() -> queue.fill(recording, token, "reading/a.m4a", "안녕하세요", null, now)))
                .containsExactly("select reading_recordings", "update reading_recordings", update);
        assertThat(statementsOf(() -> queue.finish(recording, token, "silent", null, now))).containsExactly(update);
        assertThat(statementsOf(() -> queue.fail(recording, token, "x", true, now))).containsExactly(update);
        assertThat(statementsOf(() -> queue.release(recording, token, now))).containsExactly(update);
    }

    /** 기기 전사가 빈 stt 녹음. */
    private UUID recording(String objectKey, UUID line) {
        UUID recording = recording(owner, session, line, 1, objectKey);
        jdbc.update("UPDATE reading_recordings SET transcript_source='stt', transcript=NULL WHERE id=?", recording);
        return recording;
    }

    private UUID enqueued(String objectKey, UUID line, Instant at) {
        UUID recording = recording(objectKey, line);
        queue.enqueue(recording, objectKey, at);
        return recording;
    }

    /** 줄 세우고 집은 뒤 채운다. */
    private boolean fill(UUID line, String objectKey, String transcript, Double peakDb) {
        UUID recording = enqueued(objectKey, line, now);
        UUID token = UUID.randomUUID();
        Claimed claimed = queue.claimNext(token, LEASE, 3, now.plusSeconds(1));
        assertThat(claimed.recordingId()).isEqualTo(recording);
        return queue.fill(recording, token, objectKey, transcript, peakDb, now.plusSeconds(2));
    }

    private java.util.Map<String, Object> row(UUID recording) {
        return jdbc.queryForMap("SELECT * FROM reading_recording_retranscripts WHERE recording_id=?", recording);
    }

    private java.util.Map<String, Object> recordingRow(String objectKey) {
        return jdbc.queryForMap("SELECT transcript,matched FROM reading_recordings WHERE object_key=?", objectKey);
    }
}
