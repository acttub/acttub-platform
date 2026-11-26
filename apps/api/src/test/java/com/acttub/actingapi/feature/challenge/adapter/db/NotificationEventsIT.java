package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.challenge.domain.NotificationRules;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 알림 사건 한 행을 남기는 {@link NotificationEvents#record} 를 고정한다. 좋아요·댓글이 묶음이 되고 첫 푸시와 요약 푸시로
 * 나가는 흐름, 밤 시간, 발송 직전 확인은 {@code ChallengeNotificationIT} 가 HTTP 와 워커로 본다. 여기서는 한 행에 적히는 값,
 * 보낼 수 없는 수신자, 같은 원인의 재전송과 동시 기록, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class NotificationEventsIT {

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    NotificationEvents events;

    /** 한국 시간 낮 12시 3분 — 10분 구간은 12:00~12:10 이다. */
    private final Instant now = Instant.parse("2026-11-25T03:03:00Z");
    private UUID author;
    private UUID fan;
    private UUID challenge;
    private UUID entry;

    @BeforeEach
    void setUp() {
        db.reset();
        author = db.member("작성자");
        fan = db.member("팬");
        db.device(author, "ExponentPushToken[author]");
        challenge = db.challenge(now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
        entry = db.entry(challenge, author, now.minus(Duration.ofHours(1)));
    }

    @Test
    @DisplayName("자기 행동은 남기지 않고 문장도 보내지 않는다")
    void ownActionsLeaveNothing() {
        assertThat(db.statementsOf(() -> db.inTransaction(
                () -> events.record(author, "entry_liked", author, challenge, entry, null, "like:" + UUID.randomUUID(), now))))
                .isEmpty();
        assertThat(db.count("notifications")).isZero();
    }

    @Test
    @DisplayName("묶음의 첫 사건은 바로, 뒤따르는 사건은 10분 구간 끝에 보낸다. 적는 값: 종류·행동자·대상·원인·묶음·만든 시각·90일 뒤 만료·pending")
    void theFirstEventGoesNowAndLaterOnesAtTheEndOfTheWindow() {
        UUID secondFan = db.member("둘째 팬");
        String group = NotificationRules.groupKey(author, "entry_liked", entry, now);

        record(author, "entry_liked", fan, entry, null, "like:1", now);
        record(author, "entry_liked", secondFan, entry, null, "like:2", now.plusSeconds(60));

        assertThat(row(author, "like:1"))
                .containsEntry("kind", "entry_liked").containsEntry("actor_user_id", fan)
                .containsEntry("challenge_id", challenge).containsEntry("entry_id", entry).containsEntry("comment_id", null)
                .containsEntry("group_key", group).containsEntry("push_status", "pending")
                .containsEntry("read_at", null).containsEntry("push_attempted_at", null);
        assertThat(at(author, "like:1", "created_at")).isEqualTo(now);
        assertThat(at(author, "like:1", "expires_at")).isEqualTo(now.plus(Duration.ofDays(90)));
        assertThat(at(author, "like:1", "push_after")).as("첫 사건은 바로").isEqualTo(now);
        assertThat(row(author, "like:2")).containsEntry("group_key", group).containsEntry("actor_user_id", secondFan);
        assertThat(at(author, "like:2", "push_after")).as("뒤따르는 사건은 구간 끝")
                .isEqualTo(Instant.parse("2026-11-25T03:10:00Z"));
    }

    @Test
    @DisplayName("첫 사건인지는 수신자·묶음마다 따로 본다 — 다음 10분 구간, 다른 종류, 다른 수신자는 다시 첫 사건이다")
    void firstIsJudgedPerRecipientAndGroup() {
        UUID comment = comment(entry, fan, now);
        UUID otherAuthor = db.member("다른 작성자");
        db.device(otherAuthor, "ExponentPushToken[other]");
        UUID otherEntry = db.entry(challenge, otherAuthor, now.minus(Duration.ofHours(1)));
        Instant nextWindow = now.plus(Duration.ofMinutes(10));

        record(author, "entry_liked", fan, entry, null, "like:1", now);
        record(author, "entry_liked", fan, entry, null, "like:next-window", nextWindow);
        record(author, "entry_commented", fan, entry, comment, "comment:" + comment, now.plusSeconds(1));
        record(otherAuthor, "entry_liked", fan, otherEntry, null, "like:1", now.plusSeconds(2));

        assertThat(at(author, "like:next-window", "push_after")).isEqualTo(nextWindow);
        assertThat(at(author, "comment:" + comment, "push_after")).isEqualTo(now.plusSeconds(1));
        assertThat(row(author, "comment:" + comment)).containsEntry("comment_id", comment)
                .containsEntry("group_key", NotificationRules.groupKey(author, "entry_commented", entry, now));
        assertThat(at(otherAuthor, "like:1", "push_after")).as("원인 키는 수신자마다 따로다").isEqualTo(now.plusSeconds(2));
        assertThat(db.count("notifications")).isEqualTo(4);
    }

    @Test
    @DisplayName("보낼 수 없는 수신자(기기 없음·챌린지 알림 끔·프로필 없음)는 알림함에만 쌓는다 — 보낼 시각이 없고 skipped 다")
    void undeliverableRecipientsOnlyGetAnInboxRow() {
        UUID noDevice = db.member("기기 없음");
        UUID muted = db.member("알림 끔");
        db.device(muted, "ExponentPushToken[muted]");
        db.jdbc.update("UPDATE user_profiles SET notify_challenge=false WHERE user_id=?", muted);
        UUID noProfile = UUID.randomUUID();
        db.jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", noProfile);
        db.device(noProfile, "ExponentPushToken[no-profile]");

        for (UUID recipient : new UUID[] {noDevice, muted, noProfile}) {
            UUID theirs = db.entry(challenge, recipient, now.minus(Duration.ofHours(1)));
            record(recipient, "entry_liked", fan, theirs, null, "like:1", now);

            assertThat(row(recipient, "like:1")).containsEntry("push_status", "skipped").containsEntry("push_after", null);
            assertThat(at(recipient, "like:1", "created_at")).isEqualTo(now);
        }
    }

    @Test
    @DisplayName("밤(한국 시간 21시~09시)의 사건은 다음 09시에 보낸다")
    void nightEventsWaitForNine() {
        Instant night = Instant.parse("2026-11-25T14:00:00Z");

        record(author, "entry_liked", fan, entry, null, "like:night", night);

        assertThat(at(author, "like:night", "push_after")).isEqualTo(Instant.parse("2026-11-26T00:00:00Z"));
        assertThat(at(author, "like:night", "created_at")).isEqualTo(night);
    }

    @Test
    @DisplayName("행동자·참여작이 없는 사건(챌린지 종료)은 그 칸이 NULL 이고 챌린지로 묶는다. AI 리포트 완료는 행동자 없이 참여작으로 묶는다")
    void eventsWithoutAnActorOrEntry() {
        record(author, "challenge_ended", null, null, null, "ended:" + challenge, now);
        record(author, "entry_ai_report_ready", null, entry, null, "ai_report:1", now);

        assertThat(row(author, "ended:" + challenge))
                .containsEntry("actor_user_id", null).containsEntry("entry_id", null).containsEntry("comment_id", null)
                .containsEntry("challenge_id", challenge)
                .containsEntry("group_key", NotificationRules.groupKey(author, "challenge_ended", challenge, now));
        assertThat(row(author, "ai_report:1"))
                .containsEntry("actor_user_id", null).containsEntry("entry_id", entry)
                .containsEntry("group_key", NotificationRules.groupKey(author, "entry_ai_report_ready", entry, now));
    }

    @Test
    @DisplayName("같은 원인(수신자·event_key)의 재전송은 한 행이고 처음 적은 값이 남는다")
    void theSameCauseIsRecordedOnce() {
        record(author, "entry_liked", fan, entry, null, "like:1", now);
        UUID id = db.jdbc.queryForObject("SELECT id FROM notifications", UUID.class);

        record(author, "entry_liked", fan, entry, null, "like:1", now.plusSeconds(120));

        assertThat(db.jdbc.queryForList("SELECT id FROM notifications", UUID.class)).containsExactly(id);
        assertThat(at(author, "like:1", "created_at")).isEqualTo(now);
        assertThat(at(author, "like:1", "push_after")).isEqualTo(now);
    }

    @Test
    @DisplayName("시각은 마이크로초로 반올림해 적는다")
    void timesAreRoundedToMicroseconds() {
        Instant precise = now.plusNanos(123_456_789);

        record(author, "entry_liked", fan, entry, null, "like:precise", precise);

        Instant rounded = now.plusNanos(123_457_000);
        assertThat(at(author, "like:precise", "created_at")).isEqualTo(rounded);
        assertThat(at(author, "like:precise", "push_after")).isEqualTo(rounded);
        assertThat(at(author, "like:precise", "expires_at")).isEqualTo(rounded.plus(Duration.ofDays(90)));
    }

    @Test
    @DisplayName("같은 원인을 두 트랜잭션이 함께 적으면 뒤의 것이 앞의 커밋을 기다렸다가 적지 않는다(예외 없음). 앞의 것이 되돌리면 뒤의 것이 적는다")
    void twoTransactionsRecordingTheSameCause() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (boolean firstCommits : new boolean[] {true, false}) {
                String key = "like:race-" + firstCommits;
                CountDownLatch recorded = new CountDownLatch(1);
                CountDownLatch release = new CountDownLatch(1);
                Future<?> first = pool.submit(() -> db.inTransaction(() -> {
                    events.record(author, "entry_liked", fan, challenge, entry, null, key, now);
                    recorded.countDown();
                    ChallengeStoreFixture.await(release);
                    if (!firstCommits) {
                        throw new IllegalStateException("되돌린다");
                    }
                }));
                ChallengeStoreFixture.await(recorded);
                Future<?> second = pool.submit(() -> db.inTransaction(
                        () -> events.record(author, "entry_liked", fan, challenge, entry, null, key, now.plusSeconds(30))));
                assertThat(db.awaitWaiting("insert into notifications").toLowerCase()).contains("on conflict");
                release.countDown();

                if (firstCommits) {
                    first.get(20, TimeUnit.SECONDS);
                } else {
                    assertThat(first).failsWithin(20, TimeUnit.SECONDS).withThrowableThat().withMessageContaining("되돌린다");
                }
                second.get(20, TimeUnit.SECONDS);
                assertThat(db.jdbc.queryForObject("SELECT count(*) FROM notifications WHERE event_key=?", Integer.class, key))
                        .isEqualTo(1);
                assertThat(at(author, key, "created_at")).isEqualTo(firstCommits ? now : now.plusSeconds(30));
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("나가는 문장: 묶음에 앞선 사건이 있는지, 보낼 수 있는 수신자인지, 그리고 넣기 하나")
    void statements() {
        assertThat(db.statementsOf(() -> db.inTransaction(
                () -> events.record(author, "entry_liked", fan, challenge, entry, null, "like:1", now))))
                .containsExactly("select notifications", "select user_profiles", "insert notifications on conflict");
        assertThat(db.statementsOf(() -> db.inTransaction(
                () -> events.record(author, "entry_liked", fan, challenge, entry, null, "like:1", now))))
                .as("재전송도 같은 세 문장이다")
                .containsExactly("select notifications", "select user_profiles", "insert notifications on conflict");
    }

    private void record(UUID recipient, String kind, UUID actor, UUID entryId, UUID commentId, String eventKey, Instant at) {
        db.inTransaction(() -> events.record(recipient, kind, actor, challenge, entryId, commentId, eventKey, at));
    }

    private Map<String, Object> row(UUID recipient, String eventKey) {
        return db.jdbc.queryForMap("""
                SELECT kind,actor_user_id,challenge_id,entry_id,comment_id,group_key,push_status,push_after,read_at,push_attempted_at
                FROM notifications WHERE user_id=? AND event_key=?
                """, recipient, eventKey);
    }

    private Instant at(UUID recipient, String eventKey, String column) {
        return db.instant("SELECT " + column + " FROM notifications WHERE user_id=? AND event_key=?", recipient, eventKey);
    }

    private UUID comment(UUID entryId, UUID by, Instant at) {
        UUID id = UUID.randomUUID();
        db.jdbc.update("""
                INSERT INTO entry_comments(id,entry_id,user_id,body,request_id,request_fingerprint,created_at)
                VALUES (?,?,?,'댓글',?,?,?)
                """, id, entryId, by, UUID.randomUUID(), "0".repeat(64), ChallengeStoreFixture.utc(at));
        return id;
    }
}
