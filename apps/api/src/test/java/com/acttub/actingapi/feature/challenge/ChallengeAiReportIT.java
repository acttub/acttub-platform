package com.acttub.actingapi.feature.challenge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository;
import com.acttub.actingapi.feature.challenge.app.ChallengeReportModel;
import com.acttub.actingapi.feature.challenge.app.ChallengeReportWorker;
import com.acttub.actingapi.feature.challenge.app.EntryMedia;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * AI 리포트 (challenge.ai-report). 실제 HTTP·Postgres·ai_jobs 장부를 쓰고 모델만 대체한다 — 모델이 받은 영상과 지시문을
 * 기록하고, 정해 둔 출력을 차례로 돌려준다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ANALYSIS_WORKER_ENABLED=false", "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false", "CHALLENGE_SETTLEMENT_ENABLED=false"})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ChallengeAiReportIT.Model.class})
class ChallengeAiReportIT {
    static final Instant NOW = Instant.parse("2026-09-23T03:00:00Z");

    @TestConfiguration
    static class Model {
        static final List<Call> CALLS = new CopyOnWriteArrayList<>();
        static final Deque<Object> OUTPUTS = new ArrayDeque<>();
        record Call(AiReportRepository.Video mine, List<ChallengeReportModel.Labeled> samples, String instruction) { }

        @Bean @Primary ChallengeReportModel stubChallengeReportModel() {
            return (mine, samples, instruction) -> {
                CALLS.add(new Call(mine, samples, instruction));
                Object next;
                synchronized (OUTPUTS) { next = OUTPUTS.isEmpty() ? good(samples.size()) : OUTPUTS.poll(); }
                if (next instanceof RuntimeException failure) throw failure;
                return new ChallengeReportModel.Output((String) next, "stub-model");
            };
        }

        @Bean @Primary EntryMedia stubAiReportMedia() {
            return new EntryMedia() {
                @Override public int durationMs(String objectKey) { return 30_000; }
                @Override public String playbackUrl(String objectKey) { return null; }
            };
        }

        static String good(int samples) {
            var comparisons = new StringBuilder();
            for (int i = 1; i <= samples; i++) {
                if (i > 1) comparisons.append(',');
                comparisons.append("{\"text\":\"S").append(i).append("와 달리 첫 문장을 천천히 시작했다\",\"samples\":[\"S").append(i).append("\"]}");
            }
            return """
                    {"observations":[{"start_ms":0,"end_ms":1400,"text":"첫 문장 전에 0.8초 멈춘다"}],
                     "comparisons":[%s],"limits":["뒷부분 2초는 소리가 작아 확인하지 못했다"],"suggestion":"멈춤을 반으로 줄여 보세요"}
                    """.formatted(comparisons);
        }
    }

    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("challenge_ai_report");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired JwtService jwt;
    @Autowired MutableClock clock;
    @Autowired ChallengeReportWorker worker;
    UUID me;
    String bearer;
    UUID challenge;

    @BeforeEach void prepare() {
        clock.set(NOW);
        Model.CALLS.clear();
        synchronized (Model.OUTPUTS) { Model.OUTPUTS.clear(); }
        jdbc.execute("TRUNCATE users,challenges,ai_jobs RESTART IDENTITY CASCADE");
        me = member("나");
        bearer = token(me);
        challenge = challenge();
    }

    @Test void challengeAiReport_requestRunsOneJobAndReturnsObservationsWithoutScores() throws Exception {
        for (int i = 0; i < 6; i++) entry(member("표본 " + i), "public", i);
        UUID mine = entry(me, "public", 10);
        JsonNode requested = response(post("/v2/entries/{id}/ai-report", mine).content(request(UUID.randomUUID())), 202);
        assertThat(requested.path("status").asText()).isEqualTo("pending");
        assertThat(jobs()).isEqualTo(1);
        assertThat(worker.runOnce(clock.instant())).isTrue();
        JsonNode report = response(get("/v2/entries/{id}/ai-report", mine), 200);
        assertThat(report.path("status").asText()).isEqualTo("ready");
        assertThat(report.at("/observations/0/start_ms").asInt()).isZero();
        assertThat(report.at("/observations/0/text").asText()).contains("멈춘다");
        assertThat(report.path("comparisons")).hasSize(5);
        assertThat(report.path("limits")).isNotEmpty();
        assertThat(report.path("suggestion").asText()).isNotBlank();
        assertThat(report.path("sample_count").asInt()).isEqualTo(5);
        assertThat(report.toString()).doesNotContain("점수", "등급", "순위", "백분위", "재능");
        assertThat(response(post("/v2/entries/{id}/ai-report", mine).content(request(UUID.randomUUID())), 200).path("status").asText())
                .isEqualTo("ready");
        assertThat(jobs()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs", String.class)).isEqualTo("succeeded");
    }

    @Test void challengeAiReport_privateEntriesGetReportsAndNothingRunsUnasked() throws Exception {
        entry(member("다른"), "public", 1);
        UUID hidden = entry(me, "private", 2);
        entry(me, "public", 3);
        assertThat(jobs()).isZero();
        response(post("/v2/entries/{id}/ai-report", hidden).content(request(UUID.randomUUID())), 202);
        worker.runOnce(clock.instant());
        assertThat(response(get("/v2/entries/{id}/ai-report", hidden), 200).path("status").asText()).isEqualTo("ready");
        assertThat(detail(get("/v2/entries/{id}/ai-report", hidden), 404, token(member("남")))).isEqualTo("ai_report_not_found");
        assertThat(detail(post("/v2/entries/{id}/ai-report", hidden).content(request(UUID.randomUUID())), 404, token(member("남2"))))
                .isEqualTo("entry_not_found");
    }

    @Test void challengeAiReport_samplesAreTheLatestFivePublicEntriesOfOtherPeopleAndNeverNamed() throws Exception {
        var expected = new ArrayList<UUID>();
        var authors = new ArrayList<UUID>();
        for (int i = 0; i < 8; i++) authors.add(member("작성자 " + i));
        int order = 0;
        for (int i = 0; i < 8; i++) {
            entry(authors.get(i), "public", order++);
            if (i < 4) entry(authors.get(i), "public", order++);
        }
        // 가장 최근 순서: 작성자 7·6·5·4 는 하나씩, 3·2·1·0 은 둘째 참여작이 최신이다.
        for (int i = 7; i >= 0 && expected.size() < 5; i--) {
            expected.add(jdbc.queryForObject("""
                    SELECT id FROM challenge_entries WHERE user_id=? ORDER BY published_at DESC LIMIT 1""", UUID.class, authors.get(i)));
        }
        UUID privateOne = entry(member("비공개"), "private", 100);
        UUID purged = entry(member("파기"), "public", 101);
        jdbc.update("UPDATE videos SET purged_at=now() WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?)", purged);
        UUID blocker = member("차단");
        UUID blocked = entry(blocker, "public", 102);
        jdbc.update("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", UUID.randomUUID(), blocker, me);
        UUID myOther = entry(me, "public", 103);
        UUID mine = entry(me, "public", 104);
        response(post("/v2/entries/{id}/ai-report", mine).content(request(UUID.randomUUID())), 202);
        worker.runOnce(clock.instant());
        var call = Model.CALLS.getFirst();
        var keys = call.samples().stream().map(sample -> sample.video().objectKey()).toList();
        assertThat(keys).containsExactlyElementsOf(expected.stream().map(this::objectKey).toList());
        assertThat(keys).doesNotContain(objectKey(privateOne), objectKey(blocked), objectKey(myOther));
        assertThat(call.mine().objectKey()).isEqualTo(objectKey(mine));
        assertThat(call.instruction()).doesNotContain("작성자");
        String body = response(get("/v2/entries/{id}/ai-report", mine), 200).toString();
        for (UUID id : expected) assertThat(body).doesNotContain(id.toString());
        assertThat(body).doesNotContain("작성자");
        String stored = jdbc.queryForObject("SELECT CAST(result AS text) FROM entry_ai_reports WHERE entry_id=?", String.class, mine);
        assertThat(stored).contains(expected.getFirst().toString());
    }

    @Test void challengeAiReport_withTwoSamplesItOnlyObservesAndSaysComparisonsNeedMore() throws Exception {
        entry(member("하나"), "public", 1);
        entry(member("둘"), "public", 2);
        UUID mine = entry(me, "public", 3);
        response(post("/v2/entries/{id}/ai-report", mine).content(request(UUID.randomUUID())), 202);
        worker.runOnce(clock.instant());
        assertThat(Model.CALLS.getFirst().samples()).isEmpty();
        JsonNode report = response(get("/v2/entries/{id}/ai-report", mine), 200);
        assertThat(report.path("comparisons")).isEmpty();
        assertThat(report.at("/limits/0").asText()).isEqualTo("비교할 영상이 아직 부족해요");
        assertThat(report.path("sample_count").asInt()).isZero();
    }

    @Test void challengeAiReport_dailyLimitReplaysAndOneRunningGenerationPerEntry() throws Exception {
        UUID request = UUID.randomUUID();
        UUID first = entry(me, "public", 1);
        response(post("/v2/entries/{id}/ai-report", first).content(request(request)), 202);
        response(post("/v2/entries/{id}/ai-report", first).content(request(request)), 202);
        response(post("/v2/entries/{id}/ai-report", first).content(request(UUID.randomUUID())), 202);
        assertThat(jobs()).isEqualTo(1);
        response(post("/v2/entries/{id}/ai-report", entry(me, "public", 2)).content(request(UUID.randomUUID())), 202);
        response(post("/v2/entries/{id}/ai-report", entry(me, "private", 3)).content(request(UUID.randomUUID())), 202);
        assertThat(detail(post("/v2/entries/{id}/ai-report", entry(me, "public", 4)).content(request(UUID.randomUUID())), 429))
                .isEqualTo("daily_report_request_limit");
        response(post("/v2/entries/{id}/ai-report", first).content(request(request)), 202);
        assertThat(detail(post("/v2/entries/{id}/ai-report", entry(me, "public", 5)).content(request(request)), 422))
                .isEqualTo("request_fingerprint_mismatch");
        assertThat(jobs()).isEqualTo(3);
    }

    @Test void challengeAiReport_threeFailedRunsFailTheGenerationAndRetryStartsANewOne() throws Exception {
        UUID mine = entry(me, "public", 1);
        response(post("/v2/entries/{id}/ai-report", mine).content(request(UUID.randomUUID())), 202);
        synchronized (Model.OUTPUTS) {
            Model.OUTPUTS.add(new IllegalStateException("model down"));
            Model.OUTPUTS.add("""
                    {"observations":[{"start_ms":0,"end_ms":900,"text":"타고난 재능이 보인다"}],"comparisons":[],"limits":[],"suggestion":null}""");
            Model.OUTPUTS.add("관찰만 적은 글");
        }
        worker.runOnce(clock.instant());
        JsonNode afterFirst = response(get("/v2/entries/{id}/ai-report", mine), 200);
        assertThat(afterFirst.path("status").asText()).isEqualTo("pending");
        assertThat(afterFirst.path("attempt_count").asInt()).isEqualTo(1);
        worker.runOnce(clock.instant());
        assertThat(jdbc.queryForObject("SELECT result IS NULL FROM entry_ai_reports", Boolean.class)).isTrue();
        worker.runOnce(clock.instant());
        JsonNode failed = response(get("/v2/entries/{id}/ai-report", mine), 200);
        assertThat(failed.path("status").asText()).isEqualTo("failed");
        assertThat(failed.path("attempt_count").asInt()).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs", String.class)).isEqualTo("failed");
        assertThat(worker.runOnce(clock.instant())).isFalse();
        response(post("/v2/entries/{id}/ai-report", mine).content(request(UUID.randomUUID())), 202);
        assertThat(jobs()).isEqualTo(2);
        worker.runOnce(clock.instant());
        assertThat(response(get("/v2/entries/{id}/ai-report", mine), 200).path("status").asText()).isEqualTo("ready");
    }

    @Test void challengeAiReport_comparisonsLeaningOnSamplesThatLostEligibilityDisappear() throws Exception {
        var samples = new ArrayList<UUID>();
        var authors = new ArrayList<UUID>();
        for (int i = 0; i < 6; i++) { authors.add(member("표본 " + i)); samples.add(entry(authors.get(i), "public", i)); }
        UUID mine = entry(me, "public", 10);
        response(post("/v2/entries/{id}/ai-report", mine).content(request(UUID.randomUUID())), 202);
        worker.runOnce(clock.instant());
        assertThat(response(get("/v2/entries/{id}/ai-report", mine), 200).path("comparisons")).hasSize(5);
        // 표본은 최신 다섯(5·4·3·2·1)이다. 하나씩 조건을 잃게 한다.
        jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", samples.get(5));
        jdbc.update("UPDATE challenge_entries SET status='hidden_by_report' WHERE id=?", samples.get(4));
        jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", authors.get(3));
        jdbc.update("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", UUID.randomUUID(), authors.get(2), me);
        JsonNode report = response(get("/v2/entries/{id}/ai-report", mine), 200);
        assertThat(report.path("comparisons")).hasSize(1);
        assertThat(report.path("sample_count").asInt()).isEqualTo(1);
        jdbc.update("UPDATE challenges SET moderation='review' WHERE id=?", challenge);
        assertThat(response(get("/v2/entries/{id}/ai-report", mine), 200).path("comparisons")).isEmpty();
    }

    @Test void challengeAiReport_purgedFilesDeletionAndWithdrawalStopTheReport() throws Exception {
        UUID purged = entry(me, "public", 1);
        jdbc.update("UPDATE videos SET purged_at=now() WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?)", purged);
        assertThat(detail(post("/v2/entries/{id}/ai-report", purged).content(request(UUID.randomUUID())), 422)).isEqualTo("video_not_ready");
        UUID deleted = entry(me, "public", 2);
        response(post("/v2/entries/{id}/ai-report", deleted).content(request(UUID.randomUUID())), 202);
        response(delete("/v2/entries/{id}", deleted), 204);
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs", String.class)).isEqualTo("failed");
        assertThat(jdbc.queryForObject("SELECT purged_at IS NOT NULL AND result IS NULL FROM entry_ai_reports", Boolean.class)).isTrue();
        assertThat(worker.runOnce(clock.instant())).isFalse();
        UUID leaving = entry(me, "public", 3);
        response(post("/v2/entries/{id}/ai-report", leaving).content(request(UUID.randomUUID())), 202);
        jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", me);
        worker.runOnce(clock.instant());
        assertThat(Model.CALLS).isEmpty();
        assertThat(jdbc.queryForObject("SELECT failure_reason FROM ai_jobs WHERE target_id=?", String.class, leaving)).isEqualTo("cancelled");
        assertThat(jdbc.queryForObject("SELECT result IS NULL FROM entry_ai_reports WHERE entry_id=?", Boolean.class, leaving)).isTrue();
    }

    // ── 도우미 ──────────────────────────────────────────────────────────────

    private UUID member(String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, id.toString());
        AccountFixtures.passGate(jdbc, id);
        jdbc.update("UPDATE user_profiles SET name=? WHERE user_id=?", name, id);
        return id;
    }

    private String token(UUID id) { return "Bearer " + jwt.issueAccessToken(id).value(); }

    private UUID challenge() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges(id,line,work,duration_days,origin,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?,'가지 마.','창작',7,'team',?,?,?,?)
                """, id, UUID.randomUUID(), "0".repeat(64), java.sql.Timestamp.from(NOW.minus(Duration.ofDays(1))),
                java.sql.Timestamp.from(NOW.plus(Duration.ofDays(6))));
        return id;
    }

    /** 참여작 하나. 공개 시각은 NOW 앞 1시간에서 {@code order} 분 뒤다. */
    private UUID entry(UUID owner, String visibility, int order) {
        UUID video = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms) VALUES (?,?,?,'video/mp4',100,30000)",
                video, owner, "videos/" + video);
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenge_entries(id,challenge_id,user_id,video_id,visibility,status,request_id,request_fingerprint,published_at)
                VALUES (?,?,?,?,?,'visible',?,?,CASE WHEN ?='public' THEN ?::timestamptz END)
                """, id, challenge, owner, video, visibility, UUID.randomUUID(), "0".repeat(64), visibility,
                java.sql.Timestamp.from(NOW.minus(Duration.ofHours(1)).plus(Duration.ofMinutes(order))));
        return id;
    }

    private String objectKey(UUID entry) {
        return jdbc.queryForObject("SELECT v.object_key FROM challenge_entries e JOIN videos v ON v.id=e.video_id WHERE e.id=?",
                String.class, entry);
    }

    private int jobs() { return jdbc.queryForObject("SELECT count(*) FROM ai_jobs WHERE kind='challenge_report'", Integer.class); }

    private String request(UUID id) throws Exception { return json.writeValueAsString(Map.of("request_id", id)); }

    private String detail(MockHttpServletRequestBuilder request, int expected) throws Exception {
        return response(request, expected).path("detail").asText();
    }

    private String detail(MockHttpServletRequestBuilder request, int expected, String authorization) throws Exception {
        return response(request, expected, authorization).path("detail").asText();
    }

    private JsonNode response(MockHttpServletRequestBuilder request, int expected) throws Exception {
        return response(request, expected, bearer);
    }

    private JsonNode response(MockHttpServletRequestBuilder request, int expected, String authorization) throws Exception {
        var result = mvc.perform(request.header("Authorization", authorization).header("X-Acttub-Client", "app/1.0.0")
                .header("Accept-Language", "ko").contentType(MediaType.APPLICATION_JSON)).andReturn();
        var response = result.getResponse();
        assertThat(response.getStatus()).as("%s (%s)", response.getContentAsString(), result.getResolvedException()).isEqualTo(expected);
        return response.getContentAsString().isBlank() ? json.nullNode() : json.readTree(response.getContentAsString());
    }
}
