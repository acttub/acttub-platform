package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
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

import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.Creation;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.MosaicJob;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.MyEntry;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.NewEntry;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 참여작 저장소({@code EntryRepository})의 쓰기 — 올리기·고치기·지우기·얼굴 모자이크 — 를 고정한다. 검증과 사유 코드, 공개 전환,
 * 지운 뒤의 화면, 모자이크 워커를 거친 흐름의 HTTP 응답은 {@code ChallengeEntryIT} 가 보고, 올리기의 잠금 순서와 경합은
 * {@link ChallengeLockOrderIT} 가 본다. 여기서는 행에 적히는 값, 지우기가 딸린 표에 남기는 것, 본인 참여작 잠금의 세기와 순서,
 * 고치기와 지우기가 겹칠 때, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class EntryWriteStoreIT {

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    EntryRepository entries;

    /** 한국 시간 낮 12시. */
    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private UUID owner;
    private UUID challenge;

    @BeforeEach
    void setUp() {
        db.reset();
        owner = db.member("배우");
        challenge = db.challenge(now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
    }

    // ---- 올리기 ----

    @Test
    @DisplayName("create: 공개면 공개 시각과 AI 검사 차례(pending)를 적고, 비공개면 둘 다 비운다. 모자이크를 켜면 만드는 중(pending)으로 둔다. 시각은 마이크로초로 반올림한다")
    void createWritesTheRow() {
        UUID request = UUID.randomUUID();
        UUID video = db.video(owner);
        Instant precise = now.plusNanos(123_456_789);

        Creation open = entries.create(owner, challenge, request, "a".repeat(64), new NewEntry(video, "첫 참여", "public", false), precise);
        Creation hidden = entries.create(owner, challenge, UUID.randomUUID(), "b".repeat(64),
                new NewEntry(db.video(owner), null, "private", true), now.plusSeconds(1));

        Instant rounded = now.plusNanos(123_457_000);
        assertThat(open.created()).isTrue();
        Map<String, Object> row = db.jdbc.queryForMap("SELECT * FROM challenge_entries WHERE id=?", open.entry().id());
        assertThat(row).containsEntry("challenge_id", challenge).containsEntry("user_id", owner).containsEntry("video_id", video)
                .containsEntry("caption", "첫 참여").containsEntry("content_version", 1).containsEntry("visibility", "public")
                .containsEntry("status", "visible").containsEntry("view_count", 0L).containsEntry("request_id", request)
                .containsEntry("request_fingerprint", "a".repeat(64)).containsEntry("face_mosaic", false)
                .containsEntry("mosaic_status", null).containsEntry("moderation_status", "pending")
                .containsEntry("moderation_attempts", 0).containsEntry("final_rank", null).containsEntry("deleted_at", null);
        for (String column : List.of("published_at", "created_at", "updated_at")) {
            assertThat(db.instant("SELECT " + column + " FROM challenge_entries WHERE id=?", open.entry().id())).as(column)
                    .isEqualTo(rounded);
        }
        assertThat(db.jdbc.queryForMap("SELECT caption,visibility,published_at,face_mosaic,mosaic_status,moderation_status "
                + "FROM challenge_entries WHERE id=?", hidden.entry().id()))
                .containsEntry("caption", null).containsEntry("visibility", "private").containsEntry("published_at", null)
                .containsEntry("face_mosaic", true).containsEntry("mosaic_status", "pending").containsEntry("moderation_status", null);
        assertThat(open.entry().visibility()).isEqualTo("public");
        assertThat(hidden.entry().mosaicStatus()).isEqualTo("pending");
    }

    @Test
    @DisplayName("create: 같은 요청의 재전송은 그 참여작을 돌려주고(지문이 다르면 422), 같은 영상은 한 챌린지에 한 번이며(422), 한국 날짜로 오늘 올린 것이 셋이면 429 다. 지운 것도 하루 수에 든다")
    void createReplaysAndLimits() {
        UUID request = UUID.randomUUID();
        UUID video = db.video(owner);
        Creation first = entries.create(owner, challenge, request, "a".repeat(64), new NewEntry(video, null, "public", false), now);

        Creation replay = entries.create(owner, challenge, request, "a".repeat(64), new NewEntry(video, null, "public", false),
                now.plusSeconds(60));
        assertThat(replay.created()).isFalse();
        assertThat(replay.entry().id()).isEqualTo(first.entry().id());
        assertThat(entries.replay(owner, request).fingerprint()).isEqualTo("a".repeat(64));
        assertThat(entries.replay(owner, UUID.randomUUID())).isNull();
        assertRefused(() -> entries.create(owner, challenge, request, "b".repeat(64), new NewEntry(video, null, "public", false), now),
                422, "request_fingerprint_mismatch");
        assertRefused(() -> entries.create(owner, challenge, UUID.randomUUID(), "a".repeat(64), new NewEntry(video, null, "private", false),
                now), 422, "duplicate_entry");
        UUID otherChallenge = db.challenge(now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
        assertThat(entries.create(owner, otherChallenge, UUID.randomUUID(), "a".repeat(64), new NewEntry(video, null, "public", false),
                now).created()).as("다른 챌린지에는 같은 영상을 낼 수 있다").isTrue();

        UUID yesterday = db.entry(challenge, owner, Instant.parse("2026-11-24T14:59:59.999999Z"));
        UUID todayDeleted = db.entry(challenge, owner, Instant.parse("2026-11-24T15:00:00Z"));
        db.jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=now(),video_id=NULL WHERE id=?", todayDeleted);
        assertRefused(() -> entries.create(owner, challenge, UUID.randomUUID(), "a".repeat(64),
                new NewEntry(db.video(owner), null, "public", false), now), 429, "daily_entry_limit");
        db.jdbc.update("UPDATE challenge_entries SET created_at=? WHERE id=?",
                ChallengeStoreFixture.utc(Instant.parse("2026-11-24T14:59:59.999999Z")), todayDeleted);
        assertThat(entries.create(owner, challenge, UUID.randomUUID(), "a".repeat(64), new NewEntry(db.video(owner), null, "public", false),
                now).created()).as("어제 것은 세지 않는다").isTrue();
        assertThat(db.jdbc.queryForObject("SELECT status FROM challenge_entries WHERE id=?", String.class, yesterday)).isEqualTo("visible");
    }

    // ---- 고치기 ----

    @Test
    @DisplayName("update: 캡션이 바뀌면 내용 버전을 올리고 공개 중이면 다시 검사 차례로 둔다. 같은 캡션은 그대로다. 빈 문자열은 캡션을 지운다")
    void updateCaption() {
        UUID entry = db.entry(challenge, owner, now.minus(Duration.ofHours(1)));
        db.jdbc.update("UPDATE challenge_entries SET caption='처음',moderation_status='passed',moderation_attempts=2 WHERE id=?", entry);

        MyEntry same = entries.update(owner, entry, "처음", null, null, now);
        assertThat(same.contentVersion()).isEqualTo(1);
        assertThat(moderation(entry)).isEqualTo("passed/2");
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(now.minus(Duration.ofHours(1)));

        MyEntry changed = entries.update(owner, entry, "고친 설명", null, null, now);
        assertThat(changed.caption()).isEqualTo("고친 설명");
        assertThat(changed.contentVersion()).isEqualTo(2);
        assertThat(moderation(entry)).isEqualTo("pending/0");
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(now);

        db.jdbc.update("UPDATE challenge_entries SET moderation_status='passed',visibility='private' WHERE id=?", entry);
        MyEntry cleared = entries.update(owner, entry, "", null, null, now.plusSeconds(1));
        assertThat(cleared.caption()).isNull();
        assertThat(cleared.contentVersion()).isEqualTo(3);
        assertThat(moderation(entry)).as("비공개면 검사 차례로 두지 않는다").isEqualTo("passed/0");
        assertRefused(() -> entries.update(db.member("남"), entry, "남의 것", null, null, now), 404, "entry_not_found");
    }

    @Test
    @DisplayName("update: 처음 공개할 때만 공개 시각을 적고 검사 차례로 둔다. 비공개로 돌렸다 다시 공개해도 공개 시각과 검사 결과는 그대로다. 숨겨진 참여작과 끝난 챌린지에서는 공개할 수 없다")
    void updateVisibility() {
        UUID video = db.video(owner);
        UUID entry = entries.create(owner, challenge, UUID.randomUUID(), "a".repeat(64), new NewEntry(video, null, "private", false),
                now).entry().id();

        Instant published = now.plusSeconds(60);
        assertThat(entries.update(owner, entry, null, "public", null, published).publishedAt()).isEqualTo(published);
        assertThat(moderation(entry)).isEqualTo("pending/0");
        db.jdbc.update("UPDATE challenge_entries SET moderation_status='passed',moderation_attempts=1 WHERE id=?", entry);

        assertThat(entries.update(owner, entry, null, "private", null, now.plusSeconds(120)).visibility()).isEqualTo("private");
        MyEntry reopened = entries.update(owner, entry, null, "public", null, now.plusSeconds(180));
        assertThat(reopened.publishedAt()).as("처음 공개한 시각이 남는다").isEqualTo(published);
        assertThat(moderation(entry)).as("다시 여는 것만으로는 검사하지 않는다").isEqualTo("passed/1");
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(now.plusSeconds(180));

        db.jdbc.update("UPDATE challenge_entries SET visibility='private',status='hidden_by_report' WHERE id=?", entry);
        assertRefused(() -> entries.update(owner, entry, null, "public", null, now), 422, "entry_hidden");
        db.jdbc.update("UPDATE challenge_entries SET status='visible' WHERE id=?", entry);
        db.jdbc.update("UPDATE videos SET purged_at=now() WHERE id=?", video);
        assertRefused(() -> entries.update(owner, entry, null, "public", null, now), 422, "video_not_ready");
        db.jdbc.update("UPDATE videos SET purged_at=NULL WHERE id=?", video);
        db.jdbc.update("UPDATE challenges SET moderation='review' WHERE id=?", challenge);
        assertRefused(() -> entries.update(owner, entry, null, "public", null, now), 422, "challenge_closed");
        assertThat(db.jdbc.queryForObject("SELECT visibility FROM challenge_entries WHERE id=?", String.class, entry)).isEqualTo("private");
    }

    // ---- 지우기 ----

    @Test
    @DisplayName("delete: 행은 남기고 캡션·영상 참조를 비운다. 그 참여작의 알림·좋아요·저장을 지우고, 댓글과 신고 사본·AI 리포트의 본문을 파기하고, 진행 중인 리포트 작업을 취소하고, 모자이크본을 정리 장부에 올린다")
    void deleteClearsEverythingAttached() {
        UUID entry = db.entry(challenge, owner, now.minus(Duration.ofHours(1)));
        UUID kept = db.entry(challenge, owner, now.minus(Duration.ofHours(2)));
        UUID fan = db.member("팬");
        db.jdbc.update("UPDATE challenge_entries SET caption='설명',face_mosaic=true,mosaic_status='ready',mosaic_key='mosaic/1' WHERE id=?",
                entry);
        for (UUID target : List.of(entry, kept)) {
            db.jdbc.update("INSERT INTO entry_likes(id,entry_id,user_id) VALUES (gen_random_uuid(),?,?)", target, fan);
            db.jdbc.update("INSERT INTO entry_saves(id,entry_id,user_id) VALUES (gen_random_uuid(),?,?)", target, fan);
            UUID comment = UUID.randomUUID();
            db.jdbc.update("INSERT INTO entry_comments(id,entry_id,user_id,body,request_id,request_fingerprint) "
                    + "VALUES (?,?,?,'댓글',gen_random_uuid(),repeat('0',64))", comment, target, fan);
            for (Object[] report : List.of(new Object[] {"entry", target}, new Object[] {"comment", comment})) {
                db.jdbc.update("INSERT INTO entry_reports(id,target_type,target_id,reporter_id,reason,status,target_version,target_text,"
                        + "request_id,request_fingerprint) VALUES (gen_random_uuid(),?,?,?,'spam','received',1,'사본',gen_random_uuid(),"
                        + "repeat('0',64))", report[0], report[1], db.member("신고자"));
            }
            db.jdbc.update("INSERT INTO notifications(id,user_id,kind,challenge_id,entry_id,event_key,group_key,created_at,expires_at,"
                    + "push_status) VALUES (gen_random_uuid(),?,'entry_ai_report_ready',?,?,?,'g',now(),now()+interval '90 days','skipped')",
                    owner, challenge, target, "ai_report:" + target);
            UUID job = UUID.randomUUID();
            db.jdbc.update("INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,attempt_count,"
                    + "lease_token,lease_expires_at) VALUES (?,?,'challenge_report',?,gen_random_uuid(),repeat('0',64),'running',1,"
                    + "gen_random_uuid(),now())", job, owner, target);
            db.jdbc.update("INSERT INTO entry_ai_reports(id,entry_id,user_id,job_id,status,requested_at,result) "
                    + "VALUES (gen_random_uuid(),?,?,?,'ready',now(),'{\"observations\":[]}'::jsonb)", target, owner, job);
        }
        Instant precise = now.plusNanos(123_456_789);

        entries.delete(owner, entry, precise);

        Instant rounded = now.plusNanos(123_457_000);
        assertThat(db.jdbc.queryForMap("SELECT status,caption,video_id,mosaic_key,mosaic_status,face_mosaic FROM challenge_entries WHERE id=?",
                entry)).containsEntry("status", "deleted").containsEntry("caption", null).containsEntry("video_id", null)
                .containsEntry("mosaic_key", null).containsEntry("mosaic_status", "failed").containsEntry("face_mosaic", true);
        assertThat(db.instant("SELECT deleted_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(rounded);
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(rounded);
        for (String table : List.of("entry_likes", "entry_saves", "notifications")) {
            assertThat(db.jdbc.queryForList("SELECT entry_id FROM " + table, UUID.class)).as(table).containsExactly(kept);
        }
        assertThat(db.jdbc.queryForList("SELECT body IS NULL AND deleted_at IS NOT NULL FROM entry_comments ORDER BY (entry_id=?) DESC",
                Boolean.class, entry)).containsExactly(true, false);
        assertThat(db.instant("SELECT deleted_at FROM entry_comments WHERE entry_id=?", entry)).isEqualTo(rounded);
        assertThat(db.jdbc.queryForObject("SELECT count(*) FROM entry_reports WHERE target_text IS NULL", Integer.class)).isEqualTo(2);
        assertThat(db.jdbc.queryForObject("SELECT count(*) FROM entry_reports", Integer.class)).as("신고 행은 남는다").isEqualTo(4);
        assertThat(db.jdbc.queryForMap("SELECT result IS NULL AS purged,status FROM entry_ai_reports WHERE entry_id=?", entry))
                .containsEntry("purged", true).containsEntry("status", "ready");
        assertThat(db.instant("SELECT purged_at FROM entry_ai_reports WHERE entry_id=?", entry)).isEqualTo(rounded);
        assertThat(db.jdbc.queryForObject("SELECT result IS NOT NULL AND purged_at IS NULL FROM entry_ai_reports WHERE entry_id=?",
                Boolean.class, kept)).isTrue();
        assertThat(db.jdbc.queryForList("SELECT status || '/' || coalesce(failure_reason,'-') || '/' || (lease_token IS NULL) "
                + "FROM ai_jobs ORDER BY (target_id=?) DESC", String.class, entry)).containsExactly("failed/cancelled/true", "running/-/false");
        assertThat(db.count("account_cleanup_operations")).as("모자이크본 정리").isEqualTo(1);

        entries.delete(owner, entry, now.plusSeconds(600));
        assertThat(db.instant("SELECT deleted_at FROM challenge_entries WHERE id=?", entry)).as("다시 지워도 그대로다").isEqualTo(rounded);
        assertRefused(() -> entries.delete(db.member("남"), kept, now), 404, "entry_not_found");
        assertRefused(() -> entries.delete(owner, UUID.randomUUID(), now), 404, "entry_not_found");
    }

    // ---- 얼굴 모자이크 ----

    @Test
    @DisplayName("update(모자이크): 켜면 만드는 중으로 두고(실패한 것은 시도 수를 비워 다시), 이미 만드는 중·준비된 것은 그대로다. 끄면 만든 사본을 정리 장부에 올리고 상태를 비운다")
    void mosaicToggle() {
        UUID entry = db.entry(challenge, owner, now.minus(Duration.ofHours(1)));

        assertThat(entries.update(owner, entry, null, null, true, now).mosaicStatus()).isEqualTo("pending");
        db.jdbc.update("UPDATE challenge_entries SET mosaic_status='ready',mosaic_key='mosaic/1',mosaic_attempts=1 WHERE id=?", entry);
        entries.update(owner, entry, null, null, true, now.plusSeconds(1));
        assertThat(mosaic(entry)).as("준비된 것은 그대로").isEqualTo("true/ready/mosaic/1/1");
        db.jdbc.update("UPDATE challenge_entries SET mosaic_status='failed',mosaic_key=NULL,mosaic_attempts=3 WHERE id=?", entry);
        entries.update(owner, entry, null, null, true, now.plusSeconds(2));
        assertThat(mosaic(entry)).as("실패한 것은 다시 만든다").isEqualTo("true/pending/null/0");

        db.jdbc.update("UPDATE challenge_entries SET mosaic_status='ready',mosaic_key='mosaic/2' WHERE id=?", entry);
        MyEntry off = entries.update(owner, entry, null, null, false, now.plusSeconds(3));
        assertThat(off.faceMosaic()).isFalse();
        assertThat(mosaic(entry)).isEqualTo("false/null/null/0");
        assertThat(db.count("account_cleanup_operations")).isEqualTo(1);
        entries.update(owner, entry, null, null, false, now.plusSeconds(4));
        assertThat(db.count("account_cleanup_operations")).as("만든 것이 없으면 올릴 것도 없다").isEqualTo(1);
    }

    @Test
    @DisplayName("모자이크 작업: 집으면 시도 수가 오르고, 붙이면 준비(ready)가 된다. 실패·건너뛰기는 집은 그 시도일 때만 적용된다. 상한에 닿은 채 남은 것은 다음 집기가 실패로 닫는다")
    void mosaicJobs() {
        UUID entry = db.entry(challenge, owner, now.minus(Duration.ofHours(1)));
        db.jdbc.update("UPDATE challenge_entries SET face_mosaic=true,mosaic_status='pending' WHERE id=?", entry);
        UUID video = db.jdbc.queryForObject("SELECT video_id FROM challenge_entries WHERE id=?", UUID.class, entry);

        MosaicJob first = entries.claimMosaic(3, now);
        assertThat(first).isEqualTo(new MosaicJob(entry, owner, "videos/" + video, 1));
        MosaicJob second = entries.claimMosaic(3, now);
        entries.failMosaic(first, now);
        entries.skipMosaic(first, now);
        assertThat(mosaic(entry)).as("앞선 시도의 결과는 버린다").isEqualTo("true/pending/null/2");

        assertThat(entries.attachMosaic(second, "mosaic/ready", now.plusSeconds(5))).isEmpty();
        assertThat(mosaic(entry)).isEqualTo("true/ready/mosaic/ready/2");
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(now.plusSeconds(5));
        assertThat(entries.attachMosaic(second, "mosaic/late", now)).as("이미 붙은 뒤의 사본은 정리 장부로 간다").hasSize(1);
        assertThat(mosaic(entry)).isEqualTo("true/ready/mosaic/ready/2");

        UUID failing = db.entry(challenge, owner, now.minus(Duration.ofHours(2)));
        db.jdbc.update("UPDATE challenge_entries SET face_mosaic=true,mosaic_status='pending' WHERE id=?", failing);
        MosaicJob job = entries.claimMosaic(3, now);
        entries.failMosaic(job, now.plusSeconds(6));
        assertThat(mosaic(failing)).isEqualTo("true/failed/null/1");
        db.jdbc.update("UPDATE challenge_entries SET mosaic_status='pending' WHERE id=?", failing);
        entries.skipMosaic(job, now.plusSeconds(7));
        assertThat(mosaic(failing)).as("가릴 얼굴이 없으면 끈다").isEqualTo("false/null/null/1");

        UUID stuck = db.entry(challenge, owner, now.minus(Duration.ofHours(3)));
        db.jdbc.update("UPDATE challenge_entries SET face_mosaic=true,mosaic_status='pending',mosaic_attempts=3 WHERE id=?", stuck);
        assertThat(entries.claimMosaic(3, now.plusSeconds(8))).isNull();
        assertThat(mosaic(stuck)).isEqualTo("true/failed/null/3");
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", stuck)).isEqualTo(now.plusSeconds(8));
    }

    // ---- 잠금과 경합 ----

    @Test
    @DisplayName("고치기·지우기는 사용자 → 챌린지 → 참여작 순서로 FOR UPDATE 를 잡는다. 모자이크본 붙이기는 사용자 → 참여작 → 영상(FOR SHARE) 순서다")
    void ownEntryLocks() throws Exception {
        UUID entry = db.entry(challenge, owner, now.minus(Duration.ofHours(1)));
        db.jdbc.update("UPDATE challenge_entries SET face_mosaic=true,mosaic_status='pending' WHERE id=?", entry);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenges WHERE id=? FOR KEY SHARE", challenge);
            Future<MyEntry> onChallenge = pool.submit(() -> entries.update(owner, entry, "챌린지 뒤", null, null, now));
            String waitingOnChallenge = db.awaitWaiting("from challenges");
            assertThat(db.locked("users", owner)).isTrue();
            assertThat(db.locked("challenge_entries", entry)).isFalse();
            probe.rollback();
            onChallenge.get(20, TimeUnit.SECONDS);

            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenge_entries WHERE id=? FOR KEY SHARE", entry);
            Future<MyEntry> onEntry = pool.submit(() -> entries.update(owner, entry, "참여작 뒤", null, null, now));
            String waitingOnEntry = db.awaitWaiting("from challenge_entries");
            assertThat(db.locked("challenges", challenge)).isTrue();
            probe.rollback();
            onEntry.get(20, TimeUnit.SECONDS);

            MosaicJob job = entries.claimMosaic(3, now);
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenge_entries WHERE id=? FOR KEY SHARE", entry);
            Future<List<UUID>> attaching = pool.submit(() -> entries.attachMosaic(job, "mosaic/1", now));
            String waitingOnAttach = db.awaitWaiting("from challenge_entries");
            assertThat(db.locked("users", owner)).isTrue();
            probe.rollback();
            assertThat(attaching.get(20, TimeUnit.SECONDS)).isEmpty();

            for (String waiting : List.of(waitingOnChallenge, waitingOnEntry, waitingOnAttach)) {
                assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("지우기가 먼저 잡으면 같은 참여작의 고치기는 기다렸다가 404 entry_not_found 를 받는다 — 지운 참여작에 캡션이 다시 생기지 않는다")
    void anUpdateBehindADeleteIsRefused() throws Exception {
        UUID entry = db.entry(challenge, owner, now.minus(Duration.ofHours(1)));
        CountDownLatch deleted = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> deleting = pool.submit(() -> db.inTransaction(() -> {
                entries.delete(owner, entry, now);
                deleted.countDown();
                ChallengeStoreFixture.await(release);
            }));
            ChallengeStoreFixture.await(deleted);
            Future<Object> updating = pool.submit(() -> {
                try {
                    return entries.update(owner, entry, "늦은 캡션", null, null, now);
                } catch (ApiException refused) {
                    return refused;
                }
            });
            db.awaitWaiting("from users");
            release.countDown();
            deleting.get(20, TimeUnit.SECONDS);

            assertThat(updating.get(20, TimeUnit.SECONDS)).isInstanceOfSatisfying(ApiException.class,
                    refused -> assertThat(refused.getMessage()).isEqualTo("entry_not_found"));
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.jdbc.queryForMap("SELECT status,caption FROM challenge_entries WHERE id=?", entry))
                .containsEntry("status", "deleted").containsEntry("caption", null);
    }

    // ---- 문장 ----

    @Test
    @DisplayName("나가는 문장: 올리기는 사용자 잠금 → 재전송 확인 → 챌린지 잠금 → 영상 잠금 → 중복·하루 수 → 넣기 → 읽기. 고치기·지우기는 사용자 → 찾기 → 챌린지 → 참여작 잠금 뒤 표마다 한 문장이다")
    void statements() {
        String user = "select users for update";
        // 본인 참여작 한 건을 읽는 카드 문장은 select 절의 좋아요 수 서브쿼리가 먼저 나와, 줄인 이름에 그 표(entry_likes)가 붙는다.
        String mine = "select entry_likes";
        // 만들어 둔 공유 프레임을 비우는 문장(SOMA-1156). 모자이크 상태가 바뀌거나 참여작을 지울 때 한 번 나간다.
        String dropFrames = "with select challenge_entries returning";
        List<String> lockOwn = List.of("select challenge_entries", "select challenges for update", "select challenge_entries for update");
        UUID request = UUID.randomUUID();
        UUID video = db.video(owner);

        assertThat(db.statementsOf(() -> entries.create(owner, challenge, request, "a".repeat(64),
                new NewEntry(video, null, "private", false), now))).containsExactly(user, "select challenge_entries",
                "select challenges for update", "select videos for update", "count challenge_entries", "count challenge_entries",
                "insert challenge_entries", mine);
        assertThat(db.statementsOf(() -> entries.create(owner, challenge, request, "a".repeat(64),
                new NewEntry(video, null, "private", false), now))).as("재전송").containsExactly(user, "select challenge_entries", mine);
        UUID entry = db.jdbc.queryForObject("SELECT id FROM challenge_entries", UUID.class);

        assertThat(db.statementsOf(() -> entries.update(owner, entry, "설명", null, null, now))).as("캡션")
                .containsExactlyElementsOf(concat(List.of(user), lockOwn, List.of("update challenge_entries", "update challenge_entries", mine)));
        assertThat(db.statementsOf(() -> entries.update(owner, entry, null, "public", null, now))).as("공개")
                .containsExactlyElementsOf(concat(List.of(user), lockOwn, List.of("select challenges", "select videos for update",
                        "update challenge_entries", "update challenge_entries", mine)));
        assertThat(db.statementsOf(() -> entries.update(owner, entry, null, "private", null, now))).as("비공개")
                .containsExactlyElementsOf(concat(List.of(user), lockOwn, List.of("update challenge_entries", "update challenge_entries", mine)));
        assertThat(db.statementsOf(() -> entries.update(owner, entry, null, null, true, now))).as("모자이크 켜기")
                .containsExactlyElementsOf(concat(List.of(user), lockOwn,
                        List.of("update challenge_entries", dropFrames, "update challenge_entries", mine)));

        MosaicJob job = db.statementsAndResult(() -> entries.claimMosaic(3, now), sent -> assertThat(sent).containsExactly(
                "update challenge_entries", "with select challenge_entries for update skip locked returning"));
        assertThat(db.statementsOf(() -> entries.attachMosaic(job, "mosaic/1", now))).containsExactly(user,
                "select challenge_entries for update", "select videos for share", "update challenge_entries", dropFrames);
        assertThat(db.statementsOf(() -> entries.failMosaic(job, now))).containsExactly("update challenge_entries");
        assertThat(db.statementsOf(() -> entries.skipMosaic(job, now))).containsExactly("update challenge_entries");
        assertThat(db.statementsOf(() -> entries.update(owner, entry, null, null, false, now))).as("모자이크 끄기(사본 있음)")
                .containsExactlyElementsOf(concat(List.of(user), lockOwn, List.of("select challenge_entries",
                        "insert account_cleanup_operations", "update challenge_entries", "update challenge_entries", dropFrames,
                        "update challenge_entries", mine)));

        assertThat(db.statementsOf(() -> entries.delete(owner, entry, now))).containsExactlyElementsOf(concat(
                List.of(user, "select challenge_entries"), lockOwn, List.of("delete notifications", "update entry_ai_reports",
                        "update ai_jobs", "delete entry_likes", "delete entry_saves", "update entry_reports", "update entry_comments",
                        "select challenge_entries", dropFrames, "update challenge_entries")));
        assertThat(db.statementsOf(() -> entries.delete(owner, entry, now))).as("이미 지운 것")
                .containsExactly(user, "select challenge_entries");
    }

    // ---- 도움 ----

    /** "<AI 검사 상태>/<시도 수>". */
    private String moderation(UUID entry) {
        return db.jdbc.queryForObject("SELECT moderation_status || '/' || moderation_attempts FROM challenge_entries WHERE id=?",
                String.class, entry);
    }

    /** "<모자이크 켬>/<상태>/<사본 키>/<시도 수>". */
    private String mosaic(UUID entry) {
        return db.jdbc.queryForObject("SELECT face_mosaic || '/' || coalesce(mosaic_status,'null') || '/' || coalesce(mosaic_key,'null') "
                + "|| '/' || mosaic_attempts FROM challenge_entries WHERE id=?", String.class, entry);
    }

    @SafeVarargs
    private static List<String> concat(List<String>... parts) {
        return java.util.Arrays.stream(parts).flatMap(List::stream).toList();
    }

    private static void assertRefused(Runnable call, int status, String detail) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, refused -> {
            assertThat(refused.status()).isEqualTo(status);
            assertThat(refused.getMessage()).isEqualTo(detail);
        });
    }
}
