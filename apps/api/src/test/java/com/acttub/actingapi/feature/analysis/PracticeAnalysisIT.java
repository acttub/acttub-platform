package com.acttub.actingapi.feature.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;

import com.acttub.actingapi.feature.analysis.app.AnalysisContext;
import com.acttub.actingapi.feature.analysis.app.AnalysisProcessor;
import com.acttub.actingapi.feature.analysis.app.AnalysisResult;
import com.acttub.actingapi.feature.analysis.app.AnalysisWorker;
import com.acttub.actingapi.feature.analysis.app.PracticeAnalysisStore;
import com.acttub.actingapi.feature.analysis.app.UnsupportedMediaError;
import com.acttub.actingapi.integration.observation.ObservationItem;
import com.acttub.actingapi.integration.observation.ObservationPack;
import com.acttub.actingapi.integration.observation.SpeechFacts;
import com.acttub.actingapi.integration.observation.SummaryParseError;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * practice.analyze 의 "검증 방법" 가운데 <b>결과 저장</b>에 해당하는 항목을 실제 워커와 실제 Postgres 로 본다.
 * 큐는 {@code ai_jobs}, 결과는 {@code analyses}·{@code video_transcripts} 다.
 *
 * <p>바깥은 전부 스텁이다 — 오브젝트 스토리지는 메모리의 가짜이고 분석기는 시험이 정해 준 결과·예외를 낸다.
 * 작업 상태를 읽고 취소하는 API 쪽은 PA2 의 {@code PracticeLifecycleIT} 가 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    // 스케줄러가 큐를 가로채면 시험이 워커를 직접 돌리지 못한다.
    "ANALYSIS_WORKER_ENABLED=false"
})
@Import({MutableClock.Fixture.class, PracticeAnalysisIT.Fixture.class})
class PracticeAnalysisIT {
    private static final Duration LEASE = Duration.ofMinutes(30);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("practice_analysis");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PracticeAnalysisStore store;

    @Autowired
    AiJobLedger jobs;

    @Autowired
    FakeStorage storage;

    @Autowired
    StubAnalyzer analyzer;

    @Autowired
    MutableClock clock;

    @Autowired
    RecordingFailureReporter failures;

    private AnalysisWorker worker;
    private UUID member;
    private UUID video;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        storage.objects.clear();
        storage.failing.clear();
        analyzer.reset();
        failures.clear();
        clock.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        worker = new AnalysisWorker(
                store, storage, analyzer, clock, LEASE, "test-model", null, failures);
        member = user("active");
        video = video(member);
    }

    @Test
    @DisplayName("practice.analyze: 신형 회차의 분석이 끝남 — analyses 1행(id = record_id, format video_record_v1, status ready)이고 "
            + "회차가 conversing 으로 가며 작업은 succeeded 다. 받아쓰기 묶음이 영상당 하나 생긴다")
    void practiceAnalyze_aFinishedJobStoresTheRecordAndOpensTheConversation() {
        UUID recordId = UUID.randomUUID();
        UUID practice = practice(member, video, "three_layers_v1");
        job(member, practice);
        analyzer.result = context -> new AnalysisResult(pack(List.of()), false, 12_345, videoRecord(recordId));

        assertThat(worker.runOnce(clock.instant())).isTrue();

        Map<String, Object> analysis = jdbc.queryForMap("SELECT id,practice_id,format,status,model FROM analyses");
        assertThat(analysis).containsEntry("id", recordId).containsEntry("practice_id", practice)
                .containsEntry("format", "video_record_v1").containsEntry("status", "ready")
                .containsEntry("model", "test-model");
        assertThat(jdbc.queryForObject("SELECT stage FROM practices WHERE id=?", String.class, practice))
                .isEqualTo("conversing");
        assertThat(jdbc.queryForMap("SELECT status,failure_reason,lease_token FROM ai_jobs"))
                .containsEntry("status", "succeeded").containsEntry("failure_reason", null)
                .containsEntry("lease_token", null);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM video_transcripts WHERE video_id=?", Integer.class, video))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT duration_ms FROM videos WHERE id=?", Integer.class, video))
                .as("길이를 모르던 영상은 잰 값으로 채운다").isEqualTo(12_345);
        assertThat(worker.runOnce(clock.instant())).as("집을 것이 없다").isFalse();
    }

    @Test
    @DisplayName("practice.analyze: 기존 갈래(legacy) 회차 완료 — analyses.format 이 legacy 이고 기록은 ObservationPack 원문이다. "
            + "못 본 구간이 있으면 status 가 partial 이고 그 구간을 채우지 않는다")
    void practiceAnalyze_legacyKeepsTheObservationPackAndPartialStaysPartial() {
        UUID practice = practice(member, video, "legacy");
        job(member, practice);
        analyzer.result = context -> new AnalysisResult(pack(List.of("0:10~0:20 은 보지 못했어요")), false, 9_000);

        assertThat(worker.runOnce(clock.instant())).isTrue();

        Map<String, Object> analysis = jdbc.queryForMap("SELECT format,status,CAST(record AS text) AS record FROM analyses");
        assertThat(analysis).containsEntry("format", "legacy").containsEntry("status", "partial");
        assertThat((String) analysis.get("record"))
                .as("구형을 신형으로 위장하지 않는다").contains("scene_summary").contains("보지 못했어요");
        assertThat(jdbc.queryForObject("SELECT stage FROM practices WHERE id=?", String.class, practice))
                .as("부분 완료여도 대화는 시작된다").isEqualTo("conversing");
    }

    @Test
    @DisplayName("practice.analyze: 같은 영상의 두 번째 회차 분석 — 받아쓰기 묶음이 늘지 않고 먼저 만든 것이 재사용된다")
    void practiceAnalyze_transcriptsAreMadeOncePerVideo() {
        UUID first = practice(member, video, "legacy");
        job(member, first);
        analyzer.result = context -> new AnalysisResult(pack(List.of()), false, 9_000);
        worker.runOnce(clock.instant());
        UUID firstTranscript = jdbc.queryForObject("SELECT id FROM video_transcripts", UUID.class);

        // 묶음에 진행 중 회차는 하나다 — 1차를 닫아야 2차가 선다(부분 유일 인덱스, PA2).
        jdbc.update("UPDATE practices SET stage='closed',close_reason='conversation_closed' WHERE id=?", first);
        UUID second = practice(member, video, "legacy", first, 2);
        job(member, second);
        clock.advance(Duration.ofMinutes(1));

        assertThat(worker.runOnce(clock.instant())).isTrue();

        assertThat(jdbc.queryForList("SELECT id FROM video_transcripts", UUID.class))
                .as("영상당 묶음 하나다").containsExactly(firstTranscript);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM analyses", Integer.class))
                .as("회차마다 기록은 따로다").isEqualTo(2);
    }

    @Test
    @DisplayName("practice.analyze: 완료된 회차에 두 번째 분석이 끝나도 기록을 덮지 않는다 — 워커 재시도가 판을 바꾸지 않는다")
    void practiceAnalyze_finishedRecordsAreImmutable() {
        UUID practice = practice(member, video, "legacy");
        job(member, practice);
        analyzer.result = context -> new AnalysisResult(pack(List.of()), false, 9_000);
        worker.runOnce(clock.instant());
        Map<String, Object> before = jdbc.queryForMap("SELECT id,CAST(record AS text) AS record FROM analyses");

        // 같은 회차에 새 작업이 걸려 끝났다(명시적 재시도가 만든 자리).
        jdbc.update("UPDATE practices SET stage='analyzing' WHERE id=?", practice);
        job(member, practice);
        analyzer.result = context -> new AnalysisResult(
                new ObservationPack("덮어쓴 장면", List.of(), List.of()), false, 9_000);
        clock.advance(Duration.ofMinutes(1));

        assertThat(worker.runOnce(clock.instant())).isTrue();

        Map<String, Object> after = jdbc.queryForMap("SELECT id,CAST(record AS text) AS record FROM analyses");
        assertThat(after).as("완료 뒤 불변이다").isEqualTo(before);
        assertThat((String) after.get("record")).doesNotContain("덮어쓴 장면");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM analyses", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("practice.analyze: timeout·parse·unsupported 는 즉시 failed 이고 재큐하지 않는다. 그 밖의 바깥 실패는 재큐하고 "
            + "세 번을 소진하면 sweep 이 닫으며 회차도 closed 가 된다")
    void practiceAnalyze_failureClassesFollowTheFixedContract() {
        UUID timedOut = practice(member, video, "legacy");
        job(member, timedOut);
        analyzer.failure = new java.util.concurrent.TimeoutException("gemini");

        worker.runOnce(clock.instant());

        assertThat(jdbc.queryForMap("SELECT status,failure_reason,attempt_count FROM ai_jobs"))
                .containsEntry("status", "failed").containsEntry("failure_reason", "gemini_timeout")
                .containsEntry("attempt_count", 1);
        assertThat(jdbc.queryForObject(
                "SELECT stage || '/' || close_reason FROM practices WHERE id=?", String.class, timedOut))
                .isEqualTo("closed/analysis_failed");
        assertThat(worker.runOnce(clock.instant())).as("즉시 실패는 재큐하지 않는다").isFalse();

        UUID flaky = practice(user("active"), video(member), "legacy");
        jdbc.update("UPDATE practices SET user_id=(SELECT user_id FROM videos WHERE id=video_id) WHERE id=?", flaky);
        UUID owner = jdbc.queryForObject("SELECT user_id FROM practices WHERE id=?", UUID.class, flaky);
        job(owner, flaky);
        analyzer.failure = new IllegalStateException("s3 flaked");

        worker.runOnce(clock.instant());
        assertThat(jdbc.queryForMap("SELECT status,attempt_count FROM ai_jobs WHERE target_id=?", flaky))
                .as("미분류 실패는 다시 대기로").containsEntry("status", "pending").containsEntry("attempt_count", 1);

        analyzer.failure = null;
        analyzer.result = context -> new AnalysisResult(pack(List.of()), false, 9_000);
        assertThat(worker.runOnce(clock.instant())).isTrue();
        assertThat(jdbc.queryForMap("SELECT status,attempt_count FROM ai_jobs WHERE target_id=?", flaky))
                .as("두 번째 시도에 성공한다").containsEntry("status", "succeeded").containsEntry("attempt_count", 2);
    }

    @Test
    @DisplayName("practice.analyze: 바깥 실패가 세 번 이어지면 sweep 이 작업을 닫고 그 회차도 closed/analysis_failed 가 된다")
    void practiceAnalyze_threeFailuresThenSweepClosesThePractice() {
        UUID practice = practice(member, video, "legacy");
        job(member, practice);
        analyzer.failure = new IllegalStateException("s3 flaked");

        for (int attempt = 0; attempt < AiJobLedger.MAX_ATTEMPTS; attempt++) {
            worker.runOnce(clock.instant());
        }

        assertThat(jdbc.queryForMap("SELECT status,attempt_count FROM ai_jobs"))
                .containsEntry("status", "pending").containsEntry("attempt_count", AiJobLedger.MAX_ATTEMPTS);
        assertThat(worker.runOnce(clock.instant())).as("시도를 소진하면 집히지 않는다").isFalse();

        AnalysisWorker.SweepResult swept = worker.sweep(clock.instant());

        assertThat(swept.exhaustedOperations()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs", String.class)).isEqualTo("failed");
        assertThat(jdbc.queryForObject(
                "SELECT stage || '/' || close_reason FROM practices WHERE id=?", String.class, practice))
                .isEqualTo("closed/analysis_failed");
    }

    @Test
    @DisplayName("account.withdraw·practice.analyze: 탈퇴가 먼저 끝난 뒤 완료 — 결과를 저장하지 않고 작업이 failed/account_deactivated 다. "
            + "이관이 먼저 끝났으면 회차의 주인이 회원이므로 결과는 회원의 것이 된다")
    void practiceAnalyze_ownerAndAccountStateAreCheckedInsideTheCompletion() {
        UUID practice = practice(member, video, "legacy");
        job(member, practice);
        analyzer.result = context -> {
            // 바깥 호출이 도는 사이에 다른 기기에서 탈퇴가 끝났다.
            jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", member);
            return new AnalysisResult(pack(List.of()), false, 9_000);
        };

        assertThat(worker.runOnce(clock.instant())).isTrue();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM analyses", Integer.class))
                .as("닫힌 계정에 분석이 남지 않는다").isZero();
        assertThat(jdbc.queryForMap("SELECT status,failure_reason FROM ai_jobs"))
                .containsEntry("status", "failed").containsEntry("failure_reason", "account_deactivated");
        assertThat(jdbc.queryForObject("SELECT stage FROM practices WHERE id=?", String.class, practice))
                .as("회차는 그대로 남는다 — 탈퇴 파기가 따로 지운다").isEqualTo("analyzing");

        UUID guest = user("active");
        UUID guestVideo = video(guest);
        UUID guestPractice = practice(guest, guestVideo, "legacy");
        job(guest, guestPractice);
        UUID owner = user("active");
        analyzer.result = context -> {
            // 이관이 끝나 회차의 주인이 회원으로 바뀌었다.
            jdbc.update("UPDATE practices SET user_id=? WHERE id=?", owner, guestPractice);
            jdbc.update("UPDATE videos SET user_id=? WHERE id=?", owner, guestVideo);
            return new AnalysisResult(pack(List.of()), false, 9_000);
        };
        clock.advance(Duration.ofMinutes(1));

        assertThat(worker.runOnce(clock.instant())).isTrue();

        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM analyses a JOIN practices p ON p.id=a.practice_id WHERE p.user_id=?",
                Integer.class, owner)).as("결과는 지금 주인의 것이다").isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs WHERE target_id=?", String.class, guestPractice))
                .isEqualTo("succeeded");
    }

    @Test
    @DisplayName("practice.analyze: lease 가 만료됐어도 재선점 전이면 완료가 저장된다. 다른 워커가 재선점한 뒤의 완료는 저장을 통째로 되돌린다")
    void practiceAnalyze_leaseOwnershipDecidesWhetherTheCompletionLands() {
        UUID practice = practice(member, video, "legacy");
        UUID jobId = job(member, practice);
        analyzer.result = context -> new AnalysisResult(pack(List.of()), false, 9_000);
        analyzer.beforeResult = () -> jdbc.update(
                "UPDATE ai_jobs SET lease_expires_at=? WHERE id=?", at(clock.instant().minusSeconds(60)), jobId);

        assertThat(worker.runOnce(clock.instant())).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM analyses", Integer.class))
                .as("만료됐지만 아무도 재선점하지 않았다").isEqualTo(1);

        UUID other = practice(member, video(member), "legacy");
        UUID otherJob = job(member, other);
        analyzer.beforeResult = () -> jdbc.update(
                "UPDATE ai_jobs SET lease_token=? WHERE id=?", UUID.randomUUID(), otherJob);
        clock.advance(Duration.ofMinutes(1));

        assertThat(worker.runOnce(clock.instant())).isTrue();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM analyses WHERE practice_id=?", Integer.class, other))
                .as("재선점 뒤의 완료는 저장되지 않는다").isZero();
        assertThat(jdbc.queryForObject("SELECT stage FROM practices WHERE id=?", String.class, other))
                .isEqualTo("analyzing");
        assertThat(failures.reports()).extracting(report -> report.context())
                .anyMatch(context -> context.startsWith("AnalysisWorker.complete"));
    }

    // ---- helpers ----

    private UUID user(String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,?)", id, status);
        return id;
    }

    private UUID video(UUID owner) {
        UUID id = UUID.randomUUID();
        String key = "videos/" + owner + "/" + id + ".mp4";
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,0)
                """, id, owner, key);
        storage.objects.put(key, "etag-" + id);
        return id;
    }

    private UUID practice(UUID owner, UUID videoId, String experienceVersion) {
        return practice(owner, videoId, experienceVersion, null, 1);
    }

    private UUID practice(UUID owner, UUID videoId, String experienceVersion, UUID rootId, int ordinal) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,
                                      blockage_kind,sub_branch)
                VALUES (?,?,?,?,?,'analyzing',?,'그 외','그 외')
                """, id, owner, videoId, rootId == null ? id : rootId, ordinal, experienceVersion);
        return id;
    }

    private UUID job(UUID owner, UUID practiceId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,created_at)
                VALUES (?,?,'analyze',?,?,?,'pending',?)
                """, id, owner, practiceId, UUID.randomUUID(), "f".repeat(64), at(clock.instant()));
        return id;
    }

    private static ObservationPack pack(List<String> uncertainties) {
        return new ObservationPack(
                "문 앞에서 돌아선다",
                "0:00 에 돌아선다",
                SpeechFacts.calculate("지금 놓치면 끝이야", List.of(
                        new SpeechFacts.Word("지금", 0, .3),
                        new SpeechFacts.Word("놓치면", .3, .6),
                        new SpeechFacts.Word("끝이야", .6, 1.2))),
                List.of(new ObservationItem(0, 1200, "호흡이 얕다", "지금 놓치면 끝이야", "호흡", 0.8)),
                uncertainties);
    }

    private static com.fasterxml.jackson.databind.JsonNode videoRecord(UUID recordId) {
        ObjectNode record = JsonNodeFactory.instance.objectNode();
        record.put("record_id", recordId.toString());
        record.put("version", "acttub.video_record.v1");
        return record;
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Fixture {
        @Bean
        @Primary
        FakeStorage fakeStorage() {
            return new FakeStorage();
        }

        @Bean
        @Primary
        StubAnalyzer stubAnalyzer() {
            return new StubAnalyzer();
        }

        @Bean
        @Primary
        RecordingFailureReporter recordingFailureReporter() {
            return new RecordingFailureReporter();
        }
    }

    /** 시험이 정해 준 결과나 예외를 내는 분석기. {@link #beforeResult} 로 바깥 호출 중의 경합을 흉내 낸다. */
    static final class StubAnalyzer implements AnalysisProcessor {
        volatile Function<AnalysisContext, AnalysisResult> result;
        volatile Exception failure;
        volatile Runnable beforeResult;

        void reset() {
            result = null;
            failure = null;
            beforeResult = null;
        }

        @Override
        public AnalysisResult analyze(Path videoPath, AnalysisContext context) {
            if (beforeResult != null) {
                beforeResult.run();
            }
            if (failure != null) {
                throw failure instanceof RuntimeException runtime
                        ? runtime
                        : new IllegalStateException(failure);
            }
            return result.apply(context);
        }
    }

    /** 메모리의 오브젝트 스토리지. 키마다 etag 를 들고 내려받기는 빈 파일을 만든다. */
    static final class FakeStorage implements ObjectStorage {
        final Map<String, String> objects = new ConcurrentHashMap<>();
        final java.util.Set<String> failing = ConcurrentHashMap.newKeySet();
        final AtomicReference<String> lastDownloaded = new AtomicReference<>();

        @Override
        public String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
            return "https://storage.test/put/" + objectKey;
        }

        @Override
        public String presignPlayback(String objectKey, int expiresInSeconds) {
            return "https://storage.test/get/" + objectKey;
        }

        @Override
        public StoredObjectMetadata head(String objectKey) {
            String etag = objects.get(objectKey);
            return etag == null ? null : new StoredObjectMetadata(1000L, "video/mp4", etag);
        }

        @Override
        public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
            if (failing.contains(objectKey)) {
                throw new IllegalStateException("storage refused the download");
            }
            String etag = objects.get(objectKey);
            if (etag == null) {
                throw new IllegalStateException("no such object: " + objectKey);
            }
            lastDownloaded.set(objectKey);
            return new StoredObjectMetadata(1000L, "video/mp4", etag);
        }

        @Override
        public void upload(String objectKey, String mimeType, Path source) {
            objects.put(objectKey, "etag-" + objectKey.hashCode());
        }

        @Override
        public void delete(String objectKey) {
            objects.remove(objectKey);
        }
    }

    /** 컴파일만을 위한 참조 — 실패 분류가 이 예외들을 알아본다. */
    @SuppressWarnings("unused")
    private static final Class<?>[] CLASSIFIED = {UnsupportedMediaError.class, SummaryParseError.class, Clock.class};
}
