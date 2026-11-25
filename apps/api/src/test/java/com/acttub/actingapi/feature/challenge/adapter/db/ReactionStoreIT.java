package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Participant;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.Blocked;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.Comment;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.CommentCreation;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.Liked;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository.Saved;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 좋아요·저장·댓글·차단의 저장소({@code ReactionRepository})를 고정한다. 누구에게 무엇이 보이는지, 한도와 재전송, 차단이 양쪽
 * 화면에서 빼는 것의 HTTP 응답은 {@code ChallengeReactionIT} 가 본다. 여기서는 행에 적히는 값, 같은 반응을 두 요청이 함께 보낼
 * 때, 차단과 좋아요가 겹칠 때, 댓글 지우기의 잠금, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class ReactionStoreIT {

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    ReactionRepository reactions;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private UUID author;
    private UUID viewer;
    private UUID challenge;
    private UUID entry;

    @BeforeEach
    void setUp() {
        db.reset();
        author = db.member("작성자");
        viewer = db.member("보는 사람");
        challenge = db.challenge(now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
        entry = db.entry(challenge, author, now.minus(Duration.ofHours(1)));
    }

    // ---- 좋아요·저장 ----

    @Test
    @DisplayName("like: 좋아요 행 하나와 그 행이 원인인 알림 사건 하나. 이미 눌러 둔 재전송은 행도 사건도 만들지 않고, 취소 뒤 다시 누르면 새 행과 새 사건이다")
    void likeIsOneRowAndOneEvent() {
        Instant precise = now.plusNanos(123_456_789);

        assertThat(reactions.like(viewer, entry, true, precise)).isEqualTo(new Liked(1, true));
        UUID first = db.jdbc.queryForObject("SELECT id FROM entry_likes", UUID.class);
        assertThat(db.jdbc.queryForMap("SELECT entry_id,user_id FROM entry_likes"))
                .containsEntry("entry_id", entry).containsEntry("user_id", viewer);
        assertThat(db.instant("SELECT created_at FROM entry_likes")).isEqualTo(now.plusNanos(123_457_000));
        assertThat(db.jdbc.queryForList("SELECT event_key FROM notifications WHERE user_id=?", String.class, author))
                .containsExactly("like:" + first);

        assertThat(reactions.like(viewer, entry, true, now.plusSeconds(1))).isEqualTo(new Liked(1, true));
        assertThat(db.jdbc.queryForList("SELECT id FROM entry_likes", UUID.class)).containsExactly(first);
        assertThat(db.count("notifications")).isEqualTo(1);

        assertThat(reactions.like(viewer, entry, false, now.plusSeconds(2))).isEqualTo(new Liked(0, false));
        assertThat(reactions.like(viewer, entry, false, now.plusSeconds(3))).as("없는 좋아요 취소").isEqualTo(new Liked(0, false));
        assertThat(db.count("notifications")).as("취소는 사건을 지우지 않는다").isEqualTo(1);

        UUID other = db.member("다른 팬");
        reactions.like(other, entry, true, now.plusSeconds(4));
        assertThat(reactions.like(viewer, entry, true, now.plusSeconds(5))).isEqualTo(new Liked(2, true));
        UUID second = db.jdbc.queryForObject("SELECT id FROM entry_likes WHERE user_id=?", UUID.class, viewer);
        assertThat(second).isNotEqualTo(first);
        assertThat(db.jdbc.queryForList("SELECT event_key FROM notifications WHERE actor_user_id=? ORDER BY created_at",
                String.class, viewer)).containsExactly("like:" + first, "like:" + second);

        assertRefused(() -> reactions.like(author, entry, true, now), 422, "self_like");
        assertRefused(() -> reactions.save(author, entry, true, now), 422, "self_save");
    }

    @Test
    @DisplayName("save: 저장 행 하나. 다시 저장해도 그대로이고, 풀면 지운다. 알림 사건은 없다")
    void saveIsOneRow() {
        assertThat(reactions.save(viewer, entry, true, now)).isEqualTo(new Saved(true));
        UUID first = db.jdbc.queryForObject("SELECT id FROM entry_saves", UUID.class);
        assertThat(db.jdbc.queryForMap("SELECT entry_id,user_id FROM entry_saves"))
                .containsEntry("entry_id", entry).containsEntry("user_id", viewer);
        assertThat(db.instant("SELECT created_at FROM entry_saves")).isEqualTo(now);

        assertThat(reactions.save(viewer, entry, true, now.plusSeconds(1))).isEqualTo(new Saved(true));
        assertThat(db.jdbc.queryForList("SELECT id FROM entry_saves", UUID.class)).containsExactly(first);
        assertThat(db.instant("SELECT created_at FROM entry_saves")).isEqualTo(now);

        assertThat(reactions.save(viewer, entry, false, now)).isEqualTo(new Saved(false));
        assertThat(reactions.save(viewer, entry, false, now)).isEqualTo(new Saved(false));
        assertThat(db.count("entry_saves")).isZero();
        assertThat(db.count("notifications")).isZero();
    }

    @Test
    @DisplayName("saved: 내 지우지 않은 참여작 수와 지금 보이는 저장 수를 함께 낸다")
    void savedCountsMyLiveEntriesAndVisibleSaves() {
        UUID hidden = db.entry(challenge, author, now.minus(Duration.ofHours(2)));
        reactions.save(viewer, entry, true, now);
        reactions.save(viewer, hidden, true, now.plusSeconds(1));
        db.jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", hidden);
        db.entry(challenge, viewer, now.minus(Duration.ofHours(3)));
        UUID privateOwn = db.entry(challenge, viewer, now.minus(Duration.ofHours(4)));
        db.jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", privateOwn);
        UUID deletedOwn = db.entry(challenge, viewer, now.minus(Duration.ofHours(5)));
        db.jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=now(),video_id=NULL WHERE id=?", deletedOwn);

        var saved = reactions.saved(viewer, null);

        assertThat(saved.entries()).extracting(card -> card.id()).containsExactly(entry);
        assertThat(saved.myEntryCount()).as("비공개는 세고 지운 것은 세지 않는다").isEqualTo(2);
        assertThat(saved.savedCount()).isEqualTo(1);
        assertThat(saved.nextCursor()).isNull();
    }

    @Test
    @DisplayName("같은 사람의 같은 좋아요를 두 요청이 함께 보내면 행 하나, 알림 사건 하나다. 서로 다른 두 사람이 함께 누르면 둘 다 들어간다")
    void concurrentLikes() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 10; round++) {
                UUID target = db.entry(challenge, author, now.minus(Duration.ofHours(1)));
                UUID fan = db.member("팬 " + round);
                UUID otherFan = db.member("다른 팬 " + round);
                CountDownLatch start = new CountDownLatch(1);
                Callable<Liked> same = () -> {
                    start.await();
                    return reactions.like(fan, target, true, now);
                };
                Future<Liked> first = pool.submit(same);
                Future<Liked> second = pool.submit(same);
                start.countDown();
                assertThat(List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS)))
                        .as("round %d", round).containsOnly(new Liked(1, true));
                assertThat(db.jdbc.queryForObject("SELECT count(*) FROM notifications WHERE entry_id=?", Integer.class, target))
                        .as("round %d", round).isEqualTo(1);

                CountDownLatch together = new CountDownLatch(1);
                Future<Liked> third = pool.submit(() -> {
                    together.await();
                    return reactions.like(otherFan, target, true, now);
                });
                Future<Liked> fourth = pool.submit(() -> {
                    together.await();
                    return reactions.like(db.member("셋째 팬"), target, true, now);
                });
                together.countDown();
                third.get(20, TimeUnit.SECONDS);
                fourth.get(20, TimeUnit.SECONDS);
                assertThat(db.jdbc.queryForObject("SELECT count(*) FROM entry_likes WHERE entry_id=?", Integer.class, target))
                        .as("round %d", round).isEqualTo(3);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- 댓글 ----

    @Test
    @DisplayName("comment: 댓글 행 하나와 알림 사건 하나. 적는 값: 본문·visible·요청 id·지문·만든 시각. 같은 요청의 재전송은 그 댓글을 돌려주고 다른 지문이면 422 다")
    void commentIsOneRowAndOneEvent() {
        UUID request = UUID.randomUUID();
        Instant precise = now.plusNanos(123_456_789);

        CommentCreation created = reactions.comment(viewer, entry, request, "a".repeat(64), "좋은 연기예요 😀", precise);

        Instant rounded = now.plusNanos(123_457_000);
        UUID id = created.comment().id();
        assertThat(created).isEqualTo(new CommentCreation(new Comment(id, new Participant(viewer, "보는 사람", null),
                "좋은 연기예요 😀", rounded, true, false, "visible"), true));
        assertThat(db.jdbc.queryForMap("SELECT entry_id,user_id,body,status,request_id,request_fingerprint,deleted_at FROM entry_comments"))
                .containsEntry("entry_id", entry).containsEntry("user_id", viewer).containsEntry("body", "좋은 연기예요 😀")
                .containsEntry("status", "visible").containsEntry("request_id", request)
                .containsEntry("request_fingerprint", "a".repeat(64)).containsEntry("deleted_at", null);
        assertThat(db.jdbc.queryForMap("SELECT kind,comment_id,event_key FROM notifications WHERE user_id=?", author))
                .containsEntry("kind", "entry_commented").containsEntry("comment_id", id).containsEntry("event_key", "comment:" + id);

        assertThat(reactions.comment(viewer, entry, request, "a".repeat(64), "좋은 연기예요 😀", now.plusSeconds(60)))
                .isEqualTo(new CommentCreation(created.comment(), false));
        assertRefused(() -> reactions.comment(viewer, entry, request, "b".repeat(64), "다른 본문", now),
                422, "request_fingerprint_mismatch");
        assertThat(db.count("entry_comments")).isEqualTo(1);
        assertThat(db.count("notifications")).isEqualTo(1);

        CommentCreation own = reactions.comment(author, entry, UUID.randomUUID(), "a".repeat(64), "감사합니다", now);
        assertThat(own.created()).isTrue();
        assertThat(db.count("notifications")).as("자기 참여작의 댓글은 사건이 없다").isEqualTo(1);
    }

    @Test
    @DisplayName("comment: 한국 날짜로 오늘 쓴 댓글이 100개면 429 daily_comment_limit 다. 어제 것과 남의 것은 세지 않고, 재전송은 한도 앞에서 돌려준다")
    void commentsAreLimitedPerKoreanDay() {
        UUID request = UUID.randomUUID();
        reactions.comment(viewer, entry, request, "a".repeat(64), "첫 댓글", now);
        db.jdbc.update("""
                INSERT INTO entry_comments(id,entry_id,user_id,body,request_id,request_fingerprint,created_at)
                SELECT gen_random_uuid(),?,?,'댓글',gen_random_uuid(),repeat('0',64),? FROM generate_series(1,98)
                """, entry, viewer, ChallengeStoreFixture.utc(Instant.parse("2026-11-24T15:00:00Z")));
        db.jdbc.update("""
                INSERT INTO entry_comments(id,entry_id,user_id,body,request_id,request_fingerprint,created_at)
                VALUES (gen_random_uuid(),?,?,'어제 댓글',gen_random_uuid(),repeat('0',64),?),
                       (gen_random_uuid(),?,?,'남의 댓글',gen_random_uuid(),repeat('0',64),?)
                """, entry, viewer, ChallengeStoreFixture.utc(Instant.parse("2026-11-24T14:59:59.999999Z")),
                entry, db.member("남"), ChallengeStoreFixture.utc(now));

        assertThat(reactions.comment(viewer, entry, UUID.randomUUID(), "a".repeat(64), "백 번째", now).created()).isTrue();
        assertRefused(() -> reactions.comment(viewer, entry, UUID.randomUUID(), "a".repeat(64), "넘침", now), 429, "daily_comment_limit");
        assertThat(reactions.comment(viewer, entry, request, "a".repeat(64), "첫 댓글", now).created()).isFalse();
    }

    @Test
    @DisplayName("같은 요청 id 의 댓글을 두 요청이 함께 보내면 댓글 하나이고, 하나는 만든 것을 다른 하나는 재전송으로 받는다")
    void concurrentCommentsWithTheSameRequestId() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 10; round++) {
                UUID request = UUID.randomUUID();
                CountDownLatch start = new CountDownLatch(1);
                Callable<CommentCreation> comment = () -> {
                    start.await();
                    return reactions.comment(viewer, entry, request, "a".repeat(64), "댓글", now);
                };
                Future<CommentCreation> first = pool.submit(comment);
                Future<CommentCreation> second = pool.submit(comment);
                start.countDown();
                List<CommentCreation> results = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));

                assertThat(results).as("round %d", round).extracting(CommentCreation::created).containsExactlyInAnyOrder(true, false);
                assertThat(results.get(0).comment()).as("round %d", round).isEqualTo(results.get(1).comment());
                assertThat(db.jdbc.queryForObject("SELECT count(*) FROM entry_comments WHERE request_id=?", Integer.class, request))
                        .as("round %d", round).isEqualTo(1);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("deleteComment: 본문을 파기하고 지운 시각을 남긴다. 그 댓글의 신고 사본도 비운다. 다시 지워도 시각은 그대로이고, 남의 댓글·없는 댓글은 404 다")
    void deleteCommentPurgesTheBodyAndReportCopies() {
        UUID mine = reactions.comment(viewer, entry, UUID.randomUUID(), "a".repeat(64), "지울 댓글", now).comment().id();
        UUID theirs = reactions.comment(author, entry, UUID.randomUUID(), "a".repeat(64), "남의 댓글", now).comment().id();
        report("comment", mine, "지울 댓글");
        report("comment", theirs, "남의 댓글");
        report("entry", mine, "같은 id 의 참여작 신고 사본");
        Instant precise = now.plusSeconds(10).plusNanos(123_456_789);

        reactions.deleteComment(viewer, mine, precise);

        Instant rounded = now.plusSeconds(10).plusNanos(123_457_000);
        assertThat(db.jdbc.queryForMap("SELECT body,status FROM entry_comments WHERE id=?", mine))
                .containsEntry("body", null).containsEntry("status", "visible");
        assertThat(db.instant("SELECT deleted_at FROM entry_comments WHERE id=?", mine)).isEqualTo(rounded);
        assertThat(db.jdbc.queryForList("SELECT target_text FROM entry_reports ORDER BY target_text NULLS FIRST", String.class))
                .containsExactly(null, "같은 id 의 참여작 신고 사본", "남의 댓글");

        reactions.deleteComment(viewer, mine, now.plusSeconds(600));
        assertThat(db.instant("SELECT deleted_at FROM entry_comments WHERE id=?", mine)).isEqualTo(rounded);
        assertRefused(() -> reactions.deleteComment(viewer, theirs, now), 404, "comment_not_found");
        assertRefused(() -> reactions.deleteComment(viewer, UUID.randomUUID(), now), 404, "comment_not_found");
        assertThat(db.jdbc.queryForObject("SELECT body FROM entry_comments WHERE id=?", String.class, theirs)).isEqualTo("남의 댓글");
    }

    @Test
    @DisplayName("deleteComment 는 댓글 행을 FOR UPDATE 로 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 기다린다")
    void deleteCommentLocksTheCommentForUpdate() throws Exception {
        UUID mine = reactions.comment(viewer, entry, UUID.randomUUID(), "a".repeat(64), "지울 댓글", now).comment().id();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM entry_comments WHERE id=? FOR KEY SHARE", mine);
            Future<?> deleting = pool.submit(() -> reactions.deleteComment(viewer, mine, now));
            String waiting = db.awaitWaiting("from entry_comments");
            assertThat(db.locked("users", viewer)).as("사람 행이 먼저다").isTrue();
            probe.rollback();
            deleting.get(20, TimeUnit.SECONDS);

            assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key");
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.jdbc.queryForObject("SELECT body IS NULL FROM entry_comments WHERE id=?", Boolean.class, mine)).isTrue();
    }

    // ---- 차단 ----

    @Test
    @DisplayName("block: 차단 행 하나. 다시 켜도 그대로이고 끄면 지운다. 자기 자신은 422, 없거나 활성이 아닌 상대를 켜면 404 다. 끄는 것은 상대를 따지지 않는다")
    void blockIsOneRow() {
        assertThat(reactions.block(viewer, author, true, now)).isEqualTo(new Blocked(author, true));
        UUID first = db.jdbc.queryForObject("SELECT id FROM user_blocks", UUID.class);
        assertThat(db.jdbc.queryForMap("SELECT blocker_id,blocked_id FROM user_blocks"))
                .containsEntry("blocker_id", viewer).containsEntry("blocked_id", author);
        assertThat(db.instant("SELECT created_at FROM user_blocks")).isEqualTo(now);

        reactions.block(viewer, author, true, now.plusSeconds(1));
        assertThat(db.jdbc.queryForList("SELECT id FROM user_blocks", UUID.class)).containsExactly(first);
        reactions.block(author, viewer, true, now);
        assertThat(db.count("user_blocks")).as("방향마다 한 행").isEqualTo(2);

        assertThat(reactions.block(viewer, author, false, now)).isEqualTo(new Blocked(author, false));
        assertThat(reactions.block(viewer, author, false, now)).isEqualTo(new Blocked(author, false));
        assertThat(db.jdbc.queryForList("SELECT blocker_id FROM user_blocks", UUID.class)).containsExactly(author);

        assertRefused(() -> reactions.block(viewer, viewer, true, now), 422, "self_block");
        UUID missing = UUID.randomUUID();
        assertRefused(() -> reactions.block(viewer, missing, true, now), 404, "user_not_found");
        UUID closed = db.member("닫힌 계정");
        db.jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", closed);
        assertRefused(() -> reactions.block(viewer, closed, true, now), 404, "user_not_found");
        assertThat(reactions.block(viewer, closed, false, now)).isEqualTo(new Blocked(closed, false));
        assertThat(reactions.block(viewer, missing, false, now)).isEqualTo(new Blocked(missing, false));
    }

    @Test
    @DisplayName("작성자의 차단이 먼저 잡으면 그 사람의 좋아요는 사람 행에서 기다렸다가 404 entry_not_found 를 받는다 — 좋아요가 남지 않는다")
    void aLikeBehindABlockIsRefused() throws Exception {
        CountDownLatch blocked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> blocking = pool.submit(() -> db.inTransaction(() -> {
                reactions.block(author, viewer, true, now);
                blocked.countDown();
                ChallengeStoreFixture.await(release);
            }));
            ChallengeStoreFixture.await(blocked);
            Future<Object> liking = pool.submit(() -> {
                try {
                    return reactions.like(viewer, entry, true, now);
                } catch (ApiException refused) {
                    return refused;
                }
            });
            db.awaitWaiting("from users");
            release.countDown();
            blocking.get(20, TimeUnit.SECONDS);

            assertThat(liking.get(20, TimeUnit.SECONDS)).isInstanceOfSatisfying(ApiException.class, refused -> {
                assertThat(refused.status()).isEqualTo(404);
                assertThat(refused.getMessage()).isEqualTo("entry_not_found");
            });
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.count("entry_likes")).isZero();
        assertThat(db.count("notifications")).isZero();
    }

    // ---- 문장 ----

    @Test
    @DisplayName("나가는 문장: 좋아요는 참여작 잠금(여섯) → 넣기 → 알림 사건(셋) → 세기. 이미 눌렀으면 사건이 없고, 취소는 지우기와 세기다")
    void statements() {
        List<String> lockEntry = entryLock();
        List<String> event = List.of("select notifications", "select user_profiles", "insert notifications on conflict");

        assertThat(db.statementsOf(() -> reactions.like(viewer, entry, true, now)))
                .containsExactlyElementsOf(concat(lockEntry, List.of("insert entry_likes on conflict"), event, List.of("count entry_likes")));
        assertThat(db.statementsOf(() -> reactions.like(viewer, entry, true, now))).as("이미 누른 좋아요")
                .containsExactlyElementsOf(concat(lockEntry, List.of("insert entry_likes on conflict", "count entry_likes")));
        assertThat(db.statementsOf(() -> reactions.like(viewer, entry, false, now)))
                .containsExactlyElementsOf(concat(lockEntry, List.of("delete entry_likes", "count entry_likes")));
        assertThat(db.statementsOf(() -> reactions.save(viewer, entry, true, now)))
                .containsExactlyElementsOf(concat(lockEntry, List.of("insert entry_saves on conflict")));
        assertThat(db.statementsOf(() -> reactions.save(viewer, entry, false, now)))
                .containsExactlyElementsOf(concat(lockEntry, List.of("delete entry_saves")));

        reactions.save(viewer, entry, true, now);
        // 참여작 카드 문장은 select 절의 좋아요 수 서브쿼리가 먼저 나와, 줄인 이름에 그 표(entry_likes)가 붙는다.
        assertThat(db.statementsOf(() -> reactions.saved(viewer, null))).containsExactly(
                "select entry_saves", "select entry_likes", "count challenge_entries", "count entry_saves");

        UUID request = UUID.randomUUID();
        List<String> created = db.statementsOf(() -> reactions.comment(viewer, entry, request, "a".repeat(64), "댓글", now));
        assertThat(created).containsExactlyElementsOf(concat(List.of("select entry_comments"), lockEntry,
                List.of("select entry_comments", "count entry_comments", "insert entry_comments"), event,
                List.of("select entry_comments")));
        assertThat(db.statementsOf(() -> reactions.comment(viewer, entry, request, "a".repeat(64), "댓글", now))).as("재전송")
                .containsExactly("select entry_comments", "select entry_comments");
        UUID comment = db.jdbc.queryForObject("SELECT id FROM entry_comments", UUID.class);
        assertThat(db.statementsOf(() -> reactions.deleteComment(viewer, comment, now))).containsExactly(
                "select users for update", "select entry_comments for update", "update entry_comments", "update entry_reports");
        assertThat(db.statementsOf(() -> reactions.deleteComment(viewer, comment, now))).as("이미 지운 댓글")
                .containsExactly("select users for update", "select entry_comments for update");

        assertThat(db.statementsOf(() -> reactions.block(viewer, author, true, now))).containsExactly(
                "select users for update", "select users for update", "select users", "insert user_blocks on conflict");
        assertThat(db.statementsOf(() -> reactions.block(viewer, author, false, now))).containsExactly(
                "select users for update", "select users for update", "delete user_blocks");
        assertThat(db.statementsOf(() -> reactions.blocks(viewer))).containsExactly("select user_blocks");
    }

    /** {@code EntryLocks#entry} 의 읽기 잠금 여섯 문장(사람 둘은 id 순). */
    private List<String> entryLock() {
        List<String> people = author.compareTo(viewer) < 0
                ? List.of("select users for share", "select users for update")
                : List.of("select users for update", "select users for share");
        return List.of("select challenge_entries", people.get(0), people.get(1), "select challenges",
                "select challenge_entries for share", "select challenge_entries");
    }

    @SafeVarargs
    private static List<String> concat(List<String>... parts) {
        return java.util.Arrays.stream(parts).flatMap(List::stream).toList();
    }

    private void report(String type, UUID target, String text) {
        db.jdbc.update("""
                INSERT INTO entry_reports(id,target_type,target_id,reporter_id,reason,status,target_version,target_text,request_id,
                    request_fingerprint)
                VALUES (gen_random_uuid(),?,?,?,'spam','received',1,?,gen_random_uuid(),repeat('0',64))
                """, type, target, db.member("신고자"), text);
    }

    private static void assertRefused(Runnable call, int status, String detail) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, refused -> {
            assertThat(refused.status()).isEqualTo(status);
            assertThat(refused.getMessage()).isEqualTo(detail);
        });
    }
}
