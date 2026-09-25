package com.acttub.actingapi.feature.practice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.practice.domain.PracticeRules;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * practice.start·practice.resume·practice.analyze(작업 상태)·practice.library(묶음)의 "검증 방법" 가운데 서버가
 * 맡는 항목을 HTTP 와 실제 Postgres 로 본다. 신형 생성 플래그는 켜 둔다 — 끈 경우는 {@link PracticeLegacyFlagIT}.
 *
 * <p>분석 워커는 PA3 의 것이라 여기서 돌지 않는다. 작업이 끝난 뒤의 회차 상태는 {@code ai_jobs}·{@code analyses}
 * 행을 직접 넣어 흉내 낸다 — 이 티켓이 책임지는 것은 <b>작업을 만들고 상태를 읽고 취소하는</b> 자리다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ACTTUB_THREE_LAYERS_ENABLED=true",
    // 겹쳐 온 이어하기 둘이 저마다 커넥션을 쥔 채 묶음 잠금을 기다린다.
    "spring.datasource.hikari.maximum-pool-size=12"
})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class PracticeLifecycleIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("practice_lifecycle");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    JwtService jwt;

    @Autowired
    MutableClock clock;

    private final Map<String, UUID> documents = new LinkedHashMap<>();
    private UUID member;
    private String bearer;
    private UUID video;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        documents.clear();
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            UUID id = UUID.randomUUID();
            documents.put(type, id);
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,?,'v1',?,?,?,?)
                    """, id, type, type + " 제목", type + " 본문", !"retention".equals(type), PUBLISHED);
        }
        // 한국 시간 한낮으로 고정한다 — 자정 경계 시험이 날짜를 넘나들지 않게.
        clock.set(LocalDate.now(SEOUL).atTime(13, 0).atZone(SEOUL).toInstant());
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
        video = video(member);
    }

    @Test
    @DisplayName("practice.start: 플래그 켬·헤더 three_layers_v1·영상만 고르고 시작 — practices 1행(root_id 자기, ordinal 1, stage analyzing, "
            + "막힘 그 외/그 외, 상황·인물·목표 빈 문자열, experience_version three_layers_v1)과 ai_jobs 1행(analyze, pending)")
    void practiceStart_videoOnlyWithTheContractHeaderIsThreeLayers() throws Exception {
        JsonNode created = json(post("/v2/practices").header("X-Acttub-Contract", "three_layers_v1")
                .content(startBody(UUID.randomUUID(), video, null, null)), 201);

        assertThat(created.path("root_id").textValue()).isEqualTo(created.path("id").textValue());
        assertThat(created.path("ordinal").intValue()).isEqualTo(1);
        assertThat(created.path("stage").textValue()).isEqualTo("analyzing");
        assertThat(created.path("experience_version").textValue()).isEqualTo("three_layers_v1");
        assertThat(created.path("situation").textValue()).isEmpty();
        assertThat(created.path("character").textValue()).isEmpty();
        assertThat(created.path("goal").textValue()).isEmpty();
        assertThat(created.path("blockage_category").textValue()).isEqualTo("그 외");
        assertThat(created.path("blockage_detail").textValue()).isEqualTo("그 외");
        assertThat(created.path("blockage_note").isNull()).isTrue();
        assertThat(created.path("video_id").textValue()).isEqualTo(video.toString());
        assertThat(created.path("analysis_status").isNull()).isTrue();
        assertThat(created.path("job").path("status").textValue()).isEqualTo("pending");
        assertThat(created.path("job").path("attempt_count").intValue()).isZero();
        assertThat(count("practices")).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT kind,status,target_id,user_id FROM ai_jobs"))
                .containsEntry("kind", "analyze").containsEntry("status", "pending")
                .containsEntry("target_id", UUID.fromString(created.path("id").textValue()))
                .containsEntry("user_id", member);
        assertThat(count("analyses")).isZero();
    }

    @Test
    @DisplayName("practice.start: 상황과 막힘(표현 › 감정)을 적고 시작 — 저장값이 그대로이고 experience_version 은 legacy 다. 헤더가 없어도 legacy. "
            + "시작 뒤 상황을 바꾸는 API 는 없다")
    void practiceStart_anyInputMakesItLegacy() throws Exception {
        JsonNode typed = json(post("/v2/practices").header("X-Acttub-Contract", "three_layers_v1")
                .content(startBody(UUID.randomUUID(), video,
                        scene("문 앞에서 돌아선다", "니나", "설득한다"), blockage("표현", "감정", "감정이 안 올라와요"))), 201);

        assertThat(typed.path("experience_version").textValue()).isEqualTo("legacy");
        assertThat(typed.path("situation").textValue()).isEqualTo("문 앞에서 돌아선다");
        assertThat(typed.path("character").textValue()).isEqualTo("니나");
        assertThat(typed.path("goal").textValue()).isEqualTo("설득한다");
        assertThat(typed.path("blockage_category").textValue()).isEqualTo("표현");
        assertThat(typed.path("blockage_detail").textValue()).isEqualTo("감정");
        assertThat(typed.path("blockage_note").textValue()).isEqualTo("감정이 안 올라와요");

        UUID second = video(member);
        JsonNode noHeader = json(post("/v2/practices").content(startBody(UUID.randomUUID(), second, null, null)), 201);
        assertThat(noHeader.path("experience_version").textValue()).as("헤더가 없으면 legacy").isEqualTo("legacy");

        // 저장된 값은 상세 조회에서도 같다 — 회차 속성은 시작 뒤 불변이다.
        JsonNode detail = json(get("/v2/practices/{id}", typed.path("id").textValue()), 200);
        assertThat(detail.path("situation").textValue()).isEqualTo("문 앞에서 돌아선다");
        assertThat(detail.path("blockage_detail").textValue()).isEqualTo("감정");
    }

    @Test
    @DisplayName("practice.start: 같은 요청 id·같은 본문 두 번 — 행 하나이고 같은 회차다. 같은 id·다른 본문 — 422 request_fingerprint_mismatch. "
            + "X-Request-Id 가 본문과 다르면 422 배열")
    void practiceStart_isIdempotentPerRequestId() throws Exception {
        UUID requestId = UUID.randomUUID();
        JsonNode first = json(post("/v2/practices").header("X-Request-Id", requestId.toString())
                .content(startBody(requestId, video, null, null)), 201);
        JsonNode again = json(post("/v2/practices").header("X-Request-Id", requestId.toString())
                .content(startBody(requestId, video, null, null)), 201);

        assertThat(again.path("id").textValue()).isEqualTo(first.path("id").textValue());
        assertThat(count("practices")).isEqualTo(1);
        assertThat(count("ai_jobs")).isEqualTo(1);

        assertThat(json(post("/v2/practices").content(
                startBody(requestId, video, scene("다른 장면", null, null), null)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"request_fingerprint_mismatch\"}"));
        assertThat(count("practices")).isEqualTo(1);

        MockHttpServletResponse mismatch = perform(post("/v2/practices")
                .header("X-Request-Id", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content(startBody(UUID.randomUUID(), video, null, null)), bearer);
        assertThat(mismatch.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(mismatch.getContentAsString()).path("detail").get(0).path("loc"))
                .extracting(JsonNode::asText).containsExactly("header", "X-Request-Id");
    }

    @Test
    @DisplayName("practice.start: 없는 영상·남의 영상·파일만 파기한 영상으로 시작 — 422 video_not_ready 이고 회차·작업이 생기지 않는다. "
            + "상황 300자·막힘 서술 500자는 되고 301자·501자는 422 배열이며 막힘 조합이 어긋나도 422 배열이다")
    void practiceStart_videoMustBeUsableAndInputsBounded() throws Exception {
        UUID purged = video(member);
        jdbc.update("UPDATE videos SET purged_at=now() WHERE id=?", purged);
        UUID foreign = video(member());

        for (UUID unusable : List.of(UUID.randomUUID(), purged, foreign)) {
            assertThat(json(post("/v2/practices").content(startBody(UUID.randomUUID(), unusable, null, null)), 422))
                    .as(unusable.toString()).isEqualTo(mapper.readTree("{\"detail\":\"video_not_ready\"}"));
        }
        assertThat(count("practices")).isZero();
        assertThat(count("ai_jobs")).isZero();

        assertThat(json(post("/v2/practices").content(startBody(UUID.randomUUID(), video,
                scene("가".repeat(PracticeRules.SCENE_MAX_CHARS), null, null),
                blockage("그 외", "그 외", "나".repeat(PracticeRules.BLOCKAGE_NOTE_MAX_CHARS)))), 201)
                .path("situation").textValue()).hasSize(PracticeRules.SCENE_MAX_CHARS);

        List<String> malformed = List.of(
                startBody(UUID.randomUUID(), video, scene("가".repeat(PracticeRules.SCENE_MAX_CHARS + 1), null, null), null),
                startBody(UUID.randomUUID(), video, null,
                        blockage("그 외", "그 외", "나".repeat(PracticeRules.BLOCKAGE_NOTE_MAX_CHARS + 1))),
                startBody(UUID.randomUUID(), video, null, blockage("분석", "감정", null)),
                startBody(UUID.randomUUID(), video, null, blockage("연기", null, null)),
                "{\"request_id\":\"" + UUID.randomUUID() + "\"}",
                "{}");
        for (String body : malformed) {
            MockHttpServletResponse rejected = perform(
                    post("/v2/practices").contentType(MediaType.APPLICATION_JSON).content(body), bearer);
            assertThat(rejected.getStatus()).as(body).isEqualTo(422);
            assertThat(mapper.readTree(rejected.getContentAsString()).path("detail").isArray()).as(body).isTrue();
        }
        assertThat(count("practices")).as("거절된 요청은 아무것도 남기지 않는다").isEqualTo(1);
    }

    @Test
    @DisplayName("account.guest·practice.start: 게스트의 하루 네 번째 시작 — 429 guest_daily_analysis_limit 이고 회차·작업이 생기지 않는다. "
            + "한국 시간 자정이 지나면 다시 된다")
    void practiceStart_guestsGetThreeAnalysesPerKoreanDay() throws Exception {
        Guest guest = consentedGuest();
        for (int attempt = 1; attempt <= PracticeRules.GUEST_DAILY_ANALYSES; attempt++) {
            UUID guestVideo = video(guest.id());
            json(post("/v2/practices").content(startBody(UUID.randomUUID(), guestVideo, null, null)), guest.bearer(), 201);
        }
        UUID fourth = video(guest.id());

        assertThat(json(post("/v2/practices").content(startBody(UUID.randomUUID(), fourth, null, null)), guest.bearer(), 429))
                .isEqualTo(mapper.readTree("{\"detail\":\"guest_daily_analysis_limit\"}"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practices WHERE user_id=?", Integer.class, guest.id()))
                .isEqualTo(PracticeRules.GUEST_DAILY_ANALYSES);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ai_jobs WHERE user_id=?", Integer.class, guest.id()))
                .isEqualTo(PracticeRules.GUEST_DAILY_ANALYSES);

        clock.set(LocalDate.now(SEOUL).plusDays(1).atTime(0, 30).atZone(SEOUL).toInstant());

        assertThat(json(post("/v2/practices").content(startBody(UUID.randomUUID(), fourth, null, null)), guest.bearer(), 201)
                .path("ordinal").intValue()).as("자정을 넘기면 다시 된다").isEqualTo(1);
        assertThat(json(post("/v2/practices").content(startBody(UUID.randomUUID(), video, null, null)), 201)
                .path("stage").textValue()).as("회원에게는 한도가 없다").isEqualTo("analyzing");
    }

    @Test
    @DisplayName("practice.resume: 1차가 closed 인 묶음에서 이어하기 — ordinal 2 행이고 root_id·video_id 가 1차와 같으며 ai_jobs 가 하나 는다. "
            + "새 영상으로 이어하기 — ordinal 3 이고 video_id 가 새 영상이다. 숨긴 묶음에서도 되고 묶음은 숨김 그대로다")
    void practiceResume_continuesTheGroupWithTheNextOrdinal() throws Exception {
        JsonNode first = json(post("/v2/practices").content(startBody(UUID.randomUUID(), video, null, null)), 201);
        UUID firstId = UUID.fromString(first.path("id").textValue());
        close(firstId);

        JsonNode second = json(post("/v2/practices/{id}/continue", firstId)
                .content(continueBody(UUID.randomUUID(), null, scene("다시 찍는다", null, null), null)), 201);

        assertThat(second.path("ordinal").intValue()).isEqualTo(2);
        assertThat(second.path("root_id").textValue()).isEqualTo(firstId.toString());
        assertThat(second.path("video_id").textValue()).as("같은 영상을 그대로 쓴다").isEqualTo(video.toString());
        assertThat(second.path("situation").textValue()).isEqualTo("다시 찍는다");
        assertThat(count("ai_jobs")).isEqualTo(2);
        assertThat(count("video_transcripts")).as("받아쓰기는 늘지 않는다").isZero();

        json(patch("/v2/practices/{id}/group", firstId).content("{\"hidden\":true}"), 200);
        close(UUID.fromString(second.path("id").textValue()));
        UUID fresh = video(member);
        JsonNode third = json(post("/v2/practices/{id}/continue", second.path("id").textValue())
                .content(continueBody(UUID.randomUUID(), fresh, null, null)), 201);

        assertThat(third.path("ordinal").intValue()).isEqualTo(3);
        assertThat(third.path("root_id").textValue()).isEqualTo(firstId.toString());
        assertThat(third.path("video_id").textValue()).isEqualTo(fresh.toString());
        assertThat(jdbc.queryForObject("SELECT hidden_at FROM practices WHERE id=?", OffsetDateTime.class, firstId))
                .as("묶음은 숨김 그대로").isNotNull();
    }

    @Test
    @DisplayName("practice.resume: 1차가 진행 중인 채 이어하기 — 409 practice_in_progress 이고 본문은 코드 하나다. 묶음 조회의 "
            + "in_progress_practice_id 로 그 회차에 복귀한다. 파일만 파기한 영상의 회차에서 같은 영상으로 이어하기 — 422 video_not_ready, 새 영상은 된다")
    void practiceResume_refusesWhileSomethingIsStillOpen() throws Exception {
        JsonNode first = json(post("/v2/practices").content(startBody(UUID.randomUUID(), video, null, null)), 201);
        UUID firstId = UUID.fromString(first.path("id").textValue());

        assertThat(json(post("/v2/practices/{id}/continue", firstId)
                .content(continueBody(UUID.randomUUID(), null, null, null)), 409))
                .isEqualTo(mapper.readTree("{\"detail\":\"practice_in_progress\"}"));
        assertThat(count("practices")).isEqualTo(1);

        JsonNode groups = json(get("/v2/practices"), 200).path("groups");
        assertThat(groups).hasSize(1);
        assertThat(groups.get(0).path("in_progress_practice_id").textValue()).isEqualTo(firstId.toString());
        assertThat(groups.get(0).path("ordinal_count").intValue()).isEqualTo(1);

        close(firstId);
        jdbc.update("UPDATE videos SET purged_at=now() WHERE id=?", video);

        assertThat(json(post("/v2/practices/{id}/continue", firstId)
                .content(continueBody(UUID.randomUUID(), null, null, null)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"video_not_ready\"}"));
        UUID fresh = video(member);
        assertThat(json(post("/v2/practices/{id}/continue", firstId)
                .content(continueBody(UUID.randomUUID(), fresh, null, null)), 201)
                .path("ordinal").intValue()).as("새 영상으로는 된다").isEqualTo(2);
    }

    @Test
    @DisplayName("practice.resume: 서로 다른 요청 id 로 동시에 이어하기 둘 — ordinal 2 는 하나만 생기고 다른 요청은 409 다. 같은 요청 id 둘 — 같은 회차")
    void practiceResume_concurrentContinuesYieldOneOrdinal() throws Exception {
        JsonNode first = json(post("/v2/practices").content(startBody(UUID.randomUUID(), video, null, null)), 201);
        UUID firstId = UUID.fromString(first.path("id").textValue());
        close(firstId);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        List<Integer> statuses;
        try {
            Future<Integer> one = pool.submit(() -> perform(post("/v2/practices/{id}/continue", firstId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(continueBody(UUID.randomUUID(), null, null, null)), bearer).getStatus());
            Future<Integer> two = pool.submit(() -> perform(post("/v2/practices/{id}/continue", firstId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(continueBody(UUID.randomUUID(), null, null, null)), bearer).getStatus());
            statuses = List.of(one.get(), two.get());
        } finally {
            pool.shutdownNow();
        }
        assertThat(statuses).as("묶음 잠금이 둘을 줄 세운다").containsExactlyInAnyOrder(201, 409);
        assertThat(jdbc.queryForList("SELECT ordinal FROM practices WHERE root_id=? ORDER BY ordinal", Integer.class, firstId))
                .containsExactly(1, 2);

        UUID requestId = UUID.randomUUID();
        UUID openId = jdbc.queryForObject(
                "SELECT id FROM practices WHERE root_id=? AND ordinal=2", UUID.class, firstId);
        close(openId);
        JsonNode third = json(post("/v2/practices/{id}/continue", firstId)
                .content(continueBody(requestId, null, null, null)), 201);
        JsonNode replayed = json(post("/v2/practices/{id}/continue", firstId)
                .content(continueBody(requestId, null, null, null)), 201);
        assertThat(replayed.path("id").textValue()).isEqualTo(third.path("id").textValue());
        assertThat(count("practices")).isEqualTo(3);
    }

    @Test
    @DisplayName("practice.analyze: 상태 폴링 — pending 에서 running 을 거쳐 성공하면 stage 가 conversing 이고 analysis_status 가 ready 다. "
            + "\"그만두기\" — 작업이 failed/cancelled 이고 lease 가 없으며 회차는 closed 다. 이미 끝난 분석의 취소는 409")
    void practiceAnalyze_statusFollowsTheJobAndCancelClosesIt() throws Exception {
        JsonNode created = json(post("/v2/practices").content(startBody(UUID.randomUUID(), video, null, null)), 201);
        UUID practiceId = UUID.fromString(created.path("id").textValue());

        assertThat(json(get("/v2/practices/{id}/status", practiceId), 200).path("job").path("status").textValue())
                .isEqualTo("pending");
        jdbc.update("UPDATE ai_jobs SET status='running',lease_token=?,lease_expires_at=now()+interval '10 minutes' "
                + "WHERE target_id=?", UUID.randomUUID(), practiceId);
        assertThat(json(get("/v2/practices/{id}/status", practiceId), 200).path("job").path("status").textValue())
                .isEqualTo("running");

        // 워커가 끝낸 자리(PA3)를 흉내 낸다 — 작업 성공과 관찰 기록 저장, 그리고 회차의 stage 전이.
        jdbc.update("UPDATE ai_jobs SET status='succeeded',lease_token=NULL,lease_expires_at=NULL WHERE target_id=?", practiceId);
        jdbc.update("""
                INSERT INTO analyses(id,practice_id,format,status,model,record,completed_at)
                VALUES (?,?,'video_record_v1','ready','test-model',CAST('{}' AS jsonb),now())
                """, UUID.randomUUID(), practiceId);
        jdbc.update("UPDATE practices SET stage='conversing' WHERE id=?", practiceId);

        JsonNode done = json(get("/v2/practices/{id}/status", practiceId), 200);
        assertThat(done.path("stage").textValue()).isEqualTo("conversing");
        assertThat(done.path("analysis_status").textValue()).isEqualTo("ready");
        assertThat(done.path("job").path("status").textValue()).isEqualTo("succeeded");
        assertThat(json(post("/v2/practices/{id}/cancel", practiceId), 409))
                .as("이미 끝난 분석").isEqualTo(mapper.readTree("{\"detail\":\"analysis_already_finished\"}"));

        UUID second = video(member);
        UUID running = UUID.fromString(json(post("/v2/practices").content(startBody(UUID.randomUUID(), second, null, null)), 201)
                .path("id").textValue());
        jdbc.update("UPDATE ai_jobs SET status='running',lease_token=?,lease_expires_at=now()+interval '10 minutes' "
                + "WHERE target_id=?", UUID.randomUUID(), running);

        JsonNode cancelled = json(post("/v2/practices/{id}/cancel", running), 200);

        assertThat(cancelled.path("stage").textValue()).isEqualTo("closed");
        assertThat(cancelled.path("close_reason").textValue()).isEqualTo("cancelled");
        assertThat(cancelled.path("job").path("status").textValue()).isEqualTo("failed");
        assertThat(cancelled.path("job").path("failure_reason").textValue()).isEqualTo("cancelled");
        assertThat(jdbc.queryForMap("SELECT lease_token,lease_expires_at FROM ai_jobs WHERE target_id=?", running))
                .as("늦은 완료와 재큐를 막는다").containsEntry("lease_token", null).containsEntry("lease_expires_at", null);
    }

    @Test
    @DisplayName("practice.analyze: 분석이 최종 실패해 닫힌 회차를 다시 시도 — 새 ai_jobs 가 생기고 stage 가 analyzing 으로 돌아간다. "
            + "아직 실패하지 않은 회차 — 409 analysis_not_failed. 묶음에 다른 진행 중 회차가 있으면 409 practice_in_progress")
    void practiceAnalyze_retryNeedsAFailedPracticeAndAnIdleGroup() throws Exception {
        JsonNode created = json(post("/v2/practices").content(startBody(UUID.randomUUID(), video, null, null)), 201);
        UUID practiceId = UUID.fromString(created.path("id").textValue());

        assertThat(json(post("/v2/practices/{id}/analyze", practiceId)
                .content("{\"request_id\":\"" + UUID.randomUUID() + "\"}"), 409))
                .isEqualTo(mapper.readTree("{\"detail\":\"analysis_not_failed\"}"));

        jdbc.update("UPDATE ai_jobs SET status='failed',failure_reason='timeout' WHERE target_id=?", practiceId);
        jdbc.update("UPDATE practices SET stage='closed',close_reason='analysis_failed' WHERE id=?", practiceId);
        UUID retryRequest = UUID.randomUUID();

        JsonNode retried = json(post("/v2/practices/{id}/analyze", practiceId)
                .content("{\"request_id\":\"" + retryRequest + "\"}"), 201);

        assertThat(retried.path("stage").textValue()).isEqualTo("analyzing");
        assertThat(retried.path("close_reason").isNull()).isTrue();
        assertThat(retried.path("job").path("status").textValue()).isEqualTo("pending");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ai_jobs WHERE target_id=?", Integer.class, practiceId))
                .isEqualTo(2);
        assertThat(json(post("/v2/practices/{id}/analyze", practiceId)
                .content("{\"request_id\":\"" + retryRequest + "\"}"), 201).path("id").textValue())
                .as("같은 요청 id 재전송").isEqualTo(retried.path("id").textValue());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ai_jobs WHERE target_id=?", Integer.class, practiceId))
                .isEqualTo(2);

        // 같은 묶음의 다음 회차가 열려 있으면 앞 회차를 다시 돌리지 않는다.
        close(practiceId);
        UUID next = UUID.fromString(json(post("/v2/practices/{id}/continue", practiceId)
                .content(continueBody(UUID.randomUUID(), null, null, null)), 201).path("id").textValue());
        jdbc.update("UPDATE ai_jobs SET status='failed',failure_reason='timeout' WHERE target_id=?", practiceId);
        assertThat(json(post("/v2/practices/{id}/analyze", practiceId)
                .content("{\"request_id\":\"" + UUID.randomUUID() + "\"}"), 409))
                .isEqualTo(mapper.readTree("{\"detail\":\"practice_in_progress\"}"));
        assertThat(next).isNotNull();
    }

    @Test
    @DisplayName("practice.library: 묶음 목록 — 회차 요약·즐겨찾기·제목이 오고 숨기면 목록에서 사라지며 노트·대화 행은 그대로다. "
            + "필터 favorite·recent30 이 맞고 모르는 필터는 422 배열. 없는 묶음·남의 묶음은 404 practice_not_found")
    void practiceLibrary_groupsCarryTheirPracticesAndAttributes() throws Exception {
        JsonNode first = json(post("/v2/practices").content(
                startBody(UUID.randomUUID(), video, scene("문 앞", null, null), null)), 201);
        UUID rootId = UUID.fromString(first.path("id").textValue());
        close(rootId);
        // 묶음은 최근 순이라 두 묶음의 시각이 같으면 순서가 id 에 달린다 — 한 칸 벌려 순서를 못 박는다.
        clock.advance(java.time.Duration.ofMinutes(1));
        UUID otherVideo = video(member);
        UUID otherRoot = UUID.fromString(json(post("/v2/practices").content(
                startBody(UUID.randomUUID(), otherVideo, null, null)), 201).path("id").textValue());

        JsonNode groups = json(get("/v2/practices"), 200).path("groups");
        assertThat(groups).hasSize(2);
        assertThat(groups.get(0).path("root_id").textValue()).as("최근 묶음이 먼저다").isEqualTo(otherRoot.toString());
        JsonNode group = groups.get(1);
        assertThat(group.path("root_id").textValue()).isEqualTo(rootId.toString());
        assertThat(group.path("practices")).hasSize(1);
        assertThat(group.path("practices").get(0).path("situation").textValue()).isEqualTo("문 앞");
        assertThat(group.path("practices").get(0).path("conversation_count").intValue()).isZero();
        assertThat(group.path("practices").get(0).path("note_title").isNull()).isTrue();
        assertThat(group.path("title").isNull()).as("제목은 화면이 대체 규칙으로 채운다").isTrue();
        assertThat(group.path("favorite").booleanValue()).isFalse();
        assertThat(group.path("in_progress_practice_id").isNull()).isTrue();
        assertThat(group.path("last_conversation_at").isNull()).isTrue();
        assertThat(group.path("tags")).isEmpty();

        JsonNode marked = json(patch("/v2/practices/{id}/group", rootId)
                .content("{\"favorite\":true,\"title\":\"갈매기 1장\"}"), 200);
        assertThat(marked.path("favorite").booleanValue()).isTrue();
        assertThat(marked.path("title").textValue()).isEqualTo("갈매기 1장");
        assertThat(json(get("/v2/practices?filter=favorite"), 200).path("groups"))
                .extracting(g -> g.path("root_id").textValue()).containsExactly(rootId.toString());

        json(patch("/v2/practices/{id}/group", rootId).content("{\"hidden\":true}"), 200);
        assertThat(json(get("/v2/practices"), 200).path("groups"))
                .extracting(g -> g.path("root_id").textValue()).as("숨긴 묶음은 목록에서 빠진다")
                .containsExactly(otherRoot.toString());
        assertThat(count("practices")).as("행은 그대로다").isEqualTo(2);
        assertThat(json(patch("/v2/practices/{id}/group", rootId).content("{\"hidden\":false}"), 200)
                .path("hidden_at").isNull()).isTrue();

        jdbc.update("UPDATE practices SET created_at=now() - interval '40 days' WHERE id=?", rootId);
        assertThat(json(get("/v2/practices?filter=recent30"), 200).path("groups"))
                .extracting(g -> g.path("root_id").textValue()).containsExactly(otherRoot.toString());

        MockHttpServletResponse unknown = perform(get("/v2/practices?filter=weekly"), bearer);
        assertThat(unknown.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(unknown.getContentAsString()).path("detail").isArray()).isTrue();
        assertThat(json(get("/v2/practices/{id}", UUID.randomUUID()), 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"practice_not_found\"}"));
        assertThat(perform(patch("/v2/practices/{id}/group", rootId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"favorite\":true}"), "Bearer " + jwt.issueAccessToken(member()).value())
                .getStatus()).as("남의 묶음").isEqualTo(404);
    }

    // ---- helpers ----

    private String startBody(UUID requestId, UUID videoId, String scene, String blockage) {
        StringBuilder body = new StringBuilder("{\"request_id\":\"" + requestId + "\",\"video_id\":\"" + videoId + "\"");
        if (scene != null) {
            body.append(",\"scene\":").append(scene);
        }
        if (blockage != null) {
            body.append(",\"blockage\":").append(blockage);
        }
        return body.append("}").toString();
    }

    private String continueBody(UUID requestId, UUID videoId, String scene, String blockage) {
        StringBuilder body = new StringBuilder("{\"request_id\":\"" + requestId + "\"");
        if (videoId != null) {
            body.append(",\"video_id\":\"").append(videoId).append("\"");
        }
        if (scene != null) {
            body.append(",\"scene\":").append(scene);
        }
        if (blockage != null) {
            body.append(",\"blockage\":").append(blockage);
        }
        return body.append("}").toString();
    }

    private String scene(String situation, String character, String goal) {
        return "{\"situation\":" + quoted(situation) + ",\"character\":" + quoted(character)
                + ",\"goal\":" + quoted(goal) + "}";
    }

    private String blockage(String category, String detail, String note) {
        return "{\"category\":" + quoted(category) + ",\"detail\":" + quoted(detail) + ",\"note\":" + quoted(note) + "}";
    }

    private static String quoted(String value) {
        return value == null ? "null" : "\"" + value + "\"";
    }

    /** 회차를 닫는다 — 분석이 끝나 대화까지 마친 자리(PA3·PA4)를 흉내 낸다. */
    private void close(UUID practiceId) {
        jdbc.update("UPDATE practices SET stage='closed',close_reason='conversation_closed' WHERE id=?", practiceId);
        jdbc.update("UPDATE ai_jobs SET status='succeeded' WHERE target_id=? AND status='pending'", practiceId);
    }

    /** 보관함에 확정된 영상 하나. 보관함 API 는 PA1 의 것이라 행만 넣는다. */
    private UUID video(UUID owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, id, owner, "videos/" + owner + "/" + id + ".mp4");
        return id;
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    private record Guest(UUID id, String bearer) {
    }

    /** 연습의 문서 셋에 동의한 게스트. */
    private Guest consentedGuest() throws Exception {
        var response = mvc.perform(post("/v2/auth/guest").with(request -> {
            request.setRemoteAddr("10.58." + ADDRESSES.incrementAndGet() + ".1");
            return request;
        })).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(response.getContentAsString());
        Guest guest = new Guest(UUID.fromString(body.path("user").path("id").textValue()),
                "Bearer " + body.path("access_token").textValue());
        for (String type : List.of("terms", "privacy", "ai_analysis")) {
            Map<String, Object> consent = new LinkedHashMap<>();
            consent.put("document_id", documents.get(type).toString());
            consent.put("action", "granted");
            if ("terms".equals(type)) {
                consent.put("age_confirmed", true);
            }
            var consented = perform(post("/v2/consents").contentType(MediaType.APPLICATION_JSON)
                    .content(mapper.writeValueAsString(consent)), guest.bearer());
            assertThat(consented.getStatus()).as(consented.getContentAsString()).isEqualTo(201);
        }
        return guest;
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String authorization) throws Exception {
        return mvc.perform(request.header("Authorization", authorization)).andReturn().getResponse();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        return json(request, bearer, status);
    }

    private JsonNode json(MockHttpServletRequestBuilder request, String authorization, int status) throws Exception {
        var response = perform(request.contentType(MediaType.APPLICATION_JSON), authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }
}
