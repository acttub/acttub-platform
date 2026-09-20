package com.acttub.actingapi.feature.reading;

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
import java.util.ArrayList;
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
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
 * reading.script 의 "검증 방법" 가운데 서버가 맡는 항목을 HTTP 와 실제 Postgres 로 본다. 오브젝트 스토리지는
 * 메모리의 가짜다 — "녹음 객체가 없다"는 그 상태로 확인한다. 회차·녹음 행은 아직 API 가 없어(RA2·RA3) 표를
 * 직접 채워 집계(내 배역·상태 칩·녹음 수)와 삭제를 본다.
 *
 * <p>여기서 보지 못하는 것: 기기 파서(콜론·블록·공백 형식, 등장인물 목록, 장면 줄 판정, hwp·pdf), 확인 화면,
 * 옛 앱 대본 옮기기, 탈퇴 뒤 대본 파기(RA5), 정리 장부의 7일 뒤 키 유지(RA5).
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    // 이관 처리 중의 등록은 요청 둘이 저마다 커넥션을 쥔 채 잠금을 기다린다.
    "spring.datasource.hikari.maximum-pool-size=12"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ReadingScriptIT.StorageFixture.class})
class ReadingScriptIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final long TRANSFER_GATE = 546_001L;
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    private static String database;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_script");
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
        jdbc.execute("DROP TRIGGER IF EXISTS fail_line_delete ON script_lines");
        jdbc.execute("DROP TRIGGER IF EXISTS hold_script_reassign ON scripts");
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
        address = "10.46.0." + ADDRESSES.incrementAndGet();
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("reading.script: 콜론 형식 대본을 저장 — scripts 1행, 배역·줄 수가 보낸 것과 같고 지문 줄의 character_id 는 NULL, 대사 번호는 대사만 센다, voice_preset 은 모두 NULL")
    void readingScript_savesCharactersAndLinesAsTheDeviceSplitThem() throws Exception {
        UUID requestId = UUID.randomUUID();

        JsonNode saved = json(post("/v2/reading/scripts").content(sample(requestId, "갈매기")), 201);

        assertThat(count("scripts")).isEqualTo(1);
        assertThat(count("script_characters")).isEqualTo(2);
        assertThat(count("script_lines")).isEqualTo(6);
        assertThat(jdbc.queryForList("SELECT kind FROM script_lines WHERE character_id IS NULL ORDER BY ordinal", String.class))
                .containsExactly("scene", "direction", "scene");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM script_characters WHERE voice_preset IS NOT NULL", Integer.class))
                .as("새 대본 저장 직후 voice_preset 은 모두 NULL 이다(reading.cast)").isZero();
        assertThat(jdbc.queryForMap("SELECT source,request_id,length(request_fingerprint) AS fp FROM scripts"))
                .containsEntry("source", "paste").containsEntry("request_id", requestId).containsEntry("fp", 64);

        assertThat(saved.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "id", "title", "source", "characters", "lines", "recording_count", "open_session_id", "last_session",
                "created_at", "updated_at");
        assertThat(saved.path("title").textValue()).isEqualTo("갈매기");
        assertThat(saved.path("recording_count").intValue()).isZero();
        assertThat(saved.path("open_session_id").isNull()).isTrue();
        assertThat(saved.path("last_session").isNull()).isTrue();
        assertThat(saved.path("characters")).extracting(character -> character.path("name").textValue())
                .containsExactly("니나", "트레플레프");
        assertThat(saved.path("characters")).extracting(character -> character.path("dialogue_count").intValue())
                .containsExactly(2, 1);
        assertThat(saved.path("characters").get(0).fieldNames()).toIterable()
                .containsExactlyInAnyOrder("id", "name", "order", "voice_preset", "dialogue_count");
        assertThat(saved.path("lines")).extracting(line -> line.path("kind").textValue())
                .containsExactly("scene", "direction", "dialogue", "dialogue", "scene", "dialogue");
        assertThat(saved.path("lines")).extracting(line -> line.path("dialogue_no").isNull() ? null : line.path("dialogue_no").intValue())
                .as("대사 번호는 대사 줄만 1부터 센다").containsExactly(null, null, 1, 2, null, 3);
        String nina = saved.path("characters").get(0).path("id").textValue();
        assertThat(saved.path("lines").get(2).path("character_id").textValue()).isEqualTo(nina);
        assertThat(saved.path("lines").get(0).path("character_id").isNull()).isTrue();
    }

    @Test
    @DisplayName("reading.script: \"제1막\"과 \"S#2\" 줄은 kind 가 scene 이고 배역이 없다 — 대사에 배역 자리가 없거나 지문·장면에 배역이 실리면 422 배열이고 행이 없다")
    void readingScript_sceneLinesHaveNoCharacterAndMalformedLinesAreValidationErrors() throws Exception {
        json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "갈매기")), 201);
        assertThat(jdbc.queryForList("SELECT text FROM script_lines WHERE kind='scene' ORDER BY ordinal", String.class))
                .containsExactly("제1막", "S#2");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM script_lines WHERE kind='scene' AND character_id IS NOT NULL", Integer.class))
                .isZero();

        List<ObjectNode> malformed = List.of(
                script(UUID.randomUUID(), "x", "paste", "본문", List.of("니나"), List.of(line(1, "dialogue", null, "안녕"))),
                script(UUID.randomUUID(), "x", "paste", "본문", List.of("니나"), List.of(line(1, "dialogue", 1, "안녕"))),
                script(UUID.randomUUID(), "x", "paste", "본문", List.of("니나"), List.of(line(1, "scene", 0, "제1막"))),
                script(UUID.randomUUID(), "x", "paste", "본문", List.of("니나"), List.of(line(2, "dialogue", 0, "안녕"))),
                script(UUID.randomUUID(), "x", "paste", "본문", List.of("니나"), List.of(line(1, "monologue", 0, "안녕"))),
                script(UUID.randomUUID(), "   ", "paste", "본문", List.of("니나"), List.of(line(1, "dialogue", 0, "안녕"))),
                script(UUID.randomUUID(), "x", "email", "본문", List.of("니나"), List.of(line(1, "dialogue", 0, "안녕"))));
        for (ObjectNode body : malformed) {
            assertThat(json(post("/v2/reading/scripts").content(body.toString()), 422).path("detail").isArray())
                    .as(body.toString()).isTrue();
        }
        ObjectNode unknownKey = script(UUID.randomUUID(), "x", "paste", "본문", List.of("니나"), List.of(line(1, "dialogue", 0, "안녕")));
        unknownKey.put("line_count", 1);
        assertThat(json(post("/v2/reading/scripts").content(unknownKey.toString()), 422).path("detail").isArray()).isTrue();
        assertThat(count("scripts")).isEqualTo(1);
    }

    @Test
    @DisplayName("reading.script: 예시 대본을 불러와 저장 — 보통 대본 행이 생기고 입력 경로만 sample 이다")
    void readingScript_aSampleScriptIsAnOrdinaryScript() throws Exception {
        ObjectNode body = script(UUID.randomUUID(), "예시", "sample", "니나: 안녕", List.of("니나"),
                List.of(line(1, "dialogue", 0, "안녕")));

        JsonNode saved = json(post("/v2/reading/scripts").content(body.toString()), 201);

        assertThat(saved.path("source").textValue()).isEqualTo("sample");
        assertThat(jdbc.queryForObject("SELECT source FROM scripts", String.class)).isEqualTo("sample");
        assertThat(json(get("/v2/reading/scripts"), 200).path("scripts")).hasSize(1);
    }

    @Test
    @DisplayName("reading.script: 원문 100,000자 저장 — 201. 100,001자 — 422 script_too_long 이고 행이 없다. 원문은 짧지만 줄 본문 총량 100,001자 — 422")
    void readingScript_textLimitsCountRawTextAndLineTextsAlike() throws Exception {
        String allowed = "가".repeat(99_998) + "\n\n";
        ObjectNode fits = script(UUID.randomUUID(), "긴 대본", "typed", allowed, List.of("니나"),
                List.of(line(1, "dialogue", 0, "안녕")));
        assertThat(json(post("/v2/reading/scripts").content(fits.toString()), 201).path("id").textValue()).isNotBlank();

        ObjectNode tooLong = script(UUID.randomUUID(), "긴 대본", "typed", allowed + "가", List.of("니나"),
                List.of(line(1, "dialogue", 0, "안녕")));
        assertThat(json(post("/v2/reading/scripts").content(tooLong.toString()), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"script_too_long\"}"));

        List<Map<String, Object>> lines = new ArrayList<>();
        for (int ordinal = 1; ordinal <= 3; ordinal++) {
            lines.add(line(ordinal, "dialogue", 0, "가".repeat(ordinal == 3 ? 33_335 : 33_333)));
        }
        ObjectNode longLines = script(UUID.randomUUID(), "짧은 원문", "typed", "짧다", List.of("니나"), lines);
        assertThat(json(post("/v2/reading/scripts").content(longLines.toString()), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"script_too_long\"}"));
        assertThat(count("scripts")).isEqualTo(1);
    }

    @Test
    @DisplayName("reading.script: 줄 3,001개 — 422 script_too_long. 배역 51개 — 422 script_too_long. 3,000줄·50배역은 저장된다")
    void readingScript_lineAndCharacterCountLimits() throws Exception {
        List<String> fifty = new ArrayList<>();
        for (int index = 0; index < 50; index++) {
            fifty.add("배역" + index);
        }
        List<Map<String, Object>> threeThousand = new ArrayList<>();
        for (int ordinal = 1; ordinal <= 3_000; ordinal++) {
            threeThousand.add(line(ordinal, "dialogue", ordinal % 50, "대사 " + ordinal));
        }
        JsonNode saved = json(post("/v2/reading/scripts")
                .content(script(UUID.randomUUID(), "큰 대본", "file", "원문", fifty, threeThousand).toString()), 201);
        assertThat(saved.path("lines")).hasSize(3_000);
        assertThat(saved.path("characters")).hasSize(50);

        List<Map<String, Object>> tooMany = new ArrayList<>(threeThousand);
        tooMany.add(line(3_001, "direction", null, "(끝)"));
        assertThat(json(post("/v2/reading/scripts")
                .content(script(UUID.randomUUID(), "큰 대본", "file", "원문", fifty, tooMany).toString()), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"script_too_long\"}"));

        List<String> fiftyOne = new ArrayList<>(fifty);
        fiftyOne.add("배역50");
        assertThat(json(post("/v2/reading/scripts")
                .content(script(UUID.randomUUID(), "큰 대본", "file", "원문", fiftyOne,
                        List.of(line(1, "dialogue", 50, "안녕"))).toString()), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"script_too_long\"}"));
        assertThat(count("scripts")).isEqualTo(1);
    }

    @Test
    @DisplayName("reading.script: 회원의 101번째 대본 — 422 script_limit. 게스트의 21번째 — 422 script_limit. 100번째 대본의 재전송 — 200 같은 대본")
    void readingScript_scriptCountLimits() throws Exception {
        seedScripts(member, 99);
        UUID hundredth = UUID.randomUUID();
        JsonNode created = json(post("/v2/reading/scripts").content(sample(hundredth, "100번째")), 201);
        assertThat(json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "101번째")), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"script_limit\"}"));
        JsonNode replayed = json(post("/v2/reading/scripts").content(sample(hundredth, "100번째")), 200);
        assertThat(replayed.path("id").textValue()).as("재전송은 개수 검사보다 먼저다").isEqualTo(created.path("id").textValue());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM scripts WHERE user_id=?", Integer.class, member)).isEqualTo(100);

        Guest guest = consentedGuest();
        seedScripts(guest.id(), 20);
        var blocked = perform(post("/v2/reading/scripts").contentType(MediaType.APPLICATION_JSON)
                .content(sample(UUID.randomUUID(), "21번째")), guest.bearer());
        assertThat(blocked.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(blocked.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"script_limit\"}"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM scripts WHERE user_id=?", Integer.class, guest.id())).isEqualTo(20);
    }

    @Test
    @DisplayName("reading.script: 저장 뒤 줄 본문·종류·순서·배역 연결을 바꾸는 요청 — 거절되고 기존 데이터 그대로다")
    void readingScript_linesAreImmutableAfterSaving() throws Exception {
        JsonNode saved = json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "갈매기")), 201);
        String scriptId = saved.path("id").textValue();
        List<Map<String, Object>> before = jdbc.queryForList("SELECT id,ordinal,kind,character_id,text FROM script_lines ORDER BY ordinal");

        ObjectNode body = mapper.createObjectNode();
        body.put("title", "새 제목");
        ArrayNode lines = body.putArray("lines");
        lines.addObject().put("id", saved.path("lines").get(2).path("id").textValue()).put("text", "바뀐 대사");

        JsonNode rejected = json(patch("/v2/reading/scripts/{id}", scriptId).content(body.toString()), 422);

        assertThat(rejected.path("detail").isArray()).isTrue();
        assertThat(jdbc.queryForList("SELECT id,ordinal,kind,character_id,text FROM script_lines ORDER BY ordinal")).isEqualTo(before);
        assertThat(jdbc.queryForObject("SELECT title FROM scripts", String.class)).isEqualTo("갈매기");
    }

    @Test
    @DisplayName("reading.script: 대본 95개인 회원이 대본 10개인 게스트를 이관 — 105개가 모두 보이고 새 등록은 422 script_limit 이며 6개를 지우면 다시 된다")
    void readingScript_transferKeepsEveryScriptAndOnlyBlocksNewRegistrations() throws Exception {
        seedScripts(member, 95);
        Guest guest = consentedGuest();
        seedScripts(guest.id(), 10);

        transfer(guest);

        JsonNode list = json(get("/v2/reading/scripts"), 200);
        assertThat(list.path("total_count").intValue()).isEqualTo(105);
        assertThat(list.path("scripts")).hasSize(105);
        assertThat(json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "106번째")), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"script_limit\"}"));

        for (int index = 0; index < 5; index++) {
            assertThat(perform(delete("/v2/reading/scripts/{id}", list.path("scripts").get(index).path("id").textValue()), bearer)
                    .getStatus()).isEqualTo(204);
        }
        assertThat(json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "아직 100개")), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"script_limit\"}"));
        assertThat(perform(delete("/v2/reading/scripts/{id}", list.path("scripts").get(5).path("id").textValue()), bearer)
                .getStatus()).isEqualTo(204);
        assertThat(json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "100번째")), 201).path("title").textValue())
                .isEqualTo("100번째");
    }

    @Test
    @DisplayName("reading.script: 제목과 배역 이름 수정 — scripts.title 과 script_characters.name 만 바뀌고 줄의 행·id, voice_preset, request_fingerprint 는 그대로다. 수정 뒤 원래 요청을 재전송 — 200 같은 대본")
    void readingScript_editingTitleAndNamesKeepsLinesVoicesAndTheFingerprint() throws Exception {
        UUID requestId = UUID.randomUUID();
        JsonNode saved = json(post("/v2/reading/scripts").content(sample(requestId, "갈매기")), 201);
        String scriptId = saved.path("id").textValue();
        String nina = saved.path("characters").get(0).path("id").textValue();
        String treplev = saved.path("characters").get(1).path("id").textValue();
        List<Map<String, Object>> linesBefore = jdbc.queryForList("SELECT id,ordinal,kind,character_id,text FROM script_lines ORDER BY ordinal");
        String fingerprintBefore = jdbc.queryForObject("SELECT request_fingerprint FROM scripts", String.class);
        jdbc.update("UPDATE script_characters SET voice_preset='M3' WHERE id=?", UUID.fromString(treplev));

        ObjectNode body = mapper.createObjectNode();
        body.put("title", "  갈매기 (개정)  ");
        ArrayNode characters = body.putArray("characters");
        characters.addObject().put("id", nina).put("name", "  니나 자레치나야 ");
        JsonNode patched = json(patch("/v2/reading/scripts/{id}", scriptId).content(body.toString()), 200);

        assertThat(patched.path("title").textValue()).isEqualTo("갈매기 (개정)");
        assertThat(patched.path("characters")).extracting(character -> character.path("name").textValue())
                .containsExactly("니나 자레치나야", "트레플레프");
        assertThat(patched.path("characters").get(1).path("voice_preset").textValue()).as("건드리지 않은 목소리는 그대로다").isEqualTo("M3");
        assertThat(jdbc.queryForList("SELECT id,ordinal,kind,character_id,text FROM script_lines ORDER BY ordinal")).isEqualTo(linesBefore);
        assertThat(jdbc.queryForObject("SELECT request_fingerprint FROM scripts", String.class)).isEqualTo(fingerprintBefore);
        assertThat(jdbc.queryForObject("SELECT updated_at > created_at FROM scripts", Boolean.class)).as("고친 시각이 는다").isTrue();

        JsonNode replayed = json(post("/v2/reading/scripts").content(sample(requestId, "갈매기")), 200);
        assertThat(replayed.path("id").textValue()).isEqualTo(scriptId);
        assertThat(replayed.path("title").textValue()).as("먼저 만든(고친) 대본을 돌려준다").isEqualTo("갈매기 (개정)");
        assertThat(count("scripts")).isEqualTo(1);

        // 목소리는 키가 있을 때만 바꾼다 — null 은 자동, 키를 빼면 그대로.
        ObjectNode voice = mapper.createObjectNode();
        ArrayNode voices = voice.putArray("characters");
        voices.addObject().put("id", treplev).putNull("voice_preset");
        voices.addObject().put("id", nina).put("voice_preset", "F2");
        JsonNode voiced = json(patch("/v2/reading/scripts/{id}", scriptId).content(voice.toString()), 200);
        assertThat(voiced.path("characters").get(0).path("voice_preset").textValue()).isEqualTo("F2");
        assertThat(voiced.path("characters").get(1).path("voice_preset").isNull()).isTrue();
        ObjectNode longPreset = mapper.createObjectNode();
        longPreset.putArray("characters").addObject().put("id", nina).put("voice_preset", "x".repeat(33));
        assertThat(json(patch("/v2/reading/scripts/{id}", scriptId).content(longPreset.toString()), 422))
                .as("33자 프리셋은 422 invalid_characters (reading.cast)")
                .isEqualTo(mapper.readTree("{\"detail\":\"invalid_characters\"}"));
        assertThat(json(patch("/v2/reading/scripts/{id}", scriptId).content("{}"), 200).path("title").textValue())
                .as("빈 수정은 아무것도 바꾸지 않는다").isEqualTo("갈매기 (개정)");
    }

    @Test
    @DisplayName("reading.script: 이름을 빈 값으로 — 422 invalid_characters. 같은 대본의 다른 배역과 같은 이름으로 — 422 invalid_characters. 저장 때도 같고, 두 이름을 맞바꾸는 것은 된다")
    void readingScript_blankOrDuplicateNamesAreRejected() throws Exception {
        for (List<String> names : List.of(List.of("니나", "   "), List.of("니나", " 니나 "))) {
            ObjectNode body = script(UUID.randomUUID(), "x", "paste", "본문", names, List.of(line(1, "dialogue", 0, "안녕")));
            assertThat(json(post("/v2/reading/scripts").content(body.toString()), 422))
                    .as(names.toString()).isEqualTo(mapper.readTree("{\"detail\":\"invalid_characters\"}"));
        }
        assertThat(count("scripts")).isZero();

        JsonNode saved = json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "갈매기")), 201);
        String scriptId = saved.path("id").textValue();
        String nina = saved.path("characters").get(0).path("id").textValue();
        String treplev = saved.path("characters").get(1).path("id").textValue();

        for (ObjectNode body : List.of(
                patchName(nina, "   "),
                patchName(nina, "트레플레프"),
                patchName(UUID.randomUUID().toString(), "누군가"),
                patchNames(nina, "같은 이름", nina, "같은 이름"))) {
            assertThat(json(patch("/v2/reading/scripts/{id}", scriptId).content(body.toString()), 422))
                    .as(body.toString()).isEqualTo(mapper.readTree("{\"detail\":\"invalid_characters\"}"));
        }
        assertThat(jdbc.queryForList("SELECT name FROM script_characters ORDER BY sort_order", String.class))
                .containsExactly("니나", "트레플레프");

        JsonNode swapped = json(patch("/v2/reading/scripts/{id}", scriptId)
                .content(patchNames(nina, "트레플레프", treplev, "니나").toString()), 200);
        assertThat(swapped.path("characters")).extracting(character -> character.path("name").textValue())
                .containsExactly("트레플레프", "니나");
    }

    @Test
    @DisplayName("reading.script: 목록 조회 — 최근 고친 순이고 머리에 \"전체 N개 · 연습 중 M개\"가 맞다. \"니나\"로 검색 — 배역 이름이 니나인 대본만 나오고 대사에만 있는 대본은 나오지 않는다. 열린 회차 — 연습 중, 회차 없음 — 배역 선택")
    void readingScript_listIsOrderedByLastEditAndSearchesTitlesAndNamesOnly() throws Exception {
        String seagull = json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "갈매기")), 201).path("id").textValue();
        clock.advance(Duration.ofSeconds(1));
        String hamlet = json(post("/v2/reading/scripts").content(script(UUID.randomUUID(), "햄릿", "paste", "본문",
                List.of("햄릿", "오필리아"), List.of(
                        line(1, "dialogue", 0, "니나는 어디 갔지"),
                        line(2, "dialogue", 1, "모르겠어요"),
                        line(3, "dialogue", 0, "그럼 됐다"))).toString()), 201).path("id").textValue();
        String cherry = json(post("/v2/reading/scripts").content(script(UUID.randomUUID(), "벚꽃 동산", "paste", "본문",
                List.of("라넵스카야"), List.of(line(1, "dialogue", 0, "동산이여"))).toString()), 201).path("id").textValue();

        JsonNode list = json(get("/v2/reading/scripts"), 200);
        assertThat(list.fieldNames()).toIterable().containsExactlyInAnyOrder("scripts", "total_count", "in_progress_count");
        assertThat(ids(list.path("scripts"))).containsExactly(cherry, hamlet, seagull);
        assertThat(list.path("total_count").intValue()).isEqualTo(3);
        assertThat(list.path("in_progress_count").intValue()).isZero();
        JsonNode card = list.path("scripts").get(2);
        assertThat(card.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "id", "title", "my_character_names", "dialogue_count", "recording_count", "last_practiced_at",
                "last_activity_at", "status", "created_at", "updated_at");
        assertThat(card.path("dialogue_count").intValue()).isEqualTo(3);
        assertThat(card.path("my_character_names")).as("회차가 없으면 배역 미선택").isEmpty();
        assertThat(card.path("status").textValue()).isEqualTo("no_cast");
        assertThat(card.path("last_practiced_at").isNull()).isTrue();
        assertThat(card.path("last_activity_at").textValue()).isEqualTo(card.path("created_at").textValue());

        // 제목·배역 이름을 고치면 맨 위로 온다.
        json(patch("/v2/reading/scripts/{id}", seagull).content("{\"title\":\"갈매기 2판\"}"), 200);
        assertThat(ids(json(get("/v2/reading/scripts"), 200).path("scripts"))).containsExactly(seagull, cherry, hamlet);

        JsonNode search = json(get("/v2/reading/scripts").param("q", "니나"), 200);
        assertThat(ids(search.path("scripts"))).as("대사 본문의 '니나'는 찾지 않는다").containsExactly(seagull);
        assertThat(search.path("total_count").intValue()).as("머리의 수는 검색과 무관하다").isEqualTo(3);
        assertThat(ids(json(get("/v2/reading/scripts").param("q", "벚꽃"), 200).path("scripts"))).containsExactly(cherry);
        assertThat(ids(json(get("/v2/reading/scripts").param("q", "%"), 200).path("scripts"))).as("와일드카드가 아니다").isEmpty();

        // 회차는 아직 API 가 없다(RA2) — 표를 직접 채워 집계를 본다.
        UUID seagullId = UUID.fromString(seagull);
        UUID nina = jdbc.queryForObject("SELECT id FROM script_characters WHERE script_id=? AND name='니나'", UUID.class, seagullId);
        session(seagullId, member, List.of(nina), "completed", clock.instant().minusSeconds(60));
        session(seagullId, member, List.of(nina), "in_progress", clock.instant());
        UUID hamletId = UUID.fromString(hamlet);
        UUID ophelia = jdbc.queryForObject("SELECT id FROM script_characters WHERE script_id=? AND name='오필리아'", UUID.class, hamletId);
        session(hamletId, member, List.of(ophelia), "completed", clock.instant());
        UUID cherryId = UUID.fromString(cherry);
        UUID ranevskaya = jdbc.queryForObject("SELECT id FROM script_characters WHERE script_id=?", UUID.class, cherryId);
        session(cherryId, member, List.of(ranevskaya), "stopped", clock.instant());

        JsonNode practiced = json(get("/v2/reading/scripts"), 200);
        assertThat(practiced.path("in_progress_count").intValue()).isEqualTo(1);
        Map<String, JsonNode> byId = new LinkedHashMap<>();
        practiced.path("scripts").forEach(row -> byId.put(row.path("id").textValue(), row));
        assertThat(byId.get(seagull).path("status").textValue()).isEqualTo("reading");
        assertThat(byId.get(seagull).path("my_character_names")).extracting(JsonNode::textValue).containsExactly("니나");
        assertThat(byId.get(seagull).path("last_practiced_at").isNull()).isFalse();
        assertThat(byId.get(seagull).path("last_activity_at").textValue()).isEqualTo(byId.get(seagull).path("last_practiced_at").textValue());
        assertThat(byId.get(hamlet).path("status").textValue()).isEqualTo("completed");
        assertThat(byId.get(hamlet).path("my_character_names")).extracting(JsonNode::textValue).containsExactly("오필리아");
        assertThat(byId.get(cherry).path("status").textValue()).as("stopped 만 남으면 배역 선택").isEqualTo("no_cast");

        JsonNode detail = json(get("/v2/reading/scripts/{id}", seagull), 200);
        assertThat(detail.path("open_session_id").isNull()).isFalse();
        assertThat(detail.path("last_session").path("status").textValue()).isEqualTo("in_progress");
        assertThat(detail.path("last_session").path("my_character_ids")).extracting(JsonNode::textValue).containsExactly(nina.toString());
        assertThat(detail.path("last_session").path("my_character_names")).extracting(JsonNode::textValue).containsExactly("니나");
    }

    @Test
    @DisplayName("reading.script: 대본 삭제 — scripts·script_characters·script_lines·reading_sessions·reading_recordings·line_memorization 행과 녹음 객체가 모두 없다. 다른 사람이 지우면 404 이고 행이 남는다")
    void readingScript_deletingRemovesEveryRowAndTheRecordingObjects() throws Exception {
        JsonNode saved = json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "갈매기")), 201);
        UUID scriptId = UUID.fromString(saved.path("id").textValue());
        UUID nina = UUID.fromString(saved.path("characters").get(0).path("id").textValue());
        UUID line = UUID.fromString(saved.path("lines").get(2).path("id").textValue());
        UUID session = session(scriptId, member, List.of(nina), "completed", clock.instant());
        recording(member, session, line, "reading/" + member + "/" + session + "/" + line + "/a.m4a");
        jdbc.update("INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (?,?,?,'memorized')",
                UUID.randomUUID(), member, line);
        assertThat(json(get("/v2/reading/scripts/{id}", scriptId), 200).path("recording_count").intValue()).isEqualTo(1);
        // 남의 대본은 같은 대본의 다른 배역·줄까지 남아 있어야 한다.
        UUID other = member();
        json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "남의 대본")), 201);

        var foreign = perform(delete("/v2/reading/scripts/{id}", scriptId), "Bearer " + jwt.issueAccessToken(other).value());
        assertThat(foreign.getStatus()).isEqualTo(404);
        assertThat(mapper.readTree(foreign.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"script_not_found\"}"));
        assertThat(count("scripts")).isEqualTo(2);
        assertThat(count("reading_recordings")).isEqualTo(1);

        assertThat(perform(delete("/v2/reading/scripts/{id}", scriptId), bearer).getStatus()).isEqualTo(204);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM script_characters WHERE script_id=?", Integer.class, scriptId)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM script_lines WHERE script_id=?", Integer.class, scriptId)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_sessions WHERE script_id=?", Integer.class, scriptId)).isZero();
        assertThat(count("reading_recordings")).isZero();
        assertThat(count("line_memorization")).isZero();
        assertThat(count("scripts")).as("남의 대본은 그대로다").isEqualTo(1);
        assertThat(count("script_characters")).as("남의 배역은 그대로다").isEqualTo(2);
        assertThat(storage.objects).as("녹음 객체도 지운다").isEmpty();
        assertThat(count("account_cleanup_operations")).as("끝난 정리는 장부에 남지 않는다").isZero();
        assertThat(perform(delete("/v2/reading/scripts/{id}", scriptId), bearer).getStatus()).as("두 번째는 404").isEqualTo(404);
    }

    @Test
    @DisplayName("reading.script: 다른 사람의 대본 id 로 조회·수정·삭제 — 404. 없는 id 도 같은 404 다")
    void readingScript_othersScriptsAreNotFound() throws Exception {
        String scriptId = json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "갈매기")), 201).path("id").textValue();
        String others = "Bearer " + jwt.issueAccessToken(member()).value();

        for (String id : List.of(scriptId, UUID.randomUUID().toString())) {
            for (MockHttpServletRequestBuilder request : List.of(
                    get("/v2/reading/scripts/{id}", id),
                    patch("/v2/reading/scripts/{id}", id).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"x\"}"),
                    delete("/v2/reading/scripts/{id}", id))) {
                var response = perform(request, others);
                assertThat(response.getStatus()).as(id).isEqualTo(404);
                assertThat(mapper.readTree(response.getContentAsString()))
                        .isEqualTo(mapper.readTree("{\"detail\":\"script_not_found\"}"));
            }
        }
        assertThat(jdbc.queryForObject("SELECT title FROM scripts", String.class)).isEqualTo("갈매기");
    }

    @Test
    @DisplayName("account.guest·reading.script: 새 게스트가 대본 등록 — 403 consent_required 와 이용약관·개인정보 수집·이용 동의 둘만. 동의 뒤에는 리딩의 모든 조회·저장 경로가 200 이다")
    void readingScript_aGuestNeedsOnlyTermsAndPrivacy() throws Exception {
        Guest guest = guest();

        var blocked = perform(post("/v2/reading/scripts").contentType(MediaType.APPLICATION_JSON)
                .content(sample(UUID.randomUUID(), "갈매기")), guest.bearer());

        assertThat(blocked.getStatus()).isEqualTo(403);
        JsonNode body = mapper.readTree(blocked.getContentAsString());
        assertThat(body.path("detail").textValue()).isEqualTo("consent_required");
        assertThat(body.path("pending_consents")).extracting(document -> document.path("type").textValue())
                .as("AI 분석 동의는 요구하지 않는다").containsExactly("terms", "privacy");
        assertThat(count("scripts")).isZero();

        consent(guest, "terms", true);
        consent(guest, "privacy", null);

        var created = perform(post("/v2/reading/scripts").contentType(MediaType.APPLICATION_JSON)
                .content(sample(UUID.randomUUID(), "갈매기")), guest.bearer());
        assertThat(created.getStatus()).as(created.getContentAsString()).isEqualTo(201);
        String scriptId = mapper.readTree(created.getContentAsString()).path("id").textValue();
        assertThat(perform(get("/v2/reading/scripts"), guest.bearer()).getStatus()).isEqualTo(200);
        assertThat(perform(get("/v2/reading/scripts/{id}", scriptId), guest.bearer()).getStatus()).isEqualTo(200);
        assertThat(perform(patch("/v2/reading/scripts/{id}", scriptId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"게스트의 대본\"}"), guest.bearer()).getStatus()).isEqualTo(200);
        assertThat(perform(delete("/v2/reading/scripts/{id}", scriptId), guest.bearer()).getStatus()).isEqualTo(204);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_profiles WHERE user_id=?", Integer.class, guest.id()))
                .as("게스트는 프로필 게이트를 면제한다").isZero();
    }

    @Test
    @DisplayName("account.guest·reading.script: 게스트와 회원이 같은 request_id 의 대본을 갖고 이관 — 두 대본과 하위 기록이 모두 남고 게스트 쪽 request_id 만 비어 있다")
    void readingScript_transferClearsOnlyTheGuestRequestIdOnConflict() throws Exception {
        UUID shared = UUID.randomUUID();
        String members = json(post("/v2/reading/scripts").content(sample(shared, "회원의 대본")), 201).path("id").textValue();
        Guest guest = consentedGuest();
        var created = perform(post("/v2/reading/scripts").contentType(MediaType.APPLICATION_JSON)
                .content(sample(shared, "게스트의 대본")), guest.bearer());
        assertThat(created.getStatus()).isEqualTo(201);
        UUID guests = UUID.fromString(mapper.readTree(created.getContentAsString()).path("id").textValue());
        UUID nina = jdbc.queryForObject("SELECT id FROM script_characters WHERE script_id=? AND name='니나'", UUID.class, guests);
        UUID line = jdbc.queryForObject("SELECT id FROM script_lines WHERE script_id=? AND ordinal=3", UUID.class, guests);
        UUID session = session(guests, guest.id(), List.of(nina), "completed", clock.instant());
        recording(guest.id(), session, line, "reading/" + guest.id() + "/" + session + "/" + line + "/a.m4a");
        jdbc.update("INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (?,?,?,'memorized')",
                UUID.randomUUID(), guest.id(), line);

        transfer(guest);

        assertThat(count("scripts")).as("두 대본이 모두 남는다").isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT user_id FROM scripts WHERE id=?", UUID.class, guests)).isEqualTo(member);
        assertThat(jdbc.queryForObject("SELECT request_id FROM scripts WHERE id=?", UUID.class, guests))
                .as("게스트 쪽 request_id 만 비운다").isNull();
        assertThat(jdbc.queryForObject("SELECT request_id FROM scripts WHERE id=?", UUID.class, UUID.fromString(members)))
                .isEqualTo(shared);
        assertThat(jdbc.queryForObject("SELECT user_id FROM reading_sessions WHERE id=?", UUID.class, session)).isEqualTo(member);
        assertThat(jdbc.queryForObject("SELECT user_id FROM reading_recordings", UUID.class)).isEqualTo(member);
        assertThat(jdbc.queryForObject("SELECT user_id FROM line_memorization", UUID.class)).isEqualTo(member);
        assertThat(storage.objects).hasSize(1);
        JsonNode list = json(get("/v2/reading/scripts"), 200);
        assertThat(list.path("total_count").intValue()).isEqualTo(2);
        assertThat(json(get("/v2/reading/scripts/{id}", guests), 200).path("recording_count").intValue()).isEqualTo(1);
        // 옮겨진 게스트의 토큰으로 리딩 요청 — guest_transferred.
        var stale = perform(get("/v2/reading/scripts"), guest.bearer());
        assertThat(stale.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(stale.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"guest_transferred\"}"));
    }

    @Test
    @DisplayName("reading.script: 삭제 트랜잭션 실패 — 행 그대로. 커밋 뒤 객체 삭제 실패 — 화면에는 없고 장부에 키가 남으며 다시 시도해 지운다")
    void readingScript_deleteFailureKeepsRowsAndStorageFailureKeepsTheLedgerKey() throws Exception {
        JsonNode saved = json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "갈매기")), 201);
        UUID scriptId = UUID.fromString(saved.path("id").textValue());
        UUID nina = UUID.fromString(saved.path("characters").get(0).path("id").textValue());
        UUID line = UUID.fromString(saved.path("lines").get(2).path("id").textValue());
        UUID session = session(scriptId, member, List.of(nina), "completed", clock.instant());
        String objectKey = "reading/" + member + "/" + session + "/" + line + "/a.m4a";
        recording(member, session, line, objectKey);
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION fail_line_delete() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'forced delete failure';
                END
                $$ LANGUAGE plpgsql
                """);
        jdbc.execute("""
                CREATE TRIGGER fail_line_delete
                BEFORE DELETE ON script_lines
                FOR EACH ROW EXECUTE FUNCTION fail_line_delete()
                """);

        var failed = perform(delete("/v2/reading/scripts/{id}", scriptId), bearer);

        assertThat(failed.getStatus()).isEqualTo(500);
        assertThat(count("scripts")).isEqualTo(1);
        assertThat(count("script_lines")).isEqualTo(6);
        assertThat(count("reading_sessions")).isEqualTo(1);
        assertThat(count("reading_recordings")).as("녹음 행도 그대로다").isEqualTo(1);
        assertThat(count("account_cleanup_operations")).as("장부에도 남지 않는다").isZero();
        assertThat(storage.objects).containsKey(objectKey);
        jdbc.execute("DROP TRIGGER fail_line_delete ON script_lines");

        storage.failing.add(objectKey);
        assertThat(perform(delete("/v2/reading/scripts/{id}", scriptId), bearer).getStatus()).isEqualTo(204);

        assertThat(perform(get("/v2/reading/scripts/{id}", scriptId), bearer).getStatus()).as("화면에는 없다").isEqualTo(404);
        assertThat(count("reading_recordings")).isZero();
        assertThat(storage.objects).as("저장소가 거절해 객체는 아직 있다").containsKey(objectKey);
        assertThat(jdbc.queryForObject("SELECT kind FROM account_cleanup_operations", String.class))
                .isEqualTo("reading_recording_delete");
        assertThat(jdbc.queryForObject("SELECT payload_encrypted FROM account_cleanup_operations", String.class))
                .as("키는 암호문으로만 남는다").matches("[dk]1:.+").doesNotContain(objectKey);

        storage.failing.clear();
        clock.advance(Duration.ofMinutes(6));
        cleanup.runDue();

        assertThat(storage.objects).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("reading.script: 이관 처리 중에 옛 게스트 토큰으로 등록 요청 — 게스트 계정에 새 대본이 생기지 않는다(이관이 잡은 행 뒤에 줄을 서고 닫힌 계정을 본다)")
    void readingScript_aRegistrationDuringTheTransferDoesNotLandOnTheGuest() throws Exception {
        Guest guest = consentedGuest();
        var first = perform(post("/v2/reading/scripts").contentType(MediaType.APPLICATION_JSON)
                .content(sample(UUID.randomUUID(), "옮겨질 대본")), guest.bearer());
        assertThat(first.getStatus()).isEqualTo(201);
        String code = issueCode(guest);
        holdScriptReassignments();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (Connection gate = outsideConnection()) {
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_lock(" + TRANSFER_GATE + ")");
            }
            // 이관: 게스트의 users 행을 잡은 뒤 대본을 옮기려다 문 앞에서 멈춘다.
            Future<Integer> transferring = pool.submit(() -> transferStatus(code));
            awaitUntil("이관이 문 앞에 서기", 1, this::lockWaiters);
            // 그 사이 옛 게스트 토큰의 등록: 게이트는 지나지만(아직 활성) 저장 직전 users 행에서 줄을 선다.
            Future<MockHttpServletResponse> registering = pool.submit(() -> perform(
                    post("/v2/reading/scripts").contentType(MediaType.APPLICATION_JSON)
                            .content(sample(UUID.randomUUID(), "늦은 대본")), guest.bearer()));
            awaitUntil("등록이 users 행에서 줄을 서기", 2, this::lockWaiters);
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_unlock(" + TRANSFER_GATE + ")");
            }

            assertThat(transferring.get()).isEqualTo(200);
            MockHttpServletResponse late = registering.get();
            assertThat(late.getStatus()).as(late.getContentAsString()).isEqualTo(403);
            assertThat(mapper.readTree(late.getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"account_deactivated\"}"));
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM scripts WHERE user_id=?", Integer.class, guest.id()))
                .as("게스트 계정에 새 대본이 생기지 않는다").isZero();
        assertThat(jdbc.queryForList("SELECT title FROM scripts WHERE user_id=?", String.class, member))
                .containsExactly("옮겨질 대본");
    }

    @Test
    @DisplayName("reading.script: 요청 id 는 본문과 X-Request-Id 헤더에 같은 값으로 온다 — 같으면 처리하고 다르거나 모양이 틀리면 422 배열, 헤더가 없어도 된다")
    void readingScript_theRequestIdHeaderMustMatchTheBody() throws Exception {
        UUID requestId = UUID.randomUUID();

        JsonNode saved = json(post("/v2/reading/scripts").header("X-Request-Id", requestId.toString())
                .content(sample(requestId, "갈매기")), 201);
        JsonNode replayed = json(post("/v2/reading/scripts").header("X-Request-Id", requestId.toString())
                .content(sample(requestId, "갈매기")), 200);
        assertThat(replayed.path("id").textValue()).isEqualTo(saved.path("id").textValue());

        for (String header : List.of(UUID.randomUUID().toString(), "not-a-uuid")) {
            JsonNode rejected = json(post("/v2/reading/scripts").header("X-Request-Id", header)
                    .content(sample(UUID.randomUUID(), "다른 대본")), 422);
            assertThat(rejected.path("detail").isArray()).as(header).isTrue();
            assertThat(rejected.path("detail").get(0).path("loc")).extracting(JsonNode::asText)
                    .containsExactly("header", "X-Request-Id");
        }
        assertThat(count("scripts")).isEqualTo(1);
        assertThat(json(post("/v2/reading/scripts").content(sample(UUID.randomUUID(), "헤더 없이")), 201)
                .path("title").textValue()).isEqualTo("헤더 없이");
    }

    @Test
    @DisplayName("reading.script: 배역 0개로 저장 API — 422 no_characters")
    void readingScript_noCharactersIsRejected() throws Exception {
        ObjectNode body = script(UUID.randomUUID(), "독백", "typed", "본문", List.of(),
                List.of(line(1, "direction", null, "(혼자 서 있다)")));

        assertThat(json(post("/v2/reading/scripts").content(body.toString()), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"no_characters\"}"));
        assertThat(count("scripts")).isZero();
    }

    @Test
    @DisplayName("reading.script: 같은 요청 id·같은 본문으로 두 번 저장 — 행 하나이고 두 응답의 대본 id 가 같다. 같은 id·다른 본문 — 422 request_fingerprint_mismatch. 대본을 지운 뒤 같은 id — 새 대본")
    void readingScript_sameRequestIdReplaysTheSameScriptOrRejectsAnotherBody() throws Exception {
        UUID requestId = UUID.randomUUID();

        JsonNode first = json(post("/v2/reading/scripts").content(sample(requestId, "갈매기")), 201);
        JsonNode second = json(post("/v2/reading/scripts").content(sample(requestId, "갈매기")), 200);

        assertThat(second.path("id").textValue()).isEqualTo(first.path("id").textValue());
        assertThat(second).isEqualTo(first);
        assertThat(count("scripts")).isEqualTo(1);

        assertThat(json(post("/v2/reading/scripts").content(sample(requestId, "다른 제목")), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"request_fingerprint_mismatch\"}"));
        assertThat(count("scripts")).isEqualTo(1);

        assertThat(perform(delete("/v2/reading/scripts/{id}", first.path("id").textValue()), bearer).getStatus()).isEqualTo(204);
        JsonNode again = json(post("/v2/reading/scripts").content(sample(requestId, "갈매기")), 201);
        assertThat(again.path("id").textValue()).isNotEqualTo(first.path("id").textValue());
        assertThat(count("scripts")).isEqualTo(1);
    }

    // ---- helpers ----

    /** 콜론 형식의 대본 하나 — 장면 둘, 지문 하나, 대사 셋(니나 둘, 트레플레프 하나). */
    private String sample(UUID requestId, String title) {
        return script(requestId, title, "paste", "제1막\n(호숫가)\n니나: 안녕하세요\n트레플레프: 왔군\nS#2\n니나: 네",
                List.of("니나", "트레플레프"), List.of(
                        line(1, "scene", null, "제1막"),
                        line(2, "direction", null, "(호숫가)"),
                        line(3, "dialogue", 0, "안녕하세요"),
                        line(4, "dialogue", 1, "왔군"),
                        line(5, "scene", null, "S#2"),
                        line(6, "dialogue", 0, "네"))).toString();
    }

    private ObjectNode script(
            UUID requestId, String title, String source, String rawText, List<String> characters,
            List<Map<String, Object>> lines) {
        ObjectNode body = mapper.createObjectNode();
        body.put("request_id", requestId.toString());
        body.put("title", title);
        body.put("source", source);
        body.put("raw_text", rawText);
        ArrayNode names = body.putArray("characters");
        characters.forEach(name -> names.addObject().put("name", name));
        body.set("lines", mapper.valueToTree(lines));
        return body;
    }

    private static Map<String, Object> line(int ordinal, String kind, Integer characterIndex, String text) {
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("ordinal", ordinal);
        line.put("kind", kind);
        line.put("character_index", characterIndex);
        line.put("text", text);
        return line;
    }

    private ObjectNode patchName(String characterId, String name) {
        ObjectNode body = mapper.createObjectNode();
        body.putArray("characters").addObject().put("id", characterId).put("name", name);
        return body;
    }

    private ObjectNode patchNames(String firstId, String firstName, String secondId, String secondName) {
        ObjectNode body = mapper.createObjectNode();
        ArrayNode characters = body.putArray("characters");
        characters.addObject().put("id", firstId).put("name", firstName);
        characters.addObject().put("id", secondId).put("name", secondName);
        return body;
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

    /** 웹이 하듯 게스트를 만든다. 동의는 아직 없다. */
    private Guest guest() throws Exception {
        var response = mvc.perform(post("/v2/auth/guest").with(request -> {
            request.setRemoteAddr("10.47." + ADDRESSES.incrementAndGet() + ".1");
            return request;
        })).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(response.getContentAsString());
        return new Guest(
                UUID.fromString(body.path("user").path("id").textValue()),
                "Bearer " + body.path("access_token").textValue());
    }

    /** 리딩의 문서 둘에 동의한 게스트. AI 분석 동의는 없다. */
    private Guest consentedGuest() throws Exception {
        Guest guest = guest();
        consent(guest, "terms", true);
        consent(guest, "privacy", null);
        return guest;
    }

    private void consent(Guest guest, String type, Boolean ageConfirmed) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("document_id", documents.get(type).toString());
        body.put("action", "granted");
        if (ageConfirmed != null) {
            body.put("age_confirmed", ageConfirmed);
        }
        var response = perform(post("/v2/consents").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)), guest.bearer());
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
    }

    private String issueCode(Guest guest) throws Exception {
        var response = perform(post("/v2/guest/transfer-code"), guest.bearer());
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
        return mapper.readTree(response.getContentAsString()).path("code").textValue();
    }

    /** 게스트의 코드를 받아 이 테스트의 회원에게 옮긴다. */
    private void transfer(Guest guest) throws Exception {
        assertThat(transferStatus(issueCode(guest))).isEqualTo(200);
    }

    private int transferStatus(String code) throws Exception {
        String from = address;
        return mvc.perform(post("/v2/guest-transfers")
                        .with(request -> {
                            request.setRemoteAddr(from);
                            return request;
                        })
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + code + "\"}"))
                .andReturn().getResponse().getStatus();
    }

    private void seedScripts(UUID owner, int howMany) {
        for (int index = 0; index < howMany; index++) {
            jdbc.update("""
                    INSERT INTO scripts(id,user_id,title,raw_text,source,request_id,request_fingerprint)
                    VALUES (?,?,?,'원문','paste',?,?)
                    """, UUID.randomUUID(), owner, "대본 " + index, UUID.randomUUID(), "f".repeat(64));
        }
    }

    private UUID session(UUID scriptId, UUID owner, List<UUID> myCharacters, String status, Instant startedAt) {
        UUID id = UUID.randomUUID();
        UUID first = jdbc.queryForObject(
                "SELECT id FROM script_lines WHERE script_id=? AND kind='dialogue' ORDER BY ordinal LIMIT 1", UUID.class, scriptId);
        UUID last = jdbc.queryForObject(
                "SELECT id FROM script_lines WHERE script_id=? AND kind='dialogue' ORDER BY ordinal DESC LIMIT 1", UUID.class, scriptId);
        jdbc.update("""
                INSERT INTO reading_sessions(id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,
                                             advance,record,status,current_line_id,started_at,updated_at,ended_at)
                VALUES (?,?,?,?,CAST(? AS uuid[]),'read',?,?,'silence',true,?,?,?,?,?)
                """,
                id, scriptId, owner, UUID.randomUUID(),
                "{" + String.join(",", myCharacters.stream().map(UUID::toString).toList()) + "}",
                first, last, status,
                "in_progress".equals(status) ? first : null,
                startedAt.atOffset(ZoneOffset.UTC), startedAt.atOffset(ZoneOffset.UTC),
                "completed".equals(status) ? startedAt.atOffset(ZoneOffset.UTC) : null);
        return id;
    }

    private void recording(UUID owner, UUID session, UUID line, String objectKey) {
        jdbc.update("""
                INSERT INTO reading_recordings(id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,
                                               content_type,byte_size,duration_ms,transcript_source)
                VALUES (?,?,?,?,?,1,?,'audio/mp4',1000,1500,'none')
                """, UUID.randomUUID(), owner, session, line, UUID.randomUUID(), objectKey);
        storage.objects.put(objectKey, 1000L);
    }

    private Connection outsideConnection() throws Exception {
        return DriverManager.getConnection(PostgresContainerSupport.jdbcUrlFor(database),
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
    }

    /** 이관이 대본을 옮기는 문장이 문(advisory lock) 앞에서 멈추게 한다 — 실행 순서만 제어하고 결과는 공개 계약에서 본다. */
    private void holdScriptReassignments() {
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION hold_script_reassign() RETURNS trigger AS $$
                BEGIN
                    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
                        PERFORM pg_advisory_xact_lock_shared(%d);
                    END IF;
                    RETURN NEW;
                END
                $$ LANGUAGE plpgsql
                """.formatted(TRANSFER_GATE));
        jdbc.execute("""
                CREATE TRIGGER hold_script_reassign
                BEFORE UPDATE ON scripts
                FOR EACH ROW EXECUTE FUNCTION hold_script_reassign()
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

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String authorization)
            throws Exception {
        return mvc.perform(request.header("Authorization", authorization)).andReturn().getResponse();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        var response = perform(request.contentType(MediaType.APPLICATION_JSON), bearer);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }

    private static List<String> ids(JsonNode rows) {
        List<String> ids = new ArrayList<>();
        rows.forEach(row -> ids.add(row.path("id").textValue()));
        return ids;
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageFixture {
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
            return size == null ? null : new StoredObjectMetadata(size, "audio/mp4", "etag");
        }

        @Override
        public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
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
