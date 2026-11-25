package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.EntryCard;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.EntryPage;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 참여작 저장소({@code EntryRepository})의 조회수 기록·좋아요순의 굳힌 순서·단건 조회·보관 기간 정리를 고정한다. 목록의 순서와
 * 순위, 차단·덜 본 참여작 끼우기, 본인 기록의 분류는 {@code ChallengeEntryIT} 가 HTTP 로 본다. 여기서는 조회수 사건의 한 번만
 * 반영, 굳힌 순서 행에 적히는 값과 만료, 정리의 경계, 같은 사건을 두 요청이 함께 보낼 때, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class EntryReadStoreIT {

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    EntryRepository entries;

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

    // ---- 조회수 ----

    @Test
    @DisplayName("view: 남의 보이는 참여작의 재생 사건 하나가 조회수 1이다. 같은 사건 id 의 재전송과 본인 재생은 반영하지 않는다. 보이지 않으면 404 다")
    void viewCountsEachEventOnce() {
        UUID event = UUID.randomUUID();
        Instant precise = now.plusNanos(123_456_789);

        assertThat(entries.view(viewer, entry, event, precise)).isTrue();
        assertThat(entries.view(viewer, entry, event, now.plusSeconds(60))).as("같은 사건").isFalse();
        assertThat(entries.view(author, entry, UUID.randomUUID(), now)).as("본인 재생").isFalse();
        assertThat(entries.view(viewer, entry, UUID.randomUUID(), now.plusSeconds(1))).isTrue();

        assertThat(views(entry)).isEqualTo(2);
        assertThat(db.jdbc.queryForMap("SELECT entry_id,user_id FROM entry_view_events WHERE event_id=?", event))
                .containsEntry("entry_id", entry).containsEntry("user_id", viewer);
        assertThat(db.instant("SELECT created_at FROM entry_view_events WHERE event_id=?", event)).isEqualTo(now.plusNanos(123_457_000));
        assertThat(db.count("entry_view_events")).isEqualTo(2);
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).as("조회수는 고친 시각을 바꾸지 않는다")
                .isEqualTo(now.minus(Duration.ofHours(1)));

        db.jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", entry);
        assertRefused(() -> entries.view(viewer, entry, UUID.randomUUID(), now), 404, "entry_not_found");
        assertThat(entries.view(author, entry, UUID.randomUUID(), now)).as("본인은 비공개여도 404 가 아니다").isFalse();
        assertRefused(() -> entries.view(viewer, UUID.randomUUID(), UUID.randomUUID(), now), 404, "entry_not_found");
        assertThat(views(entry)).isEqualTo(2);
    }

    @Test
    @DisplayName("같은 사건을 두 요청이 함께 보내면 조회수는 1만 오른다. 서로 다른 사건 둘이 함께 오면 2가 오른다")
    void concurrentViews() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 10; round++) {
                UUID target = db.entry(challenge, author, now.minus(Duration.ofHours(2)));
                UUID same = UUID.randomUUID();
                CountDownLatch start = new CountDownLatch(1);
                List<Future<Boolean>> racing = new ArrayList<>();
                for (UUID event : List.of(same, same)) {
                    racing.add(pool.submit(viewing(start, target, event)));
                }
                start.countDown();
                assertThat(List.of(racing.get(0).get(20, TimeUnit.SECONDS), racing.get(1).get(20, TimeUnit.SECONDS)))
                        .as("round %d", round).containsExactlyInAnyOrder(true, false);
                assertThat(views(target)).as("round %d", round).isEqualTo(1);

                CountDownLatch together = new CountDownLatch(1);
                List<Future<Boolean>> different = List.of(pool.submit(viewing(together, target, UUID.randomUUID())),
                        pool.submit(viewing(together, target, UUID.randomUUID())));
                together.countDown();
                different.get(0).get(20, TimeUnit.SECONDS);
                different.get(1).get(20, TimeUnit.SECONDS);
                assertThat(views(target)).as("round %d", round).isEqualTo(3);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- 좋아요순의 굳힌 순서 ----

    @Test
    @DisplayName("좋아요순 첫 조회는 순서와 순위를 한 행에 굳혀 둔다(기준·보는 사람·챌린지·참여작 id 배열·순위 배열·시각). 커서는 그 행을 읽어 잇고, 10분이 지나거나 기준이 바뀌면 410 cursor_expired 다")
    void likesOrderIsHeldInASnapshotRow() {
        List<UUID> ids = new ArrayList<>(List.of(entry));
        for (int i = 0; i < 21; i++) {
            ids.add(db.entry(challenge, db.member("배우 " + i), now.minus(Duration.ofHours(1)).plusSeconds(i + 1)));
        }
        like(ids.get(3), 2);
        like(ids.get(5), 1);
        Instant precise = now.plusNanos(123_456_789);

        EntryPage first = entries.list(viewer, challenge, "likes", null, null, precise);

        assertThat(first.entries()).hasSize(20);
        assertThat(first.entries()).extracting(EntryCard::id).startsWith(ids.get(3), ids.get(5));
        assertThat(first.entries()).extracting(EntryCard::rank).as("셋째 칸은 덜 본 새 참여작을 끼운 자리라 순위가 없다").startsWith(1, 2, null);
        Map<String, Object> row = db.jdbc.queryForMap("SELECT id,challenge_id,viewer_id,basis,cardinality(entry_ids) AS entries,"
                + "cardinality(ranks) AS ranks,entry_ids[1] AS top,ranks[1] AS top_rank,ranks[3] AS third_rank FROM entry_ranking_snapshots");
        assertThat(row).containsEntry("challenge_id", challenge).containsEntry("viewer_id", viewer).containsEntry("basis", "live")
                .containsEntry("entries", 22).containsEntry("ranks", 22).containsEntry("top", ids.get(3)).containsEntry("top_rank", 1)
                .containsEntry("third_rank", 0);
        assertThat(db.instant("SELECT created_at FROM entry_ranking_snapshots")).isEqualTo(now.plusNanos(123_457_000));

        like(ids.get(10), 5);
        EntryPage second = entries.list(viewer, challenge, "likes", first.nextCursor(), null, now.plusSeconds(599));
        assertThat(second.entries()).as("굳힌 순서를 잇는다 — 그 사이 추월해도 겹치거나 빠지지 않는다").hasSize(2);
        assertThat(second.nextCursor()).isNull();
        assertThat(db.count("entry_ranking_snapshots")).as("커서 조회는 새 행을 만들지 않는다").isEqualTo(1);

        assertRefused(() -> entries.list(viewer, challenge, "likes", first.nextCursor(), null, now.plusNanos(123_457_000).plusSeconds(600)),
                410, "cursor_expired");
        db.jdbc.update("UPDATE entry_ranking_snapshots SET basis='pending'");
        assertRefused(() -> entries.list(viewer, challenge, "likes", first.nextCursor(), null, now.plusSeconds(1)), 410, "cursor_expired");
        UUID stranger = db.member("남");
        assertThatThrownBy(() -> entries.list(stranger, challenge, "likes", first.nextCursor(), null, now.plusSeconds(1)))
                .as("남의 굳힌 순서는 읽지 못한다 — 커서 검증 오류(422)다")
                .isInstanceOf(com.acttub.actingapi.platform.web.ApiValidationException.class);
    }

    @Test
    @DisplayName("좋아요가 모두 0이면 순위 배열은 0(순위 없음)이고, 참여작이 없으면 빈 배열을 굳힌다")
    void snapshotsWithoutRanks() {
        entries.list(viewer, challenge, "likes", null, null, now);
        UUID empty = db.challenge(now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
        assertThat(entries.list(viewer, empty, "likes", null, null, now).entries()).isEmpty();

        assertThat(db.jdbc.queryForObject("SELECT entry_ids[1] || '/' || ranks[1] FROM entry_ranking_snapshots WHERE challenge_id=?",
                String.class, challenge)).isEqualTo(entry + "/0");
        assertThat(db.jdbc.queryForObject("SELECT cardinality(entry_ids) + cardinality(ranks) FROM entry_ranking_snapshots "
                + "WHERE challenge_id=?", Integer.class, empty)).isZero();
    }

    // ---- 단건 조회 ----

    @Test
    @DisplayName("find: 보이는 참여작이거나 본인의 지우지 않은 참여작이면 낸다. 남의 비공개와 지운 것은 404 다")
    void findShowsVisibleOrOwnEntries() {
        assertThat(entries.find(viewer, entry).id()).isEqualTo(entry);
        db.jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", entry);
        assertThat(entries.find(author, entry).isMine()).isTrue();
        assertRefused(() -> entries.find(viewer, entry), 404, "entry_not_found");
        db.jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=now(),video_id=NULL WHERE id=?", entry);
        assertRefused(() -> entries.find(author, entry), 404, "entry_not_found");
    }

    // ---- 보관 기간 정리 ----

    @Test
    @DisplayName("settle 의 정리: 조회수 사건은 7일, 굳힌 순서는 10분, 알림은 만료 시각, 묶음 선점은 이틀, 파기된 AI 리포트와 처리된 신고는 90일이 지나면 지운다. 경계에 있는 것은 남는다")
    void settlePurgesExpiredRows() {
        Instant week = now.minus(Duration.ofDays(7));
        db.jdbc.update("INSERT INTO entry_view_events(event_id,entry_id,user_id,created_at) VALUES (?,?,?,?),(?,?,?,?)",
                id(1), entry, viewer, ChallengeStoreFixture.utc(week.minusNanos(1_000)), id(2), entry, viewer, ChallengeStoreFixture.utc(week));
        Instant hold = now.minus(Duration.ofMinutes(10));
        for (Object[] snapshot : List.of(new Object[] {id(3), hold.minusNanos(1_000)}, new Object[] {id(4), hold})) {
            db.jdbc.update("INSERT INTO entry_ranking_snapshots(id,challenge_id,viewer_id,basis,entry_ids,ranks,created_at) "
                    + "VALUES (?,?,?,'live','{}','{}',?)", snapshot[0], challenge, viewer, ChallengeStoreFixture.utc((Instant) snapshot[1]));
        }
        for (Object[] notice : List.of(new Object[] {id(5), now}, new Object[] {id(6), now.plusNanos(1_000)})) {
            db.jdbc.update("INSERT INTO notifications(id,user_id,kind,challenge_id,event_key,group_key,created_at,expires_at,push_status) "
                    + "VALUES (?,?,'challenge_ended',?,?,'g',now(),?,'skipped')", notice[0], author, challenge, "ended:" + notice[0],
                    ChallengeStoreFixture.utc((Instant) notice[1]));
        }
        Instant twoDays = now.minus(Duration.ofDays(2));
        for (Object[] push : List.of(new Object[] {id(7), "first", twoDays.minusNanos(1_000)}, new Object[] {id(8), "summary", twoDays})) {
            db.jdbc.update("INSERT INTO notification_pushes(id,group_key,stage,user_id,created_at) VALUES (?,'g',?,?,?)", push[0], push[1],
                    author, ChallengeStoreFixture.utc((Instant) push[2]));
        }
        Instant ninety = now.minus(Duration.ofDays(90));
        UUID kept = db.entry(challenge, author, now.minus(Duration.ofHours(2)));
        UUID live = db.entry(challenge, author, now.minus(Duration.ofHours(3)));
        for (Object[] report : new Object[][] {{id(9), entry, ninety.minusNanos(1_000)}, {id(10), kept, ninety}, {id(11), live, null}}) {
            UUID job = UUID.randomUUID();
            db.jdbc.update("INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status) "
                    + "VALUES (?,?,'challenge_report',?,gen_random_uuid(),repeat('0',64),'failed')", job, author, report[1]);
            db.jdbc.update("INSERT INTO entry_ai_reports(id,entry_id,user_id,job_id,status,requested_at,purged_at) VALUES (?,?,?,?,'failed',"
                    + "now(),?)", report[0], report[1], author, job, report[2] == null ? null : ChallengeStoreFixture.utc((Instant) report[2]));
        }
        for (Object[] filed : new Object[][] {{id(12), "reviewed", ninety.minusNanos(1_000)}, {id(13), "reviewed", ninety},
                {id(14), "received", null}}) {
            db.jdbc.update("INSERT INTO entry_reports(id,target_type,target_id,reporter_id,reason,status,resolution,reviewed_at,"
                    + "target_version,request_id,request_fingerprint,created_at) VALUES (?,'entry',?,?,'spam',?,?,?,1,gen_random_uuid(),"
                    + "repeat('0',64),?)", filed[0], entry, db.member("신고자"), filed[1], "reviewed".equals(filed[1]) ? "dismissed" : null,
                    filed[2] == null ? null : ChallengeStoreFixture.utc((Instant) filed[2]),
                    ChallengeStoreFixture.utc(now.minus(Duration.ofDays(200))));
        }

        assertThat(entries.settle(now)).isZero();

        assertThat(db.jdbc.queryForList("SELECT event_id FROM entry_view_events", UUID.class)).containsExactly(id(2));
        assertThat(db.jdbc.queryForList("SELECT id FROM entry_ranking_snapshots", UUID.class)).containsExactly(id(4));
        assertThat(db.jdbc.queryForList("SELECT id FROM notifications", UUID.class)).containsExactly(id(6));
        assertThat(db.jdbc.queryForList("SELECT id FROM notification_pushes", UUID.class)).containsExactly(id(8));
        assertThat(db.jdbc.queryForList("SELECT id FROM entry_ai_reports ORDER BY id", UUID.class)).containsExactly(id(10), id(11));
        assertThat(db.jdbc.queryForList("SELECT id FROM entry_reports ORDER BY id", UUID.class)).containsExactly(id(13), id(14));
    }

    // ---- 문장 ----

    @Test
    @DisplayName("나가는 문장: 조회수는 노출 확인 → 사건 넣기 → 조회수 올리기(재전송은 넣기에서 멈춤). 좋아요순 첫 조회는 굳힌 순서를 한 번 넣고, 커서 조회는 한 번 읽는다. 정리는 표마다 DELETE 하나다")
    void statements() {
        UUID event = UUID.randomUUID();
        assertThat(db.statementsOf(() -> entries.view(viewer, entry, event, now))).containsExactly(
                "select challenge_entries", "insert entry_view_events on conflict", "update challenge_entries");
        assertThat(db.statementsOf(() -> entries.view(viewer, entry, event, now))).as("같은 사건")
                .containsExactly("select challenge_entries", "insert entry_view_events on conflict");
        assertThat(db.statementsOf(() -> entries.view(author, entry, UUID.randomUUID(), now))).as("본인 재생")
                .containsExactly("select challenge_entries");

        for (int i = 0; i < 21; i++) {
            db.entry(challenge, db.member("배우 " + i), now.minus(Duration.ofHours(2)).plusSeconds(i));
        }
        EntryPage first = db.statementsAndResult(() -> entries.list(viewer, challenge, "likes", null, null, now), sent -> {
            assertThat(sent).filteredOn(statement -> statement.contains("entry_ranking_snapshots"))
                    .containsExactly("insert entry_ranking_snapshots");
            assertThat(sent.subList(0, 2)).as("마감 확인, 챌린지 조회").containsExactly("select challenges", "select challenges");
            assertThat(sent).as("마감 확인·챌린지·전체 순서·덜 본 참여작 고르기·굳히기·노출 확인·카드").hasSize(7);
        });
        db.statementsAndResult(() -> entries.list(viewer, challenge, "likes", first.nextCursor(), null, now), sent -> {
            assertThat(sent).filteredOn(statement -> statement.contains("entry_ranking_snapshots"))
                    .containsExactly("select entry_ranking_snapshots");
            assertThat(sent).as("마감 확인·챌린지·굳힌 순서·노출 확인·카드").hasSize(5);
        });
        assertThat(db.statementsOf(() -> entries.list(viewer, challenge, "latest", null, null, now)).subList(0, 2))
                .containsExactly("select challenges", "select challenges");

        assertThat(db.statementsOf(() -> entries.find(viewer, entry))).hasSize(3).startsWith("select challenge_entries",
                "select challenge_entries");
        assertThat(db.statementsOf(() -> entries.settle(now))).containsExactly("select challenges", "delete entry_view_events",
                "delete entry_ranking_snapshots", "delete notifications", "delete notification_pushes", "delete entry_ai_reports",
                "delete entry_reports");
    }

    // ---- 도움 ----

    private Callable<Boolean> viewing(CountDownLatch start, UUID target, UUID event) {
        return () -> {
            start.await();
            return entries.view(viewer, target, event, now);
        };
    }

    private long views(UUID target) {
        return db.jdbc.queryForObject("SELECT view_count FROM challenge_entries WHERE id=?", Long.class, target);
    }

    private void like(UUID target, int count) {
        for (int i = 0; i < count; i++) {
            db.jdbc.update("INSERT INTO entry_likes(id,entry_id,user_id) VALUES (gen_random_uuid(),?,?)", target, db.member("팬"));
        }
    }

    private static UUID id(int n) {
        return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
    }

    private static void assertRefused(Runnable call, int status, String detail) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, refused -> {
            assertThat(refused.status()).isEqualTo(status);
            assertThat(refused.getMessage()).isEqualTo(detail);
        });
    }
}
