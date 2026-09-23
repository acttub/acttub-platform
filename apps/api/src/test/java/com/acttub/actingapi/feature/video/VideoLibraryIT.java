package com.acttub.actingapi.feature.video;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.IntSupplier;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.app.AccountCleanup;
import com.acttub.actingapi.feature.video.domain.VideoRules;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
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
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * practice.record·practice.library 의 "검증 방법" 가운데 서버가 맡는 항목을 HTTP 와 실제 Postgres 로 본다.
 * 오브젝트 스토리지는 메모리의 가짜다 — 기기가 PUT 하는 자리는 그 가짜에 직접 넣어 흉내 낸다.
 *
 * <p>여기서 보지 못하는 것: 기기의 촬영·압축·크기 검사와 업로드 큐(앱), presigned PUT 과 서명 주소의 실제 만료
 * (저장소), 옛 기기 보관함 옮기기(앱). 회차·참여작이 참조하는 자리는 {@code practices} 에 행을 직접 넣어 본다 —
 * 회차 API 는 PA2 의 것이고 챌린지 참여작 테이블은 아직 없다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    // 한도 직전의 동시 업로드 둘이 저마다 커넥션을 쥔 채 사용자 행을 기다린다.
    "spring.datasource.hikari.maximum-pool-size=12"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, VideoLibraryIT.Fixture.class})
class VideoLibraryIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final long QUOTA_GATE = 546_006L;
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    private static String database;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("video_library");
        database = name;
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

    @Autowired
    FakeStorage storage;

    @Autowired
    AccountCleanup cleanup;

    private final Map<String, UUID> documents = new LinkedHashMap<>();
    private UUID member;
    private String bearer;
    private String address;

    @BeforeEach
    void setUp() {
        jdbc.execute("DROP TRIGGER IF EXISTS hold_video_insert ON videos");
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
        storage.objects.clear();
        storage.failing.clear();
        clock.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        address = "10.56.0." + ADDRESSES.incrementAndGet();
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("practice.record: 촬영 뒤 마무리까지 하고 아무것도 고르지 않음 — videos 1행이고 practices·ai_jobs 행이 없으며 보관함에 보인다. "
            + "마무리 응답 유실 뒤 같은 예약으로 재전송 — 200 이고 같은 영상, 행 하나")
    void practiceRecord_completingAnIntentStoresExactlyOneVideo() throws Exception {
        JsonNode intent = json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 1_000_000, 12_000)), 201);

        assertThat(intent.fieldNames()).toIterable().containsExactlyInAnyOrder("intent_id", "upload_url", "expires_at");
        assertThat(intent.path("upload_url").textValue()).startsWith("https://storage.test/put/videos/" + member + "/");
        assertThat(Instant.parse(intent.path("expires_at").textValue())).isEqualTo(clock.instant().plus(VideoRules.INTENT_TTL));
        assertThat(count("videos")).as("마무리 전에는 보관함에 없다").isZero();

        deviceUploads(intent, 1_000_000);
        JsonNode created = json(post("/v2/videos/intents/{id}/complete", intentId(intent)), 201);

        assertThat(created.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "id", "duration_ms", "byte_size", "content_type", "favorite", "purged_at", "created_at", "usage",
                "playback_url", "playback_expires_at");
        assertThat(created.path("duration_ms").intValue()).isEqualTo(12_000);
        assertThat(created.path("byte_size").longValue()).isEqualTo(1_000_000L);
        assertThat(created.path("content_type").textValue()).isEqualTo("video/mp4");
        assertThat(created.path("favorite").booleanValue()).isFalse();
        assertThat(created.path("purged_at").isNull()).isTrue();
        assertThat(created.path("usage").path("practice_count").intValue()).isZero();
        assertThat(created.path("usage").path("entry_count").intValue()).isZero();
        assertThat(count("videos")).isEqualTo(1);
        assertThat(count("practices")).isZero();
        assertThat(count("ai_jobs")).isZero();
        assertThat(count("video_transcripts")).as("보관만 하면 받아쓰기를 만들지 않는다").isZero();
        assertThat(jdbc.queryForObject("SELECT status FROM upload_intents", String.class)).isEqualTo("finalized");
        assertThat(jdbc.queryForObject("SELECT video_id FROM upload_intents", UUID.class))
                .isEqualTo(UUID.fromString(created.path("id").textValue()));
        JsonNode list = json(get("/v2/videos"), 200);
        assertThat(list.path("videos")).hasSize(1);
        assertThat(list.path("videos").get(0).path("id").textValue()).isEqualTo(created.path("id").textValue());
        assertThat(list.path("videos").get(0).path("playback_url").isNull()).as("목록에는 재생 주소가 없다").isTrue();
        assertThat(list.path("next_cursor").isNull()).isTrue();

        JsonNode replayed = json(post("/v2/videos/intents/{id}/complete", intentId(intent)), 200);
        assertThat(replayed.path("id").textValue()).isEqualTo(created.path("id").textValue());
        assertThat(count("videos")).isEqualTo(1);
    }

    @Test
    @DisplayName("practice.record: 100MiB + 1바이트 메타 — 422 video_too_large. 5분 1초 — 422 video_too_long. 정확히 100MiB·5분 — 예약된다. "
            + "실제 올라온 바이트가 메타와 다름 — 422 video_not_ready 이고 영상이 생기지 않는다")
    void practiceRecord_sizeAndDurationLimitsAndByteMismatch() throws Exception {
        assertThat(json(post("/v2/videos/intents")
                .content(intentBody(UUID.randomUUID(), "video/mp4", VideoRules.FILE_MAX_BYTES + 1, 10_000)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"video_too_large\"}"));
        assertThat(json(post("/v2/videos/intents")
                .content(intentBody(UUID.randomUUID(), "video/mp4", 1_000, VideoRules.DURATION_MAX_MS + 1_000)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"video_too_long\"}"));
        assertThat(count("upload_intents")).isZero();

        JsonNode limit = json(post("/v2/videos/intents")
                .content(intentBody(UUID.randomUUID(), "video/mp4", VideoRules.FILE_MAX_BYTES, VideoRules.DURATION_MAX_MS)), 201);
        deviceUploads(limit, VideoRules.FILE_MAX_BYTES);
        assertThat(json(post("/v2/videos/intents/{id}/complete", intentId(limit)), 201).path("byte_size").longValue())
                .isEqualTo(VideoRules.FILE_MAX_BYTES);

        JsonNode other = json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/quicktime", 2_000, 9_000)), 201);
        deviceUploads(other, 2_222);
        assertThat(json(post("/v2/videos/intents/{id}/complete", intentId(other)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"video_not_ready\"}"));
        assertThat(count("videos")).as("메타와 다른 파일은 영상이 되지 않는다").isEqualTo(1);

        // 아직 올라오지 않은 예약의 마무리도 같은 답이다.
        JsonNode pending = json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 3_000, 9_000)), 201);
        assertThat(json(post("/v2/videos/intents/{id}/complete", intentId(pending)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"video_not_ready\"}"));
    }

    @Test
    @DisplayName("practice.record: 총량 5GiB 를 넘긴 회원의 새 업로드 — 422 video_quota 이고 기존 행은 그대로다. 게스트 500MiB 도 같다. "
            + "이관으로 총량을 넘긴 회원 — 기존은 모두 보이고 새 업로드만 422")
    void practiceRecord_quotaRejectsOnlyNewUploads() throws Exception {
        seedVideo(member, VideoRules.MEMBER_QUOTA_BYTES - 1_000, null);

        assertThat(json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 2_000, 9_000)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"video_quota\"}"));
        assertThat(count("videos")).isEqualTo(1);
        assertThat(count("upload_intents")).as("예약도 만들지 않는다").isZero();
        // 남은 자리에 딱 맞는 업로드는 된다.
        JsonNode fits = json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 1_000, 9_000)), 201);
        deviceUploads(fits, 1_000);
        json(post("/v2/videos/intents/{id}/complete", intentId(fits)), 201);

        Guest guest = consentedGuest();
        seedVideo(guest.id(), VideoRules.GUEST_QUOTA_BYTES, null);
        assertThat(json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 1_000, 9_000)),
                guest.bearer(), 422)).isEqualTo(mapper.readTree("{\"detail\":\"video_quota\"}"));

        transfer(guest);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM videos WHERE user_id=?", Integer.class, member))
                .as("이관으로 넘어도 기존은 모두 보존한다").isEqualTo(3);
        assertThat(json(get("/v2/videos"), 200).path("videos")).hasSize(3);
        assertThat(json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 1_000, 9_000)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"video_quota\"}"));
    }

    @Test
    @DisplayName("practice.record: 한도 직전에 동시 업로드 둘 — 하나만 확정되고 다른 것은 422 video_quota 다(사용자 행에서 줄을 선다)")
    void practiceRecord_concurrentCompletionsCannotBothPassTheQuota() throws Exception {
        seedVideo(member, VideoRules.MEMBER_QUOTA_BYTES - 1_500, null);
        JsonNode first = json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 1_000, 9_000)), 201);
        JsonNode second = json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 1_000, 9_000)), 201);
        deviceUploads(first, 1_000);
        deviceUploads(second, 1_000);
        holdVideoInserts();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        List<Integer> statuses;
        try (Connection gate = outsideConnection()) {
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_lock(" + QUOTA_GATE + ")");
            }
            Future<Integer> one = pool.submit(() -> perform(post("/v2/videos/intents/{id}/complete", intentId(first)), bearer).getStatus());
            awaitUntil("첫 확정이 문 앞에 서기", 1, this::lockWaiters);
            Future<Integer> two = pool.submit(() -> perform(post("/v2/videos/intents/{id}/complete", intentId(second)), bearer).getStatus());
            awaitUntil("둘째 확정이 사용자 행에서 줄을 서기", 2, this::lockWaiters);
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_unlock(" + QUOTA_GATE + ")");
            }
            statuses = List.of(one.get(), two.get());
        } finally {
            pool.shutdownNow();
        }
        assertThat(statuses).as("하나는 만들어지고 하나는 거절된다").containsExactlyInAnyOrder(201, 422);
        assertThat(count("videos")).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COALESCE(sum(byte_size),0) FROM videos", Long.class))
                .isLessThanOrEqualTo(VideoRules.MEMBER_QUOTA_BYTES);
    }

    @Test
    @DisplayName("practice.record: 올릴 자리만 받고 31분 뒤 마무리 — 422 upload_expired 이고 videos 행이 없으며 미확정 객체가 삭제 장부에 들어간다. "
            + "장부가 성공하면 객체가 없다")
    void practiceRecord_expiredIntentsLeaveNoVideoAndScheduleTheObject() throws Exception {
        JsonNode intent = json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 5_000, 9_000)), 201);
        deviceUploads(intent, 5_000);

        clock.advance(VideoRules.INTENT_TTL.plusMinutes(1));

        assertThat(json(post("/v2/videos/intents/{id}/complete", intentId(intent)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"upload_expired\"}"));
        assertThat(count("videos")).isZero();
        assertThat(jdbc.queryForObject("SELECT status FROM upload_intents", String.class)).isEqualTo("expired");
        assertThat(count("account_cleanup_operations")).as("장부가 시도했고 성공해 남지 않는다").isZero();
        assertThat(storage.objects).as("미확정 객체는 지워졌다").isEmpty();

        // 저장소가 거절하면 키가 장부에 남아 다시 시도된다.
        JsonNode stubborn = json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 5_000, 9_000)), 201);
        String key = jdbc.queryForObject(
                "SELECT object_key FROM upload_intents WHERE id=?", String.class, intentId(stubborn));
        deviceUploads(stubborn, 5_000);
        storage.failing.add(key);
        clock.advance(VideoRules.INTENT_TTL.plusMinutes(1));
        json(post("/v2/videos/intents/{id}/complete", intentId(stubborn)), 422);
        assertThat(jdbc.queryForObject("SELECT kind FROM account_cleanup_operations", String.class)).isEqualTo("object_delete");
        assertThat(storage.objects).containsKey(key);

        storage.failing.clear();
        clock.advance(Duration.ofMinutes(6));
        cleanup.runDue();
        assertThat(storage.objects).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("practice.record: 같은 요청 id 로 자리를 다시 받음 — 같은 예약이고 행이 늘지 않는다. 같은 id·다른 본문 — 422 request_fingerprint_mismatch. "
            + "X-Request-Id 가 본문과 다르면 422 배열, MP4·MOV 가 아니면 422 배열")
    void practiceRecord_intentsAreIdempotentPerRequestId() throws Exception {
        UUID requestId = UUID.randomUUID();
        JsonNode first = json(post("/v2/videos/intents").header("X-Request-Id", requestId.toString())
                .content(intentBody(requestId, "video/mp4", 4_000, 9_000)), 201);
        JsonNode again = json(post("/v2/videos/intents").header("X-Request-Id", requestId.toString())
                .content(intentBody(requestId, "video/mp4", 4_000, 9_000)), 201);

        assertThat(again.path("intent_id").textValue()).isEqualTo(first.path("intent_id").textValue());
        assertThat(again.path("upload_url").textValue()).as("같은 객체 키로 이어 올린다")
                .isEqualTo(first.path("upload_url").textValue());
        assertThat(count("upload_intents")).isEqualTo(1);

        assertThat(json(post("/v2/videos/intents").content(intentBody(requestId, "video/mp4", 9_999, 9_000)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"request_fingerprint_mismatch\"}"));
        assertThat(count("upload_intents")).isEqualTo(1);

        MockHttpServletResponse mismatch = perform(post("/v2/videos/intents")
                .header("X-Request-Id", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content(intentBody(UUID.randomUUID(), "video/mp4", 4_000, 9_000)), bearer);
        assertThat(mismatch.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(mismatch.getContentAsString()).path("detail").get(0).path("loc"))
                .extracting(JsonNode::asText).containsExactly("header", "X-Request-Id");

        for (String body : List.of(
                intentBody(UUID.randomUUID(), "video/webm", 4_000, 9_000),
                intentBody(UUID.randomUUID(), "image/png", 4_000, 9_000),
                "{\"request_id\":\"" + UUID.randomUUID() + "\",\"content_type\":\"video/mp4\",\"byte_size\":100}",
                "{}")) {
            MockHttpServletResponse rejected = perform(
                    post("/v2/videos/intents").contentType(MediaType.APPLICATION_JSON).content(body), bearer);
            assertThat(rejected.getStatus()).as(body).isEqualTo(422);
            assertThat(mapper.readTree(rejected.getContentAsString()).path("detail").isArray()).as(body).isTrue();
        }
    }

    @Test
    @DisplayName("account.guest·practice.record: 동의하지 않은 새 게스트의 올리기 — 403 consent_required 와 이용약관·개인정보·AI 분석 동의 셋. "
            + "동의 뒤에는 보관함의 모든 경로가 열린다")
    void practiceRecord_aGuestNeedsTheThreePracticeConsents() throws Exception {
        Guest guest = guest();

        MockHttpServletResponse blocked = perform(post("/v2/videos/intents").contentType(MediaType.APPLICATION_JSON)
                .content(intentBody(UUID.randomUUID(), "video/mp4", 1_000, 9_000)), guest.bearer());

        assertThat(blocked.getStatus()).isEqualTo(403);
        JsonNode body = mapper.readTree(blocked.getContentAsString());
        assertThat(body.path("detail").textValue()).isEqualTo("consent_required");
        assertThat(body.path("pending_consents")).extracting(document -> document.path("type").textValue())
                .as("보관만 하는 데에도 AI 분석 동의를 받는다").containsExactly("terms", "privacy", "ai_analysis");
        assertThat(count("upload_intents")).isZero();

        for (String type : List.of("terms", "privacy", "ai_analysis")) {
            consent(guest, type, "terms".equals(type));
        }

        JsonNode intent = json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 1_000, 9_000)),
                guest.bearer(), 201);
        deviceUploads(intent, 1_000);
        String videoId = json(post("/v2/videos/intents/{id}/complete", intentId(intent)), guest.bearer(), 201)
                .path("id").textValue();
        assertThat(perform(get("/v2/videos"), guest.bearer()).getStatus()).isEqualTo(200);
        assertThat(perform(get("/v2/videos/{id}", videoId), guest.bearer()).getStatus()).isEqualTo(200);
        assertThat(perform(delete("/v2/videos/{id}", videoId), guest.bearer()).getStatus()).isEqualTo(204);
    }

    @Test
    @DisplayName("practice.library: 보관함 조회 — 최신 저장순이고 예시 영상이 없다. 최근 7일 필터는 7일 안의 것만, 즐겨찾기 필터는 표시한 것만. "
            + "즐겨찾기 토글이 videos.favorite 을 바꾼다. 모르는 필터는 422 배열")
    void practiceLibrary_listFiltersAndFavorite() throws Exception {
        UUID old = seedVideo(member, 1_000, clock.instant().minus(Duration.ofDays(9)));
        UUID middle = seedVideo(member, 1_000, clock.instant().minus(Duration.ofDays(3)));
        UUID fresh = seedVideo(member, 1_000, clock.instant().minus(Duration.ofHours(1)));
        seedVideo(member(), 1_000, null);

        assertThat(json(get("/v2/videos"), 200).path("videos")).extracting(video -> video.path("id").textValue())
                .as("최신 저장순, 남의 것은 없다").containsExactly(fresh.toString(), middle.toString(), old.toString());
        assertThat(json(get("/v2/videos?filter=recent7"), 200).path("videos"))
                .extracting(video -> video.path("id").textValue()).containsExactly(fresh.toString(), middle.toString());
        assertThat(json(get("/v2/videos?filter=favorite"), 200).path("videos")).isEmpty();

        JsonNode marked = json(patch("/v2/videos/{id}", old).content("{\"favorite\":true}"), 200);

        assertThat(marked.path("favorite").booleanValue()).isTrue();
        assertThat(jdbc.queryForObject("SELECT favorite FROM videos WHERE id=?", Boolean.class, old)).isTrue();
        assertThat(json(get("/v2/videos?filter=favorite"), 200).path("videos"))
                .extracting(video -> video.path("id").textValue()).containsExactly(old.toString());
        assertThat(json(patch("/v2/videos/{id}", old).content("{\"favorite\":false}"), 200).path("favorite").booleanValue())
                .isFalse();
        assertThat(json(get("/v2/videos?filter=favorite"), 200).path("videos")).isEmpty();

        MockHttpServletResponse unknown = perform(get("/v2/videos?filter=weekly"), bearer);
        assertThat(unknown.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(unknown.getContentAsString()).path("detail").isArray()).isTrue();
        assertThat(perform(patch("/v2/videos/{id}", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"favorite\":true}"), bearer).getStatus()).as("없는 영상").isEqualTo(404);
    }

    @Test
    @DisplayName("practice.library: 두 회차가 참조하는 영상 삭제 — 422 video_in_use 이고 영상·회차가 그대로이며 상세에 회차 2개가 보인다. "
            + "참조 없는 영상 삭제 — 조회에 없고 받아쓰기가 함께 지워지며 객체는 장부가 지운다. 남의 영상·두 번째 삭제 — 404")
    void practiceLibrary_deleteOnlyWhenNothingReferencesTheVideo() throws Exception {
        UUID used = seedVideo(member, 1_000, null);
        UUID free = seedVideo(member, 1_000, null);
        seedPractice(member, used, 1);
        seedPractice(member, used, 2);
        seedTranscript(free);
        seedTranscript(used);
        String usedKey = objectKey(used);
        String freeKey = objectKey(free);

        MockHttpServletResponse refused = perform(delete("/v2/videos/{id}", used), bearer);

        assertThat(refused.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(refused.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"video_in_use\"}"));
        assertThat(count("videos")).isEqualTo(2);
        assertThat(count("practices")).isEqualTo(2);
        assertThat(storage.objects).containsKeys(usedKey, freeKey);
        JsonNode detail = json(get("/v2/videos/{id}", used), 200);
        assertThat(detail.path("usage").path("practice_count").intValue()).as("화면이 보여 줄 사용처").isEqualTo(2);
        assertThat(detail.path("usage").path("entry_count").intValue()).isZero();

        assertThat(perform(delete("/v2/videos/{id}", free), bearer).getStatus()).isEqualTo(204);

        assertThat(jdbc.queryForList("SELECT id FROM videos", UUID.class)).containsExactly(used);
        assertThat(jdbc.queryForList("SELECT video_id FROM video_transcripts", UUID.class))
                .as("받아쓰기도 함께 지운다").containsExactly(used);
        assertThat(storage.objects).as("객체는 장부가 지웠다").containsOnlyKeys(usedKey);
        assertThat(count("account_cleanup_operations")).isZero();
        assertThat(perform(delete("/v2/videos/{id}", free), bearer).getStatus()).as("두 번째 삭제").isEqualTo(404);
        assertThat(perform(delete("/v2/videos/{id}", used), "Bearer " + jwt.issueAccessToken(member()).value())
                .getStatus()).as("남의 영상").isEqualTo(404);
    }

    @Test
    @DisplayName("practice.library: 두 회차가 참조하는 영상을 \"파일만 파기\" — 회차는 그대로이고 객체·받아쓰기가 없으며 재생 주소가 없고 총량에서 빠진다. "
            + "파기된 영상은 참조가 없으면 지울 수 있다")
    void practiceLibrary_purgeFileKeepsTheRecordsAndFreesTheQuota() throws Exception {
        UUID video = seedVideo(member, VideoRules.MEMBER_QUOTA_BYTES - 500, null);
        seedPractice(member, video, 1);
        seedPractice(member, video, 2);
        seedTranscript(video);
        String key = objectKey(video);
        assertThat(json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 1_000, 9_000)), 422))
                .as("파기 전에는 총량이 가득하다").isEqualTo(mapper.readTree("{\"detail\":\"video_quota\"}"));

        JsonNode purged = json(post("/v2/videos/{id}/purge-file", video), 200);

        assertThat(purged.path("purged_at").isNull()).isFalse();
        assertThat(purged.path("playback_url").isNull()).as("재생할 수 없다").isTrue();
        assertThat(purged.path("usage").path("practice_count").intValue()).as("회차 기록은 남는다").isEqualTo(2);
        assertThat(count("practices")).isEqualTo(2);
        assertThat(count("video_transcripts")).isZero();
        assertThat(storage.objects).doesNotContainKey(key);
        assertThat(count("account_cleanup_operations")).isZero();
        assertThat(json(get("/v2/videos/{id}", video), 200).path("playback_url").isNull()).isTrue();

        JsonNode room = json(post("/v2/videos/intents").content(intentBody(UUID.randomUUID(), "video/mp4", 1_000, 9_000)), 201);
        deviceUploads(room, 1_000);
        assertThat(json(post("/v2/videos/intents/{id}/complete", intentId(room)), 201).path("byte_size").longValue())
                .as("파기한 만큼 공간이 돌아온다").isEqualTo(1_000L);

        // 다시 파기해도 같은 답이고, 참조가 있으면 여전히 지울 수 없다.
        assertThat(json(post("/v2/videos/{id}/purge-file", video), 200).path("purged_at").isNull()).isFalse();
        assertThat(perform(delete("/v2/videos/{id}", video), bearer).getStatus()).isEqualTo(422);
        jdbc.update("DELETE FROM practices WHERE video_id=?", video);
        assertThat(perform(delete("/v2/videos/{id}", video), bearer).getStatus()).isEqualTo(204);
        assertThat(count("account_cleanup_operations")).as("이미 파기된 영상에는 지울 객체가 없다").isZero();
    }

    @Test
    @DisplayName("practice.library: 영상 상세 — 10분 서명 재생 주소와 만료 시각이 있고 다시 조회하면 새 만료 시각이다. 없는 영상·남의 영상은 404 video_not_found")
    void practiceLibrary_playbackUrlIsSignedAndRefreshedOnEachRead() throws Exception {
        UUID video = seedVideo(member, 2_000, null);

        JsonNode detail = json(get("/v2/videos/{id}", video), 200);

        assertThat(detail.path("playback_url").textValue()).isEqualTo("https://storage.test/get/" + objectKey(video));
        assertThat(Instant.parse(detail.path("playback_expires_at").textValue()))
                .isEqualTo(clock.instant().plusSeconds(VideoRules.PLAYBACK_TTL_SECONDS));

        clock.advance(Duration.ofMinutes(11));
        JsonNode again = json(get("/v2/videos/{id}", video), 200);
        assertThat(Instant.parse(again.path("playback_expires_at").textValue()))
                .as("만료 뒤 재조회하면 새 시각").isEqualTo(clock.instant().plusSeconds(VideoRules.PLAYBACK_TTL_SECONDS));

        assertThat(json(get("/v2/videos/{id}", UUID.randomUUID()), 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"video_not_found\"}"));
        MockHttpServletResponse foreign = perform(get("/v2/videos/{id}", video),
                "Bearer " + jwt.issueAccessToken(member()).value());
        assertThat(foreign.getStatus()).as("남의 영상은 없는 것과 같다").isEqualTo(404);
    }

    @Test
    @DisplayName("account.guest·practice.library: 웹 게스트가 영상 둘을 보관하고 앱으로 옮김 — 회원의 보관함에 둘이 보이고 user_id 가 회원이며 객체는 그대로다. "
            + "옛 게스트 토큰의 보관함 요청은 403 guest_transferred")
    void practiceLibrary_videosMoveToTheMemberWithTheCode() throws Exception {
        Guest guest = consentedGuest();
        UUID first = upload(guest.bearer(), 3_000, 11_000);
        clock.advance(Duration.ofSeconds(1));
        UUID second = upload(guest.bearer(), 4_000, 12_000);
        assertThat(json(get("/v2/videos"), 200).path("videos")).as("이관 전 회원의 보관함은 비어 있다").isEmpty();

        transfer(guest);

        JsonNode list = json(get("/v2/videos"), 200);
        assertThat(list.path("videos")).extracting(video -> video.path("id").textValue())
                .containsExactly(second.toString(), first.toString());
        assertThat(jdbc.queryForList("SELECT user_id FROM videos", UUID.class)).containsOnly(member);
        assertThat(jdbc.queryForList("SELECT user_id FROM upload_intents", UUID.class))
                .as("예약 장부도 함께 옮긴다").containsOnly(member);
        assertThat(storage.objects).as("객체는 그대로고 주인만 바뀐다").hasSize(2);
        assertThat(json(get("/v2/videos/{id}", first), 200).path("playback_url").isNull()).isFalse();

        MockHttpServletResponse stale = perform(get("/v2/videos"), guest.bearer());
        assertThat(stale.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(stale.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"guest_transferred\"}"));
    }

    // ---- helpers ----

    private String intentBody(UUID requestId, String contentType, long byteSize, int durationMs) {
        return "{\"request_id\":\"" + requestId + "\",\"content_type\":\"" + contentType
                + "\",\"byte_size\":" + byteSize + ",\"duration_ms\":" + durationMs + "}";
    }

    private UUID intentId(JsonNode intent) {
        return UUID.fromString(intent.path("intent_id").textValue());
    }

    /** 기기가 서명 주소로 PUT 하는 자리 — 가짜 저장소에 직접 넣는다. */
    private void deviceUploads(JsonNode intent, long byteSize) {
        String key = jdbc.queryForObject(
                "SELECT object_key FROM upload_intents WHERE id=?", String.class, intentId(intent));
        storage.objects.put(key, byteSize);
    }

    /** 올릴 자리 받기 · 올리기 · 마무리를 한 번에. */
    private UUID upload(String authorization, long byteSize, int durationMs) throws Exception {
        JsonNode intent = json(post("/v2/videos/intents")
                .content(intentBody(UUID.randomUUID(), "video/mp4", byteSize, durationMs)), authorization, 201);
        deviceUploads(intent, byteSize);
        return UUID.fromString(json(post("/v2/videos/intents/{id}/complete", intentId(intent)), authorization, 201)
                .path("id").textValue());
    }

    /** 이미 보관된 영상 — 올리기를 거치지 않고 행과 객체만 둔다. */
    private UUID seedVideo(UUID owner, long byteSize, Instant createdAt) {
        UUID id = UUID.randomUUID();
        String key = "videos/" + owner + "/" + id + ".mp4";
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms,created_at,updated_at)
                VALUES (?,?,?,'video/mp4',?,9000,COALESCE(?,now()),COALESCE(?,now()))
                """, id, owner, key, byteSize,
                createdAt == null ? null : at(createdAt), createdAt == null ? null : at(createdAt));
        storage.objects.put(key, byteSize);
        return id;
    }

    /** 그 영상을 쓰는 회차 하나. 회차 API 는 PA2 의 것이라 행을 직접 넣는다. */
    private void seedPractice(UUID owner, UUID videoId, int ordinal) {
        UUID id = UUID.randomUUID();
        UUID root = ordinal == 1 ? id : jdbc.queryForObject(
                "SELECT root_id FROM practices WHERE video_id=? ORDER BY ordinal LIMIT 1", UUID.class, videoId);
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,
                                      blockage_kind,sub_branch)
                VALUES (?,?,?,?,?,'closed','legacy','그 외','그 외')
                """, id, owner, videoId, root, ordinal);
    }

    private void seedTranscript(UUID videoId) {
        jdbc.update("INSERT INTO video_transcripts(id,video_id,status) VALUES (?,?,'ready')", UUID.randomUUID(), videoId);
    }

    private String objectKey(UUID videoId) {
        return jdbc.queryForObject("SELECT object_key FROM videos WHERE id=?", String.class, videoId);
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

    private Guest guest() throws Exception {
        var response = mvc.perform(post("/v2/auth/guest").with(request -> {
            request.setRemoteAddr("10.57." + ADDRESSES.incrementAndGet() + ".1");
            return request;
        })).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(response.getContentAsString());
        return new Guest(UUID.fromString(body.path("user").path("id").textValue()),
                "Bearer " + body.path("access_token").textValue());
    }

    /** 연습의 문서 셋에 동의한 게스트. */
    private Guest consentedGuest() throws Exception {
        Guest guest = guest();
        for (String type : List.of("terms", "privacy", "ai_analysis")) {
            consent(guest, type, "terms".equals(type));
        }
        return guest;
    }

    private void consent(Guest guest, String type, boolean ageConfirmed) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("document_id", documents.get(type).toString());
        body.put("action", "granted");
        if (ageConfirmed) {
            body.put("age_confirmed", true);
        }
        var response = perform(post("/v2/consents").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)), guest.bearer());
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
    }

    private void transfer(Guest guest) throws Exception {
        var issued = perform(post("/v2/guest/transfer-code"), guest.bearer());
        assertThat(issued.getStatus()).as(issued.getContentAsString()).isEqualTo(201);
        String code = mapper.readTree(issued.getContentAsString()).path("code").textValue();
        String from = address;
        var response = mvc.perform(post("/v2/guest-transfers")
                        .with(request -> {
                            request.setRemoteAddr(from);
                            return request;
                        })
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + code + "\"}"))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
    }

    private Connection outsideConnection() throws Exception {
        return DriverManager.getConnection(PostgresContainerSupport.jdbcUrlFor(database),
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
    }

    /** 확정이 videos 행을 넣는 문장이 문(advisory lock) 앞에서 멈추게 한다. 사용자 행은 이미 잡힌 뒤다. */
    private void holdVideoInserts() {
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION hold_video_insert() RETURNS trigger AS $$
                BEGIN
                    PERFORM pg_advisory_xact_lock_shared(%d);
                    RETURN NEW;
                END
                $$ LANGUAGE plpgsql
                """.formatted(QUOTA_GATE));
        jdbc.execute("""
                CREATE TRIGGER hold_video_insert
                BEFORE INSERT ON videos
                FOR EACH ROW EXECUTE FUNCTION hold_video_insert()
                """);
    }

    private int lockWaiters() {
        return jdbc.queryForObject("""
                SELECT count(*) FROM pg_stat_activity
                WHERE datname=current_database() AND wait_event_type='Lock'
                """, Integer.class);
    }

    private void awaitUntil(String what, int expected, IntSupplier observed) throws Exception {
        Instant deadline = Instant.now().plusSeconds(20);
        while (Instant.now().isBefore(deadline)) {
            if (observed.getAsInt() >= expected) {
                return;
            }
            Thread.sleep(10);
        }
        throw new AssertionError("timed out: " + what + " (saw " + observed.getAsInt() + " of " + expected + ")");
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
    }

    /** 메모리의 오브젝트 스토리지. 무엇이 남아 있는지만 안다. {@link #failing} 에 든 키는 지워지지 않는다. */
    static final class FakeStorage implements ObjectStorage {
        final Map<String, Long> objects = new ConcurrentHashMap<>();
        final Set<String> failing = ConcurrentHashMap.newKeySet();

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
            Long size = objects.get(objectKey);
            return size == null ? null : new StoredObjectMetadata(size, "video/mp4", "etag-" + objectKey.hashCode());
        }

        @Override
        public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void upload(String objectKey, String mimeType, Path source) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void delete(String objectKey) {
            if (failing.contains(objectKey)) {
                throw new IllegalStateException("storage refused the delete");
            }
            objects.remove(objectKey);
        }
    }
}
