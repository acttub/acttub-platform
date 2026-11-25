package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.challenge.app.NotificationRepository;
import com.acttub.actingapi.feature.challenge.app.NotificationRepository.Outgoing;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 알림함의 읽음 처리·안 읽은 수와 푸시 발송 선점({@code NotificationRepository})을 고정한다. 좋아요·댓글에서 알림함과 푸시까지의
 * 흐름, 묶음의 인원·수, 밤 시간, 하루 조회 요약은 {@code ChallengeNotificationIT} 가 HTTP 와 워커로 본다. 여기서는 읽음 처리의
 * 경계, 안 읽은 수가 세는 사건, 발송이 행에 적는 값과 묶음마다 첫·요약 한 번씩인 것, 두 발송이 겹칠 때, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class NotificationStoreIT {

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    NotificationRepository notifications;

    /** 한국 시간 낮 12시. */
    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private UUID me;
    private UUID fan;
    private UUID challenge;
    private UUID entry;

    @BeforeEach
    void setUp() {
        db.reset();
        me = db.member("나");
        fan = db.member("팬");
        db.device(me, "ExponentPushToken[me]");
        challenge = db.challenge(now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
        entry = db.entry(challenge, me, now.minus(Duration.ofHours(3)));
    }

    // ---- 읽음 처리 ----

    @Test
    @DisplayName("read(묶음): 그 회원의 그 묶음에서 지금까지 온 안 읽은 사건만 읽음으로 바꾼다. 이미 읽은 것의 시각, 다른 묶음, 남의 것, 지금 뒤에 온 것은 그대로다")
    void readMarksTheGivenGroupsUpToNow() {
        UUID first = likeEvent(me, "g1", now.minusSeconds(60));
        UUID alreadyRead = likeEvent(me, "g1", now.minusSeconds(50));
        db.jdbc.update("UPDATE notifications SET read_at=? WHERE id=?", ChallengeStoreFixture.utc(now.minusSeconds(40)), alreadyRead);
        UUID atNow = likeEvent(me, "g1", now);
        UUID later = likeEvent(me, "g1", now.plusNanos(1_000));
        UUID otherGroup = likeEvent(me, "g2", now.minusSeconds(60));
        UUID secondGroup = likeEvent(me, "g3", now.minusSeconds(60));
        UUID stranger = db.member("남");
        UUID theirs = likeEvent(stranger, "g1", now.minusSeconds(60));
        Instant precise = now.plusNanos(123_456_789);

        notifications.read(me, List.of("g1", "g3"), null, null, precise);

        Instant rounded = now.plusNanos(123_457_000);
        assertThat(readAt(first)).isEqualTo(rounded);
        assertThat(readAt(atNow)).isEqualTo(rounded);
        assertThat(readAt(later)).as("읽은 시각까지 온 것").isEqualTo(rounded);
        assertThat(readAt(secondGroup)).isEqualTo(rounded);
        assertThat(readAt(alreadyRead)).isEqualTo(now.minusSeconds(40));
        assertThat(readAt(otherGroup)).isNull();
        assertThat(readAt(theirs)).isNull();

        UUID afterRead = likeEvent(me, "g1", now.plusSeconds(1));
        notifications.read(me, List.of("g1"), null, null, now);
        assertThat(readAt(afterRead)).as("지금 뒤에 온 것은 읽지 않는다").isNull();
        notifications.read(me, List.of(), null, null, now.plusSeconds(5));
        notifications.read(me, null, null, null, now.plusSeconds(5));
        assertThat(readAt(afterRead)).as("묶음도 시각도 없으면 아무것도 하지 않는다").isNull();
    }

    @Test
    @DisplayName("read(시각까지): 그 시각까지(같은 시각 포함) 온 안 읽은 사건을 읽음으로 바꾼다. id 를 함께 주면 (시각, id) 순서로 그 사건까지다")
    void readMarksEverythingUpToATimeOrAnEvent() {
        Instant at = now.minusSeconds(30);
        UUID older = likeEvent(me, "g1", now.minusSeconds(60));
        UUID sameTimeSmaller = likeEvent(id(1), me, "g2", at);
        UUID sameTimeLarger = likeEvent(id(2), me, "g3", at);
        UUID newer = likeEvent(me, "g4", at.plusNanos(1_000));

        notifications.read(me, null, at, id(1), now);
        assertThat(readAt(older)).isEqualTo(now);
        assertThat(readAt(sameTimeSmaller)).isEqualTo(now);
        assertThat(readAt(sameTimeLarger)).as("같은 시각이면 id 가 큰 것은 그 뒤다").isNull();
        assertThat(readAt(newer)).isNull();

        notifications.read(me, null, at, null, now.plusSeconds(1));
        assertThat(readAt(sameTimeLarger)).as("id 없이면 같은 시각을 모두 포함한다").isEqualTo(now.plusSeconds(1));
        assertThat(readAt(sameTimeSmaller)).isEqualTo(now);
        assertThat(readAt(newer)).isNull();

        notifications.read(me, List.of("g4"), at, null, now.plusSeconds(2));
        assertThat(readAt(newer)).as("묶음과 시각을 함께 주면 둘 다 한다").isEqualTo(now.plusSeconds(2));
    }

    // ---- 안 읽은 수 ----

    @Test
    @DisplayName("unread: 안 읽었고 만료 전이며 지금도 유효한 사건이 있는 묶음의 수. 취소한 좋아요, 지우거나 숨긴 댓글, 차단(어느 쪽이든)의 사건은 세지 않는다")
    void unreadCountsGroupsWithAValidUnreadEvent() {
        assertThat(notifications.unread(me, now)).isZero();
        likeEvent(me, "liked", now.minusSeconds(60));
        likeEvent(me, "liked", now.minusSeconds(50));
        UUID visibleComment = comment(entry, fan, "보이는 댓글");
        event(me, "entry_commented", fan, entry, visibleComment, "comment:" + visibleComment, "commented", now.minusSeconds(40));
        event(me, "challenge_ended", null, null, null, "ended:" + challenge, "ended", now.minusSeconds(30));
        event(me, "entry_ai_report_ready", null, entry, null, "ai_report:1", "report", now.minusSeconds(20));
        likeEvent(db.member("남"), "theirs", now.minusSeconds(60));
        assertThat(notifications.unread(me, now)).isEqualTo(4);

        UUID cancelled = like(entry, db.member("취소한 팬"));
        event(me, "entry_liked", fan, entry, null, "like:" + cancelled, "cancelled", now.minusSeconds(10));
        db.jdbc.update("DELETE FROM entry_likes WHERE id=?", cancelled);
        UUID deletedComment = comment(entry, fan, "지운 댓글");
        event(me, "entry_commented", fan, entry, deletedComment, "comment:" + deletedComment, "deleted", now.minusSeconds(10));
        db.jdbc.update("UPDATE entry_comments SET body=NULL,deleted_at=now() WHERE id=?", deletedComment);
        UUID hiddenComment = comment(entry, fan, "숨긴 댓글");
        event(me, "entry_commented", fan, entry, hiddenComment, "comment:" + hiddenComment, "hidden", now.minusSeconds(10));
        db.jdbc.update("UPDATE entry_comments SET status='hidden' WHERE id=?", hiddenComment);
        UUID blockedByMe = db.member("내가 차단한 사람");
        event(me, "entry_liked", blockedByMe, entry, null, "like:" + like(entry, blockedByMe), "blocked-by-me", now.minusSeconds(10));
        block(me, blockedByMe);
        UUID blockedMe = db.member("나를 차단한 사람");
        event(me, "entry_liked", blockedMe, entry, null, "like:" + like(entry, blockedMe), "blocked-me", now.minusSeconds(10));
        block(blockedMe, me);
        UUID expired = likeEvent(me, "expired", now.minusSeconds(10));
        db.jdbc.update("UPDATE notifications SET expires_at=? WHERE id=?", ChallengeStoreFixture.utc(now), expired);
        UUID read = likeEvent(me, "read", now.minusSeconds(10));
        db.jdbc.update("UPDATE notifications SET read_at=now() WHERE id=?", read);
        assertThat(notifications.unread(me, now)).as("유효하지 않거나 만료(같은 시각 포함)됐거나 읽은 것은 세지 않는다").isEqualTo(4);

        db.jdbc.update("UPDATE notifications SET expires_at=? WHERE id=?", ChallengeStoreFixture.utc(now.plusNanos(1_000)), expired);
        assertThat(notifications.unread(me, now)).isEqualTo(5);
        notifications.read(me, List.of("liked"), null, null, now);
        assertThat(notifications.unread(me, now)).isEqualTo(4);
    }

    // ---- 발송 ----

    @Test
    @DisplayName("dispatch: 때가 된 묶음마다 첫 푸시 한 번, 그 뒤 요약 한 번이다. 보낸 사건은 attempted 와 시도 시각을, 더 보낼 수 없는 사건은 skipped 를 적는다")
    void dispatchSendsAFirstPushThenOneSummaryPerGroup() {
        UUID first = likeEvent(me, "g1", now.minusSeconds(60));
        UUID second = likeEvent(me, "g1", now.minusSeconds(30));
        UUID third = likeEvent(me, "g1", now.minusSeconds(20));
        due(first, now);
        due(second, now.plusSeconds(600));
        due(third, now.plusSeconds(1200));

        List<Outgoing> sent = notifications.dispatch(now, 10);

        assertThat(sent).singleElement().satisfies(push -> {
            assertThat(push.token()).isEqualTo("ExponentPushToken[me]");
            assertThat(push.title()).isEqualTo("Acttub");
            assertThat(push.body()).isEqualTo("팬님이 좋아요를 눌렀어요");
            assertThat(push.data()).isEqualTo(Map.of("type", "challenge_notification", "group_key", "g1", "kind", "entry_liked",
                    "challenge_id", challenge.toString(), "entry_id", entry.toString()));
        });
        assertThat(push(first)).isEqualTo("attempted");
        assertThat(db.instant("SELECT push_attempted_at FROM notifications WHERE id=?", first)).isEqualTo(now);
        assertThat(push(second)).as("아직 때가 아니다").isEqualTo("pending");
        assertThat(db.jdbc.queryForList("SELECT stage FROM notification_pushes WHERE group_key='g1'", String.class))
                .containsExactly("first");
        assertThat(db.jdbc.queryForMap("SELECT user_id,created_at IS NOT NULL AS stamped FROM notification_pushes"))
                .containsEntry("user_id", me).containsEntry("stamped", true);
        assertThat(db.instant("SELECT created_at FROM notification_pushes")).isEqualTo(now);

        Instant windowEnd = now.plusSeconds(600);
        assertThat(notifications.dispatch(windowEnd, 10)).hasSize(1);
        assertThat(push(second)).isEqualTo("attempted");
        assertThat(db.jdbc.queryForList("SELECT stage FROM notification_pushes ORDER BY created_at", String.class))
                .containsExactly("first", "summary");

        Instant muchLater = now.plusSeconds(1200);
        assertThat(notifications.dispatch(muchLater, 10)).as("요약은 묶음마다 한 번이다").isEmpty();
        assertThat(push(third)).isEqualTo("skipped");
        assertThat(db.instant("SELECT push_attempted_at FROM notifications WHERE id=?", third)).isNull();
        assertThat(db.count("notification_pushes")).isEqualTo(2);
    }

    @Test
    @DisplayName("dispatch: 유효하지 않게 된 사건과 기기가 없는 수신자의 사건은 보내지 않고 skipped 로 닫는다. 선점 행도 만들지 않는다")
    void dispatchSkipsWhatCanNoLongerBeSent() {
        UUID cancelledLike = like(entry, db.member("취소한 팬"));
        UUID cancelled = event(me, "entry_liked", fan, entry, null, "like:" + cancelledLike, "cancelled", now.minusSeconds(10));
        db.jdbc.update("DELETE FROM entry_likes WHERE id=?", cancelledLike);
        due(cancelled, now);
        UUID noDevice = db.member("기기 없음");
        UUID theirEntry = db.entry(challenge, noDevice, now.minus(Duration.ofHours(1)));
        UUID undeliverable = event(noDevice, "entry_liked", fan, theirEntry, null, "like:" + like(theirEntry, fan), "no-device",
                now.minusSeconds(10));
        due(undeliverable, now);
        UUID notYet = likeEvent(me, "later", now.minusSeconds(10));
        due(notYet, now.plusNanos(1_000));

        assertThat(notifications.dispatch(now, 10)).isEmpty();

        assertThat(push(cancelled)).isEqualTo("skipped");
        assertThat(push(undeliverable)).isEqualTo("skipped");
        assertThat(push(notYet)).isEqualTo("pending");
        assertThat(db.count("notification_pushes")).isZero();
    }

    @Test
    @DisplayName("dispatch: 한 번에 주어진 수의 묶음까지만 다룬다")
    void dispatchHandlesAtMostTheGivenNumberOfGroups() {
        for (String group : List.of("g1", "g2", "g3")) {
            due(likeEvent(me, group, now.minusSeconds(10)), now);
        }

        assertThat(notifications.dispatch(now, 2)).hasSize(2);

        assertThat(db.jdbc.queryForObject("SELECT count(*) FROM notifications WHERE push_status='pending'", Integer.class)).isEqualTo(1);
        assertThat(notifications.dispatch(now, 2)).hasSize(1);
    }

    @Test
    @DisplayName("두 발송이 겹치면 뒤의 것은 앞의 것이 잡은 사건을 기다리지 않고 지나간다 — 묶음은 한 번만 나가고 뒤의 것은 아무것도 바꾸지 않는다")
    void twoDispatchersDoNotSendTheSameGroupTwice() throws Exception {
        UUID event = likeEvent(me, "g1", now.minusSeconds(10));
        due(event, now);
        CountDownLatch dispatched = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<List<Outgoing>> first = pool.submit(() -> db.inTransaction(() -> {
                List<Outgoing> sent = notifications.dispatch(now, 10);
                dispatched.countDown();
                ChallengeStoreFixture.await(release);
                return sent;
            }));
            ChallengeStoreFixture.await(dispatched);
            List<Outgoing> second = pool.submit(() -> notifications.dispatch(now, 10)).get(20, TimeUnit.SECONDS);
            assertThat(second).isEmpty();
            assertThat(push(event)).as("앞의 것이 아직 커밋하지 않았다").isEqualTo("pending");
            release.countDown();
            assertThat(first.get(20, TimeUnit.SECONDS)).hasSize(1);
        } finally {
            pool.shutdownNow();
        }
        assertThat(push(event)).isEqualTo("attempted");
        assertThat(db.count("notification_pushes")).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 묶음의 같은 단계를 다른 트랜잭션이 선점하는 중이면 그 커밋을 기다렸다가 보내지 않고 skipped 로 닫는다")
    void aStageAlreadyBeingClaimedIsNotSentAgain() throws Exception {
        UUID event = likeEvent(me, "g1", now.minusSeconds(10));
        due(event, now);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (var probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, """
                    INSERT INTO notification_pushes(id,group_key,stage,user_id,created_at) VALUES (gen_random_uuid(),'g1','first',?,now())
                    """, me);
            Future<List<Outgoing>> dispatching = pool.submit(() -> notifications.dispatch(now, 10));
            assertThat(db.awaitWaiting("insert into notification_pushes").toLowerCase()).contains("on conflict");
            probe.commit();

            assertThat(dispatching.get(20, TimeUnit.SECONDS)).isEmpty();
        } finally {
            pool.shutdownNow();
        }
        assertThat(push(event)).isEqualTo("skipped");
        assertThat(db.count("notification_pushes")).isEqualTo(1);
    }

    // ---- 알림함의 댓글 앞부분 ----

    @Test
    @DisplayName("알림함: 댓글 묶음은 보이는 댓글의 앞 40자를 싣는다. 지우거나 숨긴 댓글의 묶음은 유효하지 않아 알림함에서 빠진다")
    void inboxCarriesTheFirstFortyCharactersOfAVisibleComment() {
        String body = "가나다라마바사아자차".repeat(4) + "넘치는 부분 😀";
        UUID visible = comment(entry, fan, body);
        event(me, "entry_commented", fan, entry, visible, "comment:" + visible, "visible", now.minusSeconds(30));
        UUID hidden = comment(entry, fan, "숨긴 댓글");
        event(me, "entry_commented", fan, entry, hidden, "comment:" + hidden, "hidden", now.minusSeconds(20));
        db.jdbc.update("UPDATE entry_comments SET status='hidden' WHERE id=?", hidden);

        var inbox = notifications.inbox(me, null, now);

        assertThat(inbox.groups()).singleElement().satisfies(group -> {
            assertThat(group.groupKey()).isEqualTo("visible");
            assertThat(group.commentExcerpt()).isEqualTo("가나다라마바사아자차".repeat(4));
            assertThat(group.actorName()).isEqualTo("팬");
            assertThat(group.commentId()).isEqualTo(visible);
        });
    }

    // ---- 문장 ----

    @Test
    @DisplayName("나가는 문장: 읽음 처리는 묶음·시각마다 UPDATE 하나, 안 읽은 수는 세기 하나, 발송은 묶음 고르기 → 사건 잡기 → 토큰 → 단계 확인 → 선점 → 이름 → 표시")
    void statements() {
        due(likeEvent(me, "g1", now.minusSeconds(10)), now);
        // 사건을 잡는 문장은 select 절의 유효성 서브쿼리가 먼저 나와, 줄인 이름에 그 표(entry_likes)가 붙는다.
        String lockEvents = "select entry_likes for update skip locked";

        assertThat(db.statementsOf(() -> notifications.unread(me, now))).containsExactly("count notifications");
        assertThat(db.statementsOf(() -> notifications.dispatch(now.minusSeconds(1), 10))).as("때가 된 것이 없다")
                .containsExactly("select notifications");
        assertThat(db.statementsOf(() -> notifications.dispatch(now, 10))).containsExactly(
                "select notifications", lockEvents, "select push_tokens",
                "select notification_pushes", "insert notification_pushes on conflict", "select users", "update notifications");

        UUID undeliverable = likeEvent(me, "g2", now.minusSeconds(10));
        due(undeliverable, now);
        db.jdbc.update("DELETE FROM entry_likes WHERE id=(SELECT CAST(substring(event_key FROM 6) AS uuid) FROM notifications WHERE id=?)",
                undeliverable);
        assertThat(db.statementsOf(() -> notifications.dispatch(now, 10))).as("보낼 수 없는 사건").containsExactly(
                "select notifications", lockEvents, "select push_tokens", "update notifications");

        assertThat(db.statementsOf(() -> notifications.read(me, List.of("g1"), null, null, now)))
                .containsExactly("update notifications");
        assertThat(db.statementsOf(() -> notifications.read(me, null, now, null, now))).containsExactly("update notifications");
        assertThat(db.statementsOf(() -> notifications.read(me, List.of("g1"), now, UUID.randomUUID(), now)))
                .containsExactly("update notifications", "update notifications");
        assertThat(db.statementsOf(() -> notifications.read(me, null, null, null, now))).isEmpty();

        UUID comment = comment(entry, fan, "댓글");
        event(me, "entry_commented", fan, entry, comment, "comment:" + comment, "g3", now.minusSeconds(5));
        List<String> inbox = db.statementsOf(() -> notifications.inbox(me, null, now));
        assertThat(inbox).as("묶음 조회 하나, 이어서 묶음마다 이름과(댓글이면) 앞부분").hasSize(4);
        assertThat(inbox.subList(1, 4)).containsExactly("select users", "select entry_comments", "select users");
    }

    // ---- 도움 ----

    /** 좋아요 행 하나와 그 사건. 보낼 시각 없이 skipped 로 넣는다 — 발송 테스트는 {@link #due} 로 때를 정한다. */
    private UUID likeEvent(UUID recipient, String group, Instant at) {
        return likeEvent(UUID.randomUUID(), recipient, group, at);
    }

    private UUID likeEvent(UUID id, UUID recipient, String group, Instant at) {
        UUID target = recipient.equals(me) ? entry : db.entry(challenge, recipient, now.minus(Duration.ofHours(2)));
        UUID liker = db.member("팬");
        return event(id, recipient, "entry_liked", liker, target, null, "like:" + like(target, liker), group, at);
    }

    private UUID event(UUID recipient, String kind, UUID actor, UUID entryId, UUID commentId, String eventKey, String group,
            Instant at) {
        return event(UUID.randomUUID(), recipient, kind, actor, entryId, commentId, eventKey, group, at);
    }

    private UUID event(UUID id, UUID recipient, String kind, UUID actor, UUID entryId, UUID commentId, String eventKey, String group,
            Instant at) {
        db.jdbc.update("""
                INSERT INTO notifications(id,user_id,kind,actor_user_id,challenge_id,entry_id,comment_id,event_key,group_key,
                    created_at,expires_at,push_status)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,'skipped')
                """, id, recipient, kind, actor, challenge, entryId, commentId, eventKey, group, ChallengeStoreFixture.utc(at),
                ChallengeStoreFixture.utc(at.plus(Duration.ofDays(90))));
        return id;
    }

    /** 그 사건을 {@code at} 에 보낼 것으로 둔다. */
    private UUID due(UUID event, Instant at) {
        db.jdbc.update("UPDATE notifications SET push_status='pending',push_after=? WHERE id=?", ChallengeStoreFixture.utc(at), event);
        return event;
    }

    private UUID like(UUID entryId, UUID by) {
        UUID id = UUID.randomUUID();
        db.jdbc.update("INSERT INTO entry_likes(id,entry_id,user_id) VALUES (?,?,?)", id, entryId, by);
        return id;
    }

    private UUID comment(UUID entryId, UUID by, String body) {
        UUID id = UUID.randomUUID();
        db.jdbc.update("""
                INSERT INTO entry_comments(id,entry_id,user_id,body,request_id,request_fingerprint) VALUES (?,?,?,?,?,?)
                """, id, entryId, by, body, UUID.randomUUID(), "0".repeat(64));
        return id;
    }

    private void block(UUID blocker, UUID blocked) {
        db.jdbc.update("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", UUID.randomUUID(), blocker, blocked);
    }

    private Instant readAt(UUID event) {
        return db.instant("SELECT read_at FROM notifications WHERE id=?", event);
    }

    private String push(UUID event) {
        return db.jdbc.queryForObject("SELECT push_status FROM notifications WHERE id=?", String.class, event);
    }

    private static UUID id(int n) {
        return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
    }
}
