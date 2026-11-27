package com.acttub.actingapi.feature.video;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.feature.video.app.VideoOwnership;
import com.acttub.actingapi.feature.video.app.VideoRepository;
import com.acttub.actingapi.feature.video.app.VideoRepository.CompleteOutcome;
import com.acttub.actingapi.feature.video.app.VideoRepository.Completed;
import com.acttub.actingapi.feature.video.app.VideoRepository.NewIntent;
import com.acttub.actingapi.feature.video.app.VideoRepository.PosterJob;
import com.acttub.actingapi.feature.video.app.VideoRepository.RemoveOutcome;
import com.acttub.actingapi.feature.video.app.VideoRepository.Removed;
import com.acttub.actingapi.feature.video.app.VideoRepository.ReserveOutcome;
import com.acttub.actingapi.feature.video.app.VideoStorage;
import com.acttub.actingapi.feature.video.app.VideoViews.VideoView;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.assertj.core.api.SoftAssertions;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 보관함 저장소({@code PostgresVideoRepository}·{@code PostgresVideoOwnership})가 내는 결과·잠금·경합·문장 수를 실제
 * PostgreSQL 에서 고정한다. 자기 표({@code videos}·{@code video_transcripts})만 쓰는 문장을 네이티브 SQL 에서 JPA 로 옮길 때
 * 네이티브 구현에서 먼저 통과시킨 이 테스트가 그대로 통과했다(apps/api/CONTRACT.md §5-9). 문장 테스트만 달라졌다 — 영상 행 잠금이
 * {@code for update} 에서 {@code for update of ve1_0} 로 나간다(문장 수·세기는 같다). 은퇴한 예약 장부
 * ({@code upload_intents})와 다른 기능의 표를 쓰는 문장은 네이티브로 남겨 문장 테스트에서만 본다.
 *
 * <p>HTTP 를 거친 올리기·마무리·총량 경합·목록·삭제·파기·포스터·이관은 {@link VideoLibraryIT}, 시한 지난 예약 치우기는
 * {@link UploadIntentSweepIT} 가 본다. 여기서는 그 테스트가 밟지 않는 영상 행의 모든 칸과 시각의 정밀도, 총량의 경계(같으면
 * 통과, 파기한 영상과 남의 영상은 세지 않음), 장부에 올리는 객체 키, 받아쓰기는 그 영상의 것만 지움, 포스터를 붙여도
 * {@code updated_at} 은 그대로, 영상 행 잠금의 세기, 삭제와 회차 시작의 경합, 포트 메서드마다 나가는 문장을 본다. 장부는
 * 부른 값을 적어 두는 가짜로 바꿔 어떤 키가 올랐는지 본다(트랜잭션은 같다).
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "VIDEO_POSTER_ENABLED=false",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.video.VideoRepositoryIT$Recorder"
})
@Import(VideoRepositoryIT.Fixture.class)
// 이 클래스만 쓰는 설정(StatementInspector, 장부 가짜)이라 끝나면 닫는다.
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class VideoRepositoryIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    /** 장부에 올린 요청을 적어 둔다. */
    static final class RecordingCleanup implements VideoObjectCleanup {
        record Scheduled(UUID userId, List<String> keys) {
        }

        final List<Scheduled> scheduled = new CopyOnWriteArrayList<>();

        @Override
        public UUID scheduleObjectDelete(UUID userId, List<String> objectKeys, Instant now, Instant notBefore) {
            scheduled.add(new Scheduled(userId, List.copyOf(objectKeys)));
            return UUID.randomUUID();
        }

        @Override
        public void attemptObjectDelete(List<UUID> operationIds) {
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Fixture {
        @Bean
        @Primary
        RecordingCleanup recordingCleanup() {
            return new RecordingCleanup();
        }
    }

    private static final long QUOTA = 10_000L;

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    VideoRepository videos;

    @Autowired
    VideoOwnership ownership;

    @Autowired
    RecordingCleanup cleanup;

    @Autowired
    PlatformTransactionManager transactionManager;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");

    @BeforeEach
    void setUp() {
        jdbc.execute("DROP TRIGGER IF EXISTS hold_video_insert ON videos");
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        cleanup.scheduled.clear();
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 확정과 총량 ----

    @Test
    @DisplayName("complete 는 영상 행의 모든 칸을 적는다. 두 시각은 넘긴 시각을 마이크로초로 반올림한 값이고 돌려준 영상은 저장된 행과 같다")
    void completeWritesEveryVideoColumn() {
        UUID owner = member();
        NewIntent asked = intent(1_000, 5_000);
        UUID intent = videos.reserve(owner, asked, QUOTA, now).intentId();
        Instant at = now.plusNanos(123_456_789);

        Completed completed = videos.complete(owner, intent, new VideoStorage.Stored(1_000, "etag-1"), QUOTA, at);

        Instant rounded = now.plus(123_457, ChronoUnit.MICROS);
        assertThat(completed.outcome()).isEqualTo(CompleteOutcome.CREATED);
        VideoView view = completed.video();
        assertThat(view).isEqualTo(videos.find(owner, view.id()));
        assertThat(view).isEqualTo(new VideoView(view.id(), asked.objectKey(), "video/mp4", 1_000, 5_000, false,
                null, rounded, 0, 0, null, null, null, null));
        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM videos WHERE id=?", view.id());
        assertThat(row).containsEntry("user_id", owner).containsEntry("favorite", false)
                .containsEntry("purged_at", null).containsEntry("poster_key", null);
        assertThat(jdbc.queryForObject("SELECT poster_attempts FROM videos WHERE id=?", Integer.class, view.id())).isZero();
        assertThat(instant("SELECT updated_at FROM videos WHERE id=?", view.id())).isEqualTo(rounded);
        assertThat(jdbc.queryForMap("SELECT status, etag, video_id FROM upload_intents WHERE id=?", intent))
                .containsEntry("status", "finalized").containsEntry("etag", "etag-1").containsEntry("video_id", view.id());
        assertThat(cleanup.scheduled).isEmpty();
    }

    @Test
    @DisplayName("complete 는 예약의 길이가 비어 있으면(옛 예약) 0 으로 적는다")
    void completeWritesZeroForAMissingDuration() {
        UUID owner = member();
        UUID intent = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,'pending','s3',?,'video/mp4',700,?)
                """, intent, owner, "videos/legacy-" + intent + ".mp4", OffsetDateTime.ofInstant(now.plusSeconds(600), ZoneOffset.UTC));

        VideoView view = videos.complete(owner, intent, new VideoStorage.Stored(700, "etag-2"), QUOTA, now).video();

        assertThat(view.durationMs()).isZero();
        assertThat(jdbc.queryForObject("SELECT duration_ms FROM videos WHERE id=?", Integer.class, view.id())).isZero();
    }

    @Test
    @DisplayName("restamp 는 확정된 예약의 검증값과 영상의 크기·updated_at 을 고치고 확정 시각은 두며 고친 영상을 돌려준다. "
            + "남의 예약·확정 전 예약은 null 이고 바꾸지 않는다. 파기된 영상의 크기는 그대로다")
    void restampRewritesTheEtagAndTheSizeOfAFinalizedIntent() {
        UUID owner = member();
        UUID intent = videos.reserve(owner, intent(1_000, 5_000), QUOTA, now).intentId();
        UUID id = videos.complete(owner, intent, new VideoStorage.Stored(1_000, "etag-1"), QUOTA, now).video().id();
        UUID pending = videos.reserve(owner, intent(500, 1), QUOTA, now).intentId();
        Instant later = now.plusSeconds(2_000);

        assertThat(videos.restamp(member(), intent, new VideoStorage.Stored(1_200, "etag-x"), later)).as("남의 예약").isNull();
        assertThat(videos.restamp(owner, pending, new VideoStorage.Stored(500, "etag-x"), later)).as("확정 전").isNull();
        assertThat(jdbc.queryForObject("SELECT etag FROM upload_intents WHERE id=?", String.class, pending)).isNull();
        assertThat(jdbc.queryForObject("SELECT etag FROM upload_intents WHERE id=?", String.class, intent)).isEqualTo("etag-1");

        VideoView restamped = videos.restamp(owner, intent, new VideoStorage.Stored(1_200, "etag-2"), later);

        assertThat(restamped).isEqualTo(videos.find(owner, id));
        assertThat(restamped.byteSize()).isEqualTo(1_200);
        assertThat(instant("SELECT updated_at FROM videos WHERE id=?", id)).isEqualTo(later);
        assertThat(jdbc.queryForObject("SELECT etag FROM upload_intents WHERE id=?", String.class, intent)).isEqualTo("etag-2");
        assertThat(instant("SELECT finalized_at FROM upload_intents WHERE id=?", intent)).isEqualTo(now);

        videos.purgeFile(owner, id, later);
        videos.restamp(owner, intent, new VideoStorage.Stored(1_500, "etag-3"), later.plusSeconds(1));
        assertThat(jdbc.queryForObject("SELECT byte_size FROM videos WHERE id=?", Long.class, id)).isEqualTo(1_200L);
    }

    @Test
    @DisplayName("총량은 파기하지 않은 자기 영상의 바이트 합이다. 합이 상한과 같아지는 예약·확정은 통과하고 넘으면 QUOTA 다")
    void quotaCountsOnlyUnpurgedOwnBytesAndAllowsReachingTheLimit() {
        UUID owner = member();
        UUID other = member();
        video(owner, 4_000, now.minusSeconds(60), false);
        video(owner, 9_000, now.minusSeconds(50), true);
        video(other, 9_000, now.minusSeconds(40), false);

        assertThat(videos.reserve(owner, intent(6_001, 1), QUOTA, now).outcome()).isEqualTo(ReserveOutcome.QUOTA);
        UUID exact = videos.reserve(owner, intent(6_000, 1), QUOTA, now).intentId();
        assertThat(exact).isNotNull();
        NewIntent overAsked = intent(6_001, 1);
        UUID over = videos.reserve(owner, overAsked, QUOTA + 1, now).intentId();

        assertThat(videos.complete(owner, exact, new VideoStorage.Stored(6_000, "e"), QUOTA, now).outcome())
                .isEqualTo(CompleteOutcome.CREATED);
        assertThat(videos.complete(owner, over, new VideoStorage.Stored(6_001, "e"), QUOTA + 6_000, now).outcome())
                .as("상한을 1 바이트 넘는다").isEqualTo(CompleteOutcome.QUOTA);
        assertThat(cleanup.scheduled).extracting(RecordingCleanup.Scheduled::keys)
                .containsExactly(List.of(overAsked.objectKey()));
    }

    // ---- 즐겨찾기 ----

    @Test
    @DisplayName("setFavorite 는 즐겨찾기와 updated_at 을 바꾸고 바뀐 영상을 낸다. 남의 영상·없는 영상은 null 이고 바꾸지 않는다")
    void setFavoriteChangesOnlyOwnVideos() {
        UUID owner = member();
        UUID other = member();
        UUID id = video(owner, 100, now.minusSeconds(60), false);
        Instant at = now.plusNanos(1_500);

        VideoView changed = videos.setFavorite(owner, id, true, at);

        assertThat(changed).isEqualTo(videos.find(owner, id));
        assertThat(changed.favorite()).isTrue();
        assertThat(instant("SELECT updated_at FROM videos WHERE id=?", id)).isEqualTo(now.plus(2, ChronoUnit.MICROS));
        assertThat(videos.setFavorite(other, id, false, now)).isNull();
        assertThat(videos.setFavorite(owner, UUID.randomUUID(), false, now)).isNull();
        assertThat(jdbc.queryForObject("SELECT favorite FROM videos WHERE id=?", Boolean.class, id)).isTrue();
        assertThat(videos.setFavorite(owner, id, false, now).favorite()).isFalse();
    }

    // ---- 삭제와 파기 ----

    @Test
    @DisplayName("delete 는 그 영상의 받아쓰기(영상당 하나)만 지우고 예약의 영상 참조를 비운 뒤 행을 지우며, 영상과 포스터 키를 장부에 올린다")
    void deleteRemovesOnlyThisVideosRowsAndSchedulesBothKeys() {
        UUID owner = member();
        UUID id = videos.complete(owner, videos.reserve(owner, intent(100, 1), QUOTA, now).intentId(),
                new VideoStorage.Stored(100, "e"), QUOTA, now).video().id();
        jdbc.update("UPDATE videos SET poster_key=? WHERE id=?", "posters/" + id + ".jpg", id);
        UUID kept = video(owner, 100, now, false);
        transcript(id);
        transcript(kept);

        Removed removed = videos.delete(owner, id, now);

        assertThat(removed.outcome()).isEqualTo(RemoveOutcome.DELETED);
        assertThat(removed.video()).isNull();
        assertThat(removed.cleanupOperationIds()).hasSize(1);
        assertThat(cleanup.scheduled).containsExactly(new RecordingCleanup.Scheduled(owner,
                List.of(jdbc.queryForObject("SELECT object_key FROM upload_intents WHERE user_id=?", String.class, owner),
                        "posters/" + id + ".jpg")));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM videos WHERE id=?", Integer.class, id)).isZero();
        assertThat(jdbc.queryForList("SELECT video_id FROM video_transcripts", UUID.class)).containsExactly(kept);
        assertThat(jdbc.queryForObject("SELECT video_id FROM upload_intents WHERE user_id=?", UUID.class, owner)).isNull();
    }

    @Test
    @DisplayName("delete 는 파기한 영상이면 장부에 올리지 않고, 참조가 있으면 IN_USE, 남의 영상·없는 영상은 NOT_FOUND 이고 아무것도 바꾸지 않는다")
    void deleteOutcomes() {
        UUID owner = member();
        UUID purged = video(owner, 100, now, true);
        UUID used = video(owner, 100, now, false);
        practice(owner, used);
        transcript(used);

        assertThat(videos.delete(owner, purged, now)).isEqualTo(new Removed(RemoveOutcome.DELETED, null, List.of()));
        assertThat(cleanup.scheduled).isEmpty();
        assertThat(videos.delete(owner, used, now)).isEqualTo(new Removed(RemoveOutcome.IN_USE, null, List.of()));
        assertThat(videos.delete(member(), used, now)).isEqualTo(new Removed(RemoveOutcome.NOT_FOUND, null, List.of()));
        assertThat(videos.delete(owner, UUID.randomUUID(), now)).isEqualTo(new Removed(RemoveOutcome.NOT_FOUND, null, List.of()));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM video_transcripts WHERE video_id=?", Integer.class, used)).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT id FROM videos", UUID.class)).containsExactly(used);
    }

    @Test
    @DisplayName("purgeFile 은 그 영상의 받아쓰기를 지우고 purged_at·updated_at 을 적으며, 영상·포스터·참여작 모자이크본 키를 장부에 올린다. 다시 부르면 같은 답이고 장부에 다시 올리지 않는다")
    void purgeFileMarksTheVideoAndSchedulesEveryDerivedKey() {
        UUID owner = member();
        UUID id = video(owner, 100, now.minusSeconds(60), false);
        jdbc.update("UPDATE videos SET poster_key=? WHERE id=?", "posters/" + id + ".jpg", id);
        UUID kept = video(owner, 100, now, false);
        transcript(id);
        transcript(kept);
        entry(challenge(), owner, id, "mosaics/" + id + ".mp4");
        entry(challenge(), owner, id, null);
        Instant at = now.plusNanos(999);

        Removed purged = videos.purgeFile(owner, id, at);

        Instant rounded = now.plus(1, ChronoUnit.MICROS);
        assertThat(purged.outcome()).isEqualTo(RemoveOutcome.PURGED);
        assertThat(purged.video()).isEqualTo(videos.find(owner, id));
        assertThat(purged.video().purgedAt()).isEqualTo(rounded);
        assertThat(purged.video().entryCount()).isEqualTo(2);
        assertThat(instant("SELECT updated_at FROM videos WHERE id=?", id)).isEqualTo(rounded);
        assertThat(cleanup.scheduled).containsExactly(new RecordingCleanup.Scheduled(owner,
                List.of("videos/" + id + ".mp4", "posters/" + id + ".jpg", "mosaics/" + id + ".mp4")));
        assertThat(jdbc.queryForList("SELECT video_id FROM video_transcripts", UUID.class)).containsExactly(kept);

        Removed again = videos.purgeFile(owner, id, now.plusSeconds(60));
        assertThat(again).isEqualTo(new Removed(RemoveOutcome.PURGED, purged.video(), List.of()));
        assertThat(cleanup.scheduled).hasSize(1);
        assertThat(videos.purgeFile(member(), kept, now).outcome()).isEqualTo(RemoveOutcome.NOT_FOUND);
    }

    // ---- 포스터 ----

    @Test
    @DisplayName("attachPoster 는 활성 주인의 파기 안 된 영상에 키만 적고 updated_at 은 두며 장부에 올리지 않는다")
    void attachPosterWritesOnlyTheKey() {
        UUID owner = member();
        UUID id = video(owner, 100, now.minusSeconds(60), false);
        Instant before = instant("SELECT updated_at FROM videos WHERE id=?", id);

        assertThat(videos.attachPoster(new PosterJob(id, owner, "videos/" + id + ".mp4", 1), "posters/a.jpg", now)).isEmpty();

        assertThat(jdbc.queryForObject("SELECT poster_key FROM videos WHERE id=?", String.class, id)).isEqualTo("posters/a.jpg");
        assertThat(instant("SELECT updated_at FROM videos WHERE id=?", id)).isEqualTo(before);
        assertThat(cleanup.scheduled).isEmpty();
    }

    @Test
    @DisplayName("attachPoster 는 영상이 파기·삭제됐거나 주인이 바뀌었거나 계정이 활성이 아니면 붙이지 않고 포스터 키를 장부에 올린다")
    void attachPosterRefusesAndSchedulesThePoster() {
        UUID owner = member();
        UUID purged = video(owner, 100, now, true);
        UUID moved = video(member(), 100, now, false);
        UUID inactiveOwner = member();
        UUID inactive = video(inactiveOwner, 100, now, false);
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", inactiveOwner);

        for (PosterJob job : List.of(new PosterJob(purged, owner, "k", 1), new PosterJob(UUID.randomUUID(), owner, "k", 1),
                new PosterJob(moved, owner, "k", 1), new PosterJob(inactive, inactiveOwner, "k", 1))) {
            assertThat(videos.attachPoster(job, "posters/" + job.videoId() + ".jpg", now)).hasSize(1);
        }

        assertThat(cleanup.scheduled).extracting(RecordingCleanup.Scheduled::keys).hasSize(4)
                .allSatisfy(keys -> assertThat(keys).hasSize(1).allMatch(key -> key.startsWith("posters/")));
        assertThat(jdbc.queryForList("SELECT poster_key FROM videos WHERE poster_key IS NOT NULL", String.class)).isEmpty();
    }

    // ---- 잠금과 경합 ----

    @Test
    @DisplayName("delete·purgeFile·attachPoster 는 영상 행을 FOR UPDATE 로 잡는다: 바깥이 그 행을 FOR KEY SHARE 로 잡으면 그 뒤에서 기다린다")
    void removalsAndPosterLockTheVideoRowForUpdate() throws Exception {
        UUID owner = member();
        List<Supplier<Object>> calls = new ArrayList<>();
        UUID deleted = video(owner, 100, now, false);
        UUID purged = video(owner, 100, now, false);
        UUID postered = video(owner, 100, now, false);
        calls.add(() -> videos.delete(owner, deleted, now));
        calls.add(() -> videos.purgeFile(owner, purged, now));
        calls.add(() -> videos.attachPoster(new PosterJob(postered, owner, "k", 1), "posters/p.jpg", now));
        List<UUID> rows = List.of(deleted, purged, postered);

        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            for (int i = 0; i < calls.size(); i++) {
                lockVideo(probe, rows.get(i), "FOR KEY SHARE");
                Supplier<Object> call = calls.get(i);
                Future<Object> blocked = pool.submit(call::get);
                String waiting = awaitStatementWaitingOn("videos");
                probe.rollback();
                assertThat(waiting).startsWith("select").contains("from videos").contains("for update");
                blocked.get(20, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT id FROM videos ORDER BY purged_at NULLS FIRST", UUID.class))
                .containsExactly(postered, purged);
    }

    @Test
    @DisplayName("회차 시작이 그 영상을 가리키는 행을 넣는 중이면 delete 는 영상 행 잠금에서 기다렸다가, 커밋되면 IN_USE, 되돌려지면 지운다")
    void deleteWaitsForAPracticeThatStartsOnTheSameVideo() throws Exception {
        UUID owner = member();
        UUID committed = video(owner, 100, now, false);
        UUID rolledBack = video(owner, 100, now, false);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            insertPractice(probe, owner, committed);
            Future<Removed> blocked = pool.submit(() -> videos.delete(owner, committed, now));
            assertThat(awaitStatementWaitingOn("videos")).contains("for update");
            probe.commit();
            assertThat(blocked.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(RemoveOutcome.IN_USE);

            insertPractice(probe, owner, rolledBack);
            Future<Removed> later = pool.submit(() -> videos.delete(owner, rolledBack, now));
            awaitStatementWaitingOn("videos");
            probe.rollback();
            assertThat(later.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(RemoveOutcome.DELETED);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT id FROM videos", UUID.class)).containsExactly(committed);
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류")
    void eachPortMethodSendsTheseStatements() {
        SoftAssertions soft = new SoftAssertions();
        UUID owner = member();
        NewIntent first = intent(100, 1);
        UUID[] intent = new UUID[1];
        soft.assertThat(statementsOf(() -> intent[0] = videos.reserve(owner, first, QUOTA, now).intentId()))
                .as("새 예약").containsExactly("select upload_intents", "select videos", "insert upload_intents");
        soft.assertThat(statementsOf(() -> videos.reserve(owner, first, QUOTA, now)))
                .as("같은 요청의 재전송").containsExactly("select upload_intents");
        soft.assertThat(statementsOf(() -> videos.findIntent(owner, intent[0]))).containsExactly("select upload_intents");
        UUID[] video = new UUID[1];
        soft.assertThat(statementsOf(() -> video[0] = videos.complete(owner, intent[0], new VideoStorage.Stored(100, "e"),
                QUOTA, now).video().id()))
                .as("확정")
                .containsExactly("select users for update of ue1_0", "select upload_intents for update", "select videos",
                        "insert videos", "update upload_intents", "select videos");
        soft.assertThat(statementsOf(() -> videos.complete(owner, intent[0], new VideoStorage.Stored(100, "e"), QUOTA, now)))
                .as("확정된 예약의 재전송")
                .containsExactly("select users for update of ue1_0", "select upload_intents for update", "select videos");
        soft.assertThat(statementsOf(() -> videos.restamp(owner, intent[0], new VideoStorage.Stored(100, "e2"), now)))
                .as("같은 키에 다시 올라온 객체")
                .containsExactly("select users for update of ue1_0", "update upload_intents returning", "update videos",
                        "select videos");
        UUID late = videos.reserve(owner, intent(100, 1), QUOTA, now).intentId();
        soft.assertThat(statementsOf(() -> videos.expireIntent(owner, late, now)))
                .containsExactly("select upload_intents for update", "update upload_intents");
        soft.assertThat(statementsOf(() -> videos.sweepExpiredIntents(now)))
                .containsExactly("select upload_intents for update skip locked");
        soft.assertThat(statementsOf(() -> videos.list(owner, "all", null, 30, now))).containsExactly("select videos");
        soft.assertThat(statementsOf(() -> videos.find(owner, video[0]))).containsExactly("select videos");
        soft.assertThat(statementsOf(() -> videos.setFavorite(owner, video[0], true, now)))
                .containsExactly("update videos", "select videos");
        soft.assertThat(statementsOf(() -> videos.setFavorite(owner, UUID.randomUUID(), true, now)))
                .as("없는 영상이면 다시 읽지 않는다").containsExactly("update videos");
        soft.assertThat(statementsOf(() -> videos.attachPoster(new PosterJob(video[0], owner, "k", 1), "posters/p.jpg", now)))
                .containsExactly("select users for update of ue1_0", "select videos for update of ve1_0", "update videos");
        soft.assertThat(statementsOf(() -> videos.purgeFile(owner, video[0], now)))
                .containsExactly("select videos for update of ve1_0", "delete video_transcripts", "update videos",
                        "select challenge_entries", "select videos");
        soft.assertThat(statementsOf(() -> videos.delete(owner, video[0], now)))
                .containsExactly("select videos for update of ve1_0", "select (none)", "delete video_transcripts",
                        "update upload_intents", "delete videos");
        soft.assertThat(statementsOf(() -> videos.delete(owner, video[0], now)))
                .as("없으면 잠금 조회 하나").containsExactly("select videos for update of ve1_0");
        UUID used = video(owner, 100, now, false);
        practice(owner, used);
        soft.assertThat(statementsOf(() -> videos.delete(owner, used, now)))
                .as("참조가 있으면 지우지 않는다").containsExactly("select videos for update of ve1_0", "select (none)");
        soft.assertThat(statementsOf(() -> videos.claimPoster(3))).containsExactly("with select for update of v skip locked");
        UUID guest = member();
        soft.assertThat(statementsOf(() -> {
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> ownership.reassign(owner, guest));
            return null;
        })).containsExactly("update upload_intents", "update upload_intents", "update videos");
        soft.assertAll();
    }

    // ---- 도움 ----

    private static final Pattern WITH_CHANGE = Pattern.compile("^with \\w+ as \\( ?(insert into|update|delete from) (\\w+)\\b.*");
    private static final Pattern INSERT = Pattern.compile("^insert into (\\w+)\\b.*");
    private static final Pattern UPDATE = Pattern.compile("^update (\\w+)\\b.*");
    private static final Pattern DELETE = Pattern.compile("^delete from (\\w+)\\b.*");
    private static final Pattern TABLE = Pattern.compile("^(\\w+)\\b.*");
    private static final Pattern LOCK = Pattern.compile(" for update( of \\w+)?( skip locked)?");

    /**
     * 문장을 "<종류> <표>[ 덧붙임]" 으로 줄인다. 별칭·열 목록·매개변수 표기는 두 구현이 달라 견주지 않는다. SELECT 의 표는 바깥
     * FROM 의 첫 표이고 바깥 FROM 이 없으면 "(none)" 이다. 잠금은 {@code for update [of 별칭] [skip locked]} 를 그대로 붙인다 —
     * 표 하나를 잠그는 조회에서 네이티브 {@code FOR UPDATE} 와 JPQL 의 {@code for update of <별칭>} 은 같은 세기다
     * ({@code PessimisticWriteLockIT}, 위 잠금 테스트).
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        String returning = text.contains(" returning ") ? " returning" : "";
        Matcher locked = LOCK.matcher(text);
        String lock = locked.find() ? locked.group() : "";
        Matcher matcher;
        if ((matcher = WITH_CHANGE.matcher(text)).matches()) {
            return matcher.group(1).split(" ")[0] + " " + matcher.group(2) + returning;
        }
        if (text.startsWith("with ")) {
            return "with select" + lock;
        }
        if (text.startsWith("select ")) {
            return "select " + outerTable(text) + lock;
        }
        if ((matcher = INSERT.matcher(text)).matches()) {
            return "insert " + matcher.group(1) + returning;
        }
        if ((matcher = UPDATE.matcher(text)).matches()) {
            return "update " + matcher.group(1) + returning;
        }
        if ((matcher = DELETE.matcher(text)).matches()) {
            return "delete " + matcher.group(1) + returning;
        }
        return text;
    }

    /** 괄호 밖에 있는 첫 " from " 뒤의 표 이름. */
    private static String outerTable(String text) {
        int depth = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
            } else if (depth == 0 && text.startsWith(" from ", i)) {
                Matcher matcher = TABLE.matcher(text.substring(i + " from ".length()));
                return matcher.matches() ? matcher.group(1) : "(subquery)";
            }
        }
        return "(none)";
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(VideoRepositoryIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    private NewIntent intent(long byteSize, int durationMs) {
        UUID request = UUID.randomUUID();
        return new NewIntent(request, "f-" + byteSize + "-" + durationMs, "videos/" + request + ".mp4", "video/mp4",
                byteSize, durationMs, now.plusSeconds(600));
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        return id;
    }

    private UUID video(UUID owner, long byteSize, Instant createdAt, boolean purged) {
        UUID id = UUID.randomUUID();
        OffsetDateTime at = OffsetDateTime.ofInstant(createdAt, ZoneOffset.UTC);
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,purged_at,created_at,updated_at)
                VALUES (?,?,?,'video/mp4',?,1,?,?,?)
                """, id, owner, "videos/" + id + ".mp4", byteSize, purged ? at : null, at, at);
        return id;
    }

    private void transcript(UUID videoId) {
        jdbc.update("INSERT INTO video_transcripts(id,video_id,status) VALUES (?,?,'ready')", UUID.randomUUID(), videoId);
    }

    private void practice(UUID owner, UUID videoId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,blockage_kind,sub_branch)
                VALUES (?,?,?,?,1,'closed','legacy','그 외','그 외')
                """, id, owner, videoId, id);
    }

    private UUID challenge() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges(id,line,work,duration_days,origin,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?,?,'창작',7,'team',?,?,?,?)
                """, id, "대사 " + id, UUID.randomUUID(), "0".repeat(64),
                OffsetDateTime.ofInstant(now.minus(Duration.ofDays(1)), ZoneOffset.UTC),
                OffsetDateTime.ofInstant(now.plus(Duration.ofDays(6)), ZoneOffset.UTC));
        return id;
    }

    private void entry(UUID challenge, UUID owner, UUID videoId, String mosaicKey) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenge_entries (id,challenge_id,user_id,video_id,visibility,request_id,request_fingerprint,created_at)
                VALUES (?,?,?,?,'private',?,?,?)
                """, id, challenge, owner, videoId, UUID.randomUUID(), "0".repeat(64), OffsetDateTime.ofInstant(now, ZoneOffset.UTC));
        if (mosaicKey != null) {
            jdbc.update("UPDATE challenge_entries SET mosaic_key=? WHERE id=?", mosaicKey, id);
        }
    }

    private Instant instant(String sql, Object... args) {
        return jdbc.queryForObject(sql, OffsetDateTime.class, args).toInstant();
    }

    private Connection probe() throws SQLException {
        Connection probe = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
        probe.setAutoCommit(false);
        return probe;
    }

    private static void lockVideo(Connection probe, UUID id, String strength) throws SQLException {
        try (PreparedStatement statement = probe.prepareStatement("SELECT 1 FROM videos WHERE id=? " + strength)) {
            statement.setObject(1, id);
            statement.execute();
        }
    }

    private static void insertPractice(Connection probe, UUID owner, UUID videoId) throws SQLException {
        UUID id = UUID.randomUUID();
        try (PreparedStatement statement = probe.prepareStatement("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,blockage_kind,sub_branch)
                VALUES (?,?,?,?,1,'closed','legacy','그 외','그 외')
                """)) {
            statement.setObject(1, id);
            statement.setObject(2, owner);
            statement.setObject(3, videoId);
            statement.setObject(4, id);
            statement.execute();
        }
    }

    /** 그 표를 쓰는 문장이 잠금을 기다리면 그 문장을 소문자로 낸다. */
    private String awaitStatementWaitingOn(String table) throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT query FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                      AND query ILIKE ?
                    """, String.class, "%" + table + "%");
            if (!waiting.isEmpty()) {
                return waiting.getFirst().strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
            }
            Thread.sleep(10);
        }
        throw new AssertionError("잠금 뒤에서 기다리는 문장이 없다");
    }
}
