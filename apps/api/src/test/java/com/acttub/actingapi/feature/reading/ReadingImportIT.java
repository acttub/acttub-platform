package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.reading.app.LineDecider;
import com.acttub.actingapi.feature.reading.app.ScriptImportRepository;
import com.acttub.actingapi.feature.reading.app.ScriptSplitWorker;
import com.acttub.actingapi.feature.reading.domain.LineReview;
import com.acttub.actingapi.feature.reading.domain.SpeakerMerge;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.feature.reading.domain.SampleScript;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.GenerationOptions;
import com.acttub.actingapi.integration.llm.OpenAiStatusException;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingFailureReporter;
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
 * reading.script 「나누기 작업」을 HTTP·실제 Postgres·{@code ai_jobs} 장부로 본다. 모델만 가짜다 — 지시문과 입력을 기록하고,
 * 콜론·대괄호 형식 대본을 완벽하게 나누는 답과 띄어쓰기 복원 답을 기본으로 내며, 테스트가 답을 비틀거나(빠진 줄·틀린 이름·대본
 * 아님) 실패하게 한다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ANALYSIS_WORKER_ENABLED=false",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "CHALLENGE_SETTLEMENT_ENABLED=false",
    // 한도 경쟁 테스트가 요청 여럿을 동시에 보낸다 — 저마다 커넥션을 쥔 채 users 행 잠금을 기다린다.
    "spring.datasource.hikari.maximum-pool-size=12"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ReadingImportIT.Model.class})
class ReadingImportIT {
    private static final Instant NOW = Instant.parse("2026-10-06T03:00:00Z");
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    private static final Pattern COLON = Pattern.compile("^(\\S+?):\\s*(.*)$");
    private static final Pattern BRACKET = Pattern.compile("^\\[(\\S+?)]\\s*(.*)$");
    /** 글자 인식으로 복사한 대본 — 1·3·4번은 띄어진 줄, 5번은 짧게 띄어진 줄, 2번은 맞게 쓴 줄이다. */
    private static final String SPACED = """
            엄 마 의 시 험
            [엄마] 이번엔 시험 잘 봐야지.
            [ 엄 마 ] 유 세 아 , 공 부 열 심 히 하 고 있 지 ?
            [ 유 세 아 ] 응 . 걱 정 하 지 마 .
            ( 암 전 )
            """;
    private static final AtomicInteger ADDRESSES = new AtomicInteger();

    @TestConfiguration
    static class Model {
        static final List<Call> CALLS = new CopyOnWriteArrayList<>();
        static volatile Function<Call, String> answer = Model::oracle;

        record Call(String instructions, String input) {
            boolean roster() {
                return instructions.contains("배역 이름 목록");
            }

            boolean judging() {
                return instructions.contains("답의 첫 줄은");
            }

            boolean unnamed() {
                return instructions.contains("배역 이름 표기가 없는 대사");
            }

            boolean spacing() {
                return instructions.contains("띄어쓰기를 고친다");
            }

            List<String[]> lines() {
                List<String[]> lines = new ArrayList<>();
                for (String line : input.split("\n")) {
                    lines.add(line.split("\t", 2));
                }
                return lines;
            }
        }

        @Bean @Primary TextGenerator stubTextGenerator() {
            return new TextGenerator() {
                @Override public GeneratedText generate(String instructions, String input) {
                    return generate(instructions, input, null);
                }

                @Override public GeneratedText generate(String instructions, String input, GenerationOptions options) {
                    Call call = new Call(instructions, input);
                    CALLS.add(call);
                    return new GeneratedText(answer.apply(call), new TokenUsage(10, 20, 30), options == null ? "" : options.model());
                }
            };
        }

        @Bean @Primary RecordingFailureReporter recordingFailureReporter() {
            return new RecordingFailureReporter();
        }

        /** 띄어쓰기 복원 호출이 돌려주는 줄. 목록에 없는 줄은 그대로 돌려준다. */
        static final Map<String, String> RESTORED = Map.of(
                "엄 마 의 시 험", "엄마의 시험",
                "[ 엄 마 ] 유 세 아 , 공 부 열 심 히 하 고 있 지 ?", "[엄마] 유세아, 공부 열심히 하고 있지?",
                "[ 유 세 아 ] 응 . 걱 정 하 지 마 .", "[유세아] 응. 걱정하지 마.",
                "( 암 전 )", "(암전)",
                "[엄마] 언제 돌아가실지모르겠지만그래도", "[엄마] 언제 돌아가실지 모르겠지만 그래도");

        /** 콜론·대괄호 형식을 완벽하게 나누는 답. 괄호 줄은 지문, 「제N막」은 장면, 「등장인물」 줄은 소개다. */
        static String oracle(Call call) {
            StringBuilder out = new StringBuilder();
            if (call.spacing()) {
                for (String[] line : call.lines()) {
                    out.append(line[0]).append('\t').append(RESTORED.getOrDefault(line[1], line[1])).append('\n');
                }
                return out.toString();
            }
            if (call.judging()) {
                out.append("대본\t예\n");
            }
            if (call.roster()) {
                Set<String> names = new LinkedHashSet<>();
                for (String[] line : call.lines()) {
                    Matcher matcher = COLON.matcher(line[1]);
                    if (matcher.matches() && !line[1].startsWith("등장인물")) names.add(matcher.group(1));
                }
                names.forEach(name -> out.append(name).append('\n'));
                return out.toString();
            }
            for (String[] line : call.lines()) {
                out.append(line[0]).append('\t').append(row(line[1])).append('\n');
            }
            return out.toString();
        }

        static String row(String text) {
            if (text.startsWith("등장인물")) return "c\t\t";
            Matcher matcher = COLON.matcher(text);
            if (matcher.matches()) return "d\t" + matcher.group(1) + "\t" + matcher.group(1) + ": ";
            Matcher bracket = BRACKET.matcher(text);
            if (bracket.matches()) return "d\t" + bracket.group(1) + "\t[" + bracket.group(1) + "] ";
            if (text.startsWith("제") && text.endsWith("막")) return "s\t\t";
            return "x\t\t";
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_import");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired JwtService jwt;
    @Autowired MutableClock clock;
    @Autowired ScriptSplitWorker worker;
    @Autowired AiJobLedger ledger;
    @Autowired RecordingFailureReporter failures;
    @Autowired ScriptImportRepository imports;
    @Autowired TextGenerator generator;
    @Autowired LlmTelemetry telemetry;

    private final Map<String, UUID> documents = new LinkedHashMap<>();
    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        clock.set(NOW);
        Model.CALLS.clear();
        Model.answer = Model::oracle;
        failures.clear();
        jdbc.execute("TRUNCATE TABLE users,consent_documents,ai_jobs RESTART IDENTITY CASCADE");
        documents.clear();
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention", "cloud_voice", "script_split")) {
            UUID id = UUID.randomUUID();
            documents.put(type, id);
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,locale,title,body,required,published_at)
                    VALUES (?,?,'v1','ko',?,?,?,?)
                    """, id, type, type + " 제목", type + " 본문", List.of("terms", "privacy", "ai_analysis").contains(type), PUBLISHED);
        }
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("reading.script 나누기: 글을 받아 202, 워커가 모델 한 번으로 나눠 저장하면 succeeded 와 script_id — 배역은 대사 많은 순, 대사 글은 머리를 뗀 원문")
    void splitsAColonScriptThroughTheWorker() throws Exception {
        String text = """
                갈매기

                (호숫가의 무대.)

                니나: 저는 갈매기예요.
                트레플레프: 아니, 당신은 배우예요.
                니나: 아니에요.
                제2막
                트레플레프: (한참 보다가) 그래요.
                니나: 가요.
                """;
        JsonNode ticket = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), "갈매기", text, "paste")), 202);
        String importId = ticket.path("import_id").textValue();
        assertThat(ticket.path("duplicate_script_id").isNull()).isTrue();

        JsonNode pending = json(get("/v2/reading/imports/{id}", importId), 200);
        assertThat(pending.path("status").textValue()).isEqualTo("pending");
        assertThat(pending.path("progress").path("total_lines").intValue()).isZero();
        assertThat(Model.CALLS).isEmpty();

        assertThat(worker.runOnce(clock.instant())).isTrue();

        JsonNode done = json(get("/v2/reading/imports/{id}", importId), 200);
        assertThat(done.path("status").textValue()).isEqualTo("succeeded");
        assertThat(done.path("progress").path("done_lines").intValue()).isEqualTo(8);
        assertThat(done.path("progress").path("total_lines").intValue()).isEqualTo(8);
        assertThat(done.path("failure").isNull()).isTrue();
        assertThat(Model.CALLS).hasSize(1);
        assertThat(Model.CALLS.getFirst().judging()).isTrue();
        assertThat(Model.CALLS.getFirst().input()).isEqualTo(
                "1\t갈매기\n3\t(호숫가의 무대.)\n5\t니나: 저는 갈매기예요.\n6\t트레플레프: 아니, 당신은 배우예요.\n7\t니나: 아니에요.\n"
                        + "8\t제2막\n9\t트레플레프: (한참 보다가) 그래요.\n10\t니나: 가요.");

        JsonNode script = json(get("/v2/reading/scripts/{id}", done.path("script_id").textValue()), 200);
        assertThat(script.path("title").textValue()).isEqualTo("갈매기");
        assertThat(script.path("source").textValue()).isEqualTo("paste");
        assertThat(script.path("characters")).extracting(character -> character.path("name").textValue())
                .containsExactly("니나", "트레플레프");
        assertThat(script.path("lines")).extracting(line -> line.path("kind").textValue() + "|" + line.path("text").textValue())
                .containsExactly("direction|갈매기", "direction|(호숫가의 무대.)", "dialogue|저는 갈매기예요.", "dialogue|아니, 당신은 배우예요.",
                        "dialogue|아니에요.", "scene|제2막", "dialogue|(한참 보다가) 그래요.", "dialogue|가요.");
        // A1 의 표시값은 저장 경로가 같아 나누기로 만든 대본에도 채워진다 — 장면 머리 「제2막」으로 장면이 갈리고 목소리는 등장 순 F1·M1.
        assertThat(script.path("scenes")).extracting(scene -> scene.path("dialogue_count").intValue()).containsExactly(3, 2);
        assertThat(script.path("characters")).extracting(character -> character.path("voice").textValue()).containsExactly("F1", "M1");
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs", String.class)).isEqualTo("succeeded");
        assertThat(jdbc.queryForObject("SELECT raw_text FROM scripts", String.class)).isEqualTo(text);
        assertThat(jdbc.queryForObject("SELECT raw_text FROM script_imports", String.class)).as("끝난 요청의 원문은 비운다").isEmpty();
        assertThat(worker.runOnce(clock.instant())).as("남은 작업이 없다").isFalse();
    }

    @Test
    @DisplayName("reading.script 나누기: 같은 request_id 재전송은 200 같은 import_id, 다른 본문이면 422 request_fingerprint_mismatch")
    void replaysTheSameRequestId() throws Exception {
        UUID requestId = UUID.randomUUID();
        String first = json(post("/v2/reading/imports").content(request(requestId, null, "니나: 안녕\n트레플레프: 응", "paste")), 202)
                .path("import_id").textValue();
        assertThat(json(post("/v2/reading/imports").content(request(requestId, null, "니나: 안녕\n트레플레프: 응", "paste")), 200)
                .path("import_id").textValue()).isEqualTo(first);
        assertThat(json(post("/v2/reading/imports").content(request(requestId, null, "니나: 안녕!\n트레플레프: 응", "paste")), 422)
                .path("detail").textValue()).isEqualTo("request_fingerprint_mismatch");
        assertThat(count("script_imports")).isEqualTo(1);
    }

    @Test
    @DisplayName("SOMA-593 7-12: 같은 사람의 같은 글은 모델 없이 200 duplicate_script_id — 공백만 다른 글·NFD·U+200B 도 같은 글, 한 글자 다르면 새 작업, 다른 사람의 같은 글은 중복 아님")
    void duplicatesAreAnsweredWithoutTheModel() throws Exception {
        String text = "니나: 저는 갈매기예요.\n트레플레프: 아니에요.";
        String scriptId = split(text);
        assertThat(Model.CALLS).hasSize(1);

        for (String same : List.of(
                "  니나:\t저는 갈매기예요.\r\n\r\n트레플레프:  아니에요.  ",
                "니나: 저는 갈매기예요.\n트레플레프: 아니에요.",
                "​니나: 저는 갈매기예요.\n​트레플레프: 아니에요.")) {
            JsonNode duplicate = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, same, "paste")), 200);
            assertThat(duplicate.path("duplicate_script_id").textValue()).as(same).isEqualTo(scriptId);
            assertThat(duplicate.path("import_id").isNull()).isTrue();
        }
        assertThat(count("script_imports")).isEqualTo(1);
        assertThat(count("ai_jobs")).isEqualTo(1);

        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, text.replace("아니에요", "맞아요"), "paste")), 202)
                .path("import_id").isTextual()).isTrue();

        UUID other = member();
        var response = perform(post("/v2/reading/imports").contentType(MediaType.APPLICATION_JSON)
                .content(request(UUID.randomUUID(), null, text, "paste")), "Bearer " + jwt.issueAccessToken(other).value());
        assertThat(response.getStatus()).isEqualTo(202);
    }

    @Test
    @DisplayName("SOMA-593 7-12: 같은 글로 진행 중인 요청이 있으면 새 작업을 만들지 않고 그 요청을 200 으로 돌려준다(두 번 누름)")
    void twoTapsShareOneJob() throws Exception {
        String first = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕\n트레플레프: 응", "paste")), 202)
                .path("import_id").textValue();
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕\n트레플레프: 응", "paste")), 200)
                .path("import_id").textValue()).isEqualTo(first);
        assertThat(count("ai_jobs")).isEqualTo(1);
    }

    @Test
    @DisplayName("SOMA-593 7-2 0번: 예시 대본과 같은 글은 모델 없이 바로 저장돼 곧 succeeded 이고 하루 한도에 세지 않는다")
    void sampleScriptSkipsTheModel() throws Exception {
        JsonNode ticket = json(post("/v2/reading/imports")
                .content(request(UUID.randomUUID(), null, SampleScript.TEXT.replace("\n", "\r\n"), "sample")), 202);
        JsonNode status = json(get("/v2/reading/imports/{id}", ticket.path("import_id").textValue()), 200);
        assertThat(status.path("status").textValue()).isEqualTo("succeeded");
        assertThat(status.path("progress").path("done_lines").intValue()).isEqualTo(17);
        assertThat(Model.CALLS).isEmpty();
        assertThat(count("ai_jobs")).isZero();
        JsonNode script = json(get("/v2/reading/scripts/{id}", status.path("script_id").textValue()), 200);
        assertThat(script.path("title").textValue()).isEqualTo("옥상, 밤");
        assertThat(script.path("source").textValue()).isEqualTo("sample");
        assertThat(script.path("characters")).extracting(character -> character.path("dialogue_count").intValue()).containsExactly(8, 7);
        assertThat(script.path("characters")).as("SOMA-670: 모델을 거치지 않은 대본은 성별·나이대가 null")
                .allMatch(character -> character.has("gender") && character.path("gender").isNull()
                        && character.has("age_band") && character.path("age_band").isNull());
        assertThat(script.path("lines")).hasSize(17);
        assertThat(worker.runOnce(clock.instant())).isFalse();
    }

    @Test
    @DisplayName("SOMA-593 7-2 0번: 예시 대본은 모델을 부르지 않으므로 동의가 없어도(회원 미결정·게스트·문서 없음) 접수되어 곧 succeeded 다. 예시가 아닌 글은 그대로 403")
    void sampleScriptNeedsNoConsent() throws Exception {
        UUID undecided = member();
        jdbc.update("DELETE FROM user_consents WHERE user_id=? AND document_id=?", undecided, documents.get("script_split"));
        String undecidedBearer = "Bearer " + jwt.issueAccessToken(undecided).value();
        var accepted = perform(post("/v2/reading/imports").contentType(MediaType.APPLICATION_JSON)
                .content(request(UUID.randomUUID(), null, SampleScript.TEXT, "sample")), undecidedBearer);
        assertThat(accepted.getStatus()).as(accepted.getContentAsString()).isEqualTo(202);
        String importId = mapper.readTree(accepted.getContentAsString()).path("import_id").textValue();
        var status = perform(get("/v2/reading/imports/{id}", importId), undecidedBearer);
        assertThat(mapper.readTree(status.getContentAsString()).path("status").textValue()).isEqualTo("succeeded");

        String guest = consentedGuest();
        var guestAccepted = perform(post("/v2/reading/imports").contentType(MediaType.APPLICATION_JSON)
                .content(request(UUID.randomUUID(), null, SampleScript.TEXT, "sample")), guest);
        assertThat(guestAccepted.getStatus()).as(guestAccepted.getContentAsString()).isEqualTo(202);
        var guestStatus = perform(get("/v2/reading/imports/{id}", mapper.readTree(guestAccepted.getContentAsString()).path("import_id").textValue()), guest);
        assertThat(mapper.readTree(guestStatus.getContentAsString()).path("status").textValue()).isEqualTo("succeeded");

        jdbc.update("DELETE FROM user_consents WHERE document_id=?", documents.get("script_split"));
        jdbc.update("DELETE FROM consent_documents WHERE type='script_split'");
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, SampleScript.TEXT.replace("\n", "\r\n"), "sample")), 202)
                .path("import_id").isTextual()).as("문서가 없어도 예시는 된다").isTrue();
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, SampleScript.TEXT.replace("고마워.", "고마워!"), "sample")), 403)
                .path("detail").textValue()).as("한 글자 고친 예시는 보통 글").isEqualTo("script_split_consent_required");
        assertThat(count("ai_jobs")).isZero();
        assertThat(Model.CALLS).isEmpty();
    }

    @Test
    @DisplayName("동의: 개인정보 수집·이용 동의 v9 이상에 동의한 회원은 script_split 결정이 없어도 나누기를 받는다(SOMA-726) — v8 이하는 아니다")
    void privacyV9CoversTheSplitConsent() throws Exception {
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,locale,title,body,required,published_at)
                VALUES (?,'privacy','v8','ko','privacy v8','본문',true,?)
                """, UUID.randomUUID(), PUBLISHED.plusSeconds(1));
        UUID onV8 = member();
        jdbc.update("DELETE FROM user_consents WHERE user_id=? AND document_id=?", onV8, documents.get("script_split"));
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕", "paste")), 403,
                "Bearer " + jwt.issueAccessToken(onV8).value()).path("detail").textValue()).isEqualTo("script_split_consent_required");

        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,locale,title,body,required,published_at)
                VALUES (?,'privacy','v9','ko','privacy v9','본문',true,?)
                """, UUID.randomUUID(), PUBLISHED.plusSeconds(2));
        UUID onV9 = member();
        jdbc.update("DELETE FROM user_consents WHERE user_id=? AND document_id=?", onV9, documents.get("script_split"));
        json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕", "paste")), 202,
                "Bearer " + jwt.issueAccessToken(onV9).value());
    }

    @Test
    @DisplayName("동의: script_split 현재 판에 동의하지 않은 회원, 게스트(선택 문서를 결정할 수 없다), 문서가 아예 없을 때 모두 403 script_split_consent_required")
    void consentIsRequired() throws Exception {
        UUID undecided = member();
        jdbc.update("DELETE FROM user_consents WHERE user_id=? AND document_id=?", undecided, documents.get("script_split"));
        var response = perform(post("/v2/reading/imports").contentType(MediaType.APPLICATION_JSON)
                .content(request(UUID.randomUUID(), null, "니나: 안녕", "paste")), "Bearer " + jwt.issueAccessToken(undecided).value());
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(response.getContentAsString()).path("detail").textValue()).isEqualTo("script_split_consent_required");

        String guest = consentedGuest();
        var guestResponse = perform(post("/v2/reading/imports").contentType(MediaType.APPLICATION_JSON)
                .content(request(UUID.randomUUID(), null, "니나: 안녕", "paste")), guest);
        assertThat(guestResponse.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(guestResponse.getContentAsString()).path("detail").textValue()).isEqualTo("script_split_consent_required");

        jdbc.update("DELETE FROM user_consents WHERE document_id=?", documents.get("script_split"));
        jdbc.update("DELETE FROM consent_documents WHERE type='script_split'");
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕", "paste")), 403)
                .path("detail").textValue()).isEqualTo("script_split_consent_required");
        assertThat(count("script_imports")).isZero();
        assertThat(Model.CALLS).isEmpty();
    }

    @Test
    @DisplayName("하루 한도: 모델을 부른 작업 20개 뒤 21번째는 429 script_split_daily_limit — 중복·예시는 세지 않고, 한국 자정이 지나면 다시 된다")
    void dailyLimitCountsOnlyModelJobs() throws Exception {
        for (int index = 0; index < 20; index++) {
            json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 대사 " + index + "\n트레플레프: 응", "paste")), 202);
        }
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 대사 21\n트레플레프: 응", "paste")), 429)
                .path("detail").textValue()).isEqualTo("script_split_daily_limit");
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, SampleScript.TEXT, "sample")), 202)
                .path("import_id").isTextual()).as("예시 대본은 한도와 무관").isTrue();
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, SampleScript.TEXT, "paste")), 200)
                .path("duplicate_script_id").isTextual()).as("중복도 한도와 무관").isTrue();
        assertThat(count("ai_jobs")).isEqualTo(20);

        clock.set(Instant.parse("2026-10-06T15:00:00Z"));
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 대사 21\n트레플레프: 응", "paste")), 202)
                .path("import_id").isTextual()).as("한국 시각 10월 7일 0시부터는 새 날").isTrue();
    }

    @Test
    @DisplayName("하루 한도 경쟁: 같은 회원의 요청 25개가 동시에 와도 접수는 20개를 넘지 않는다")
    void dailyLimitHoldsUnderConcurrentRequests() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            List<Future<Integer>> statuses = new ArrayList<>();
            for (int index = 0; index < 25; index++) {
                String body = request(UUID.randomUUID(), null, "니나: 동시 " + index + "\n트레플레프: 응", "paste");
                statuses.add(pool.submit(() -> perform(post("/v2/reading/imports").contentType(MediaType.APPLICATION_JSON)
                        .content(body), bearer).getStatus()));
            }
            int accepted = 0;
            int limited = 0;
            for (Future<Integer> status : statuses) {
                if (status.get() == 202) accepted++;
                if (status.get() == 429) limited++;
            }
            assertThat(accepted).isEqualTo(20);
            assertThat(limited).isEqualTo(5);
            assertThat(count("ai_jobs")).isEqualTo(20);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("SOMA-593 7-2 4~8번: 150줄이 넘으면 앞 400줄로 배역 목록을 먼저 받고 조각을 보낸다. 버린·빠진 줄은 두 번 다시 묻고 그래도 남으면 지문, 이름은 목록으로 바로잡는다, 진행 줄 수는 전체와 같아진다")
    void longScriptsUseRosterChunksAndRerequestMissingLines() throws Exception {
        StringBuilder text = new StringBuilder("등장인물: 뱅코우, 맥베스\n");
        for (int line = 2; line <= 400; line++) {
            text.append(line % 2 == 0 ? "맥베스: 대사 " : "뱅코우: 대사 ").append(line).append('\n');
        }
        Model.answer = call -> {
            String answer = Model.oracle(call);
            if (call.roster()) return answer;
            StringBuilder twisted = new StringBuilder();
            for (String row : answer.split("\n")) {
                // 다시 묻기에서 문맥 줄(~)까지 번호만 떼어 지문으로 답한다 — 빠진 줄이 아니니 버려져야 한다.
                if (row.startsWith("~")) row = row.substring(1, row.indexOf('\t')) + "\tx\t\t";
                if (row.startsWith("7\t")) continue;
                // 첫 판(150줄 조각)에서만 200번째 줄을 빠뜨린다 — 다시 물으면 답한다.
                if (row.startsWith("200\t") && call.lines().size() == 150) continue;
                // 배역 칸만 섞인 글자로 — 머리는 원문 그대로다(머리가 다르면 검사가 버린다).
                twisted.append(row.startsWith("4\t") ? row.replaceFirst("\td\t맥베스\t", "\td\t맥베س\t") : row).append('\n');
            }
            return twisted.toString();
        };

        String importId = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), "맥베스", text.toString(), "file")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();

        List<Model.Call> calls = Model.CALLS;
        assertThat(calls).hasSize(6);
        assertThat(calls.get(0).roster()).isTrue();
        assertThat(calls.get(0).judging()).isTrue();
        assertThat(calls.get(0).input()).startsWith("1\t등장인물: 뱅코우, 맥베스\n2\t맥베스: 대사 2\n").endsWith("400\t맥베스: 대사 400");
        assertThat(calls.get(0).input().split("\n")).hasSize(400);
        // 조각 셋은 동시에 나가므로 순서가 아니라 모양을 본다.
        for (int chunk = 1; chunk <= 3; chunk++) {
            assertThat(calls.get(chunk).judging()).isFalse();
            assertThat(calls.get(chunk).instructions()).contains("알려진 배역(이 표기를 그대로 쓴다. 목록에 없는 새 배역이 나오면 대본 표기대로 쓴다): 맥베스, 뱅코우");
        }
        assertThat(calls.subList(1, 4)).extracting(call -> call.input().split("\n").length).containsExactlyInAnyOrder(150, 150, 100);
        assertThat(calls.subList(1, 4)).extracting(call -> call.input().split("\n")[0]).containsExactlyInAnyOrder(
                "1\t등장인물: 뱅코우, 맥베스", "151\t뱅코우: 대사 151", "301\t뱅코우: 대사 301");
        // 다시 묻기는 빠진 줄 앞뒤 4줄을 ~ 문맥으로 함께 보낸다. 깨진 글자 화자(맥베س)의 4번째 줄도 함께 다시 묻는다(SOMA-709).
        assertThat(calls.get(4).instructions()).contains("\"~\"가 없는 줄만");
        assertThat(calls.get(4).input()).isEqualTo(context(1, 11, 4, 7) + "\n" + context(196, 204, 200));
        assertThat(calls.get(5).input()).as("다시 받은 답은 의심 이름이어도 받는다").isEqualTo(context(3, 11, 7));

        JsonNode done = json(get("/v2/reading/imports/{id}", importId), 200);
        assertThat(done.path("status").textValue()).isEqualTo("succeeded");
        assertThat(done.path("progress").path("done_lines").intValue()).isEqualTo(400);
        assertThat(done.path("progress").path("total_lines").intValue()).isEqualTo(400);
        JsonNode script = json(get("/v2/reading/scripts/{id}", done.path("script_id").textValue()), 200);
        assertThat(script.path("title").textValue()).isEqualTo("맥베스");
        assertThat(script.path("characters")).extracting(character -> character.path("name").textValue())
                .as("등장인물 소개 순").containsExactly("뱅코우", "맥베스");
        assertThat(script.path("lines")).hasSize(399);
        assertThat(script.path("lines").get(0).path("text").textValue()).isEqualTo("대사 2");
        assertThat(script.path("lines").get(2).path("kind").textValue()).isEqualTo("dialogue");
        assertThat(script.path("lines").get(2).path("character_id").textValue())
                .as("다시 물어 받은 맥베س 도 4번째 줄은 맥베스의 대사다").isEqualTo(script.path("characters").get(1).path("id").textValue());
        assertThat(script.path("lines").get(5).path("kind").textValue()).as("끝까지 빠진 7번째 줄은 지문").isEqualTo("direction");
        assertThat(script.path("lines").get(5).path("text").textValue()).isEqualTo("뱅코우: 대사 7");
        assertThat(script.path("lines").get(198).path("text").textValue()).as("한 번 빠졌다 되찾은 200번째 줄").isEqualTo("대사 200");
        assertThat(script.path("lines").get(4).path("kind").textValue()).as("문맥으로 보낸 6번째 줄의 지문 답은 버린다").isEqualTo("dialogue");
        assertThat(script.path("lines").get(197).path("kind").textValue()).as("문맥으로 보낸 199번째 줄도").isEqualTo("dialogue");
    }

    /** {@code from}~{@code to} 줄의 다시 묻기 입력 — {@code targets} 만 번호 그대로, 나머지는 {@code ~} 문맥. */
    private static String context(int from, int to, Integer... targets) {
        StringBuilder out = new StringBuilder();
        for (int line = from; line <= to; line++) {
            if (!out.isEmpty()) out.append('\n');
            out.append(List.of(targets).contains(line) ? "" : "~").append(line).append('\t')
                    .append(line == 1 ? "등장인물: 뱅코우, 맥베스" : (line % 2 == 0 ? "맥베스: 대사 " : "뱅코우: 대사 ") + line);
        }
        return out.toString();
    }

    @Test
    @DisplayName("SOMA-593 7-14: 첫 호출이 「대본 아니오」면 이름 없는 대사 규칙으로 한 번 더 묻고, 그래도 아니오면 failed not_script. 배역이 0명이면 failed no_characters")
    void notScriptAndNoCharacters() throws Exception {
        Model.answer = call -> "대본\t아니오\n";
        String prose = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "어느 날 밤이었다.\n비가 내렸다.", "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        JsonNode failed = json(get("/v2/reading/imports/{id}", prose), 200);
        assertThat(failed.path("status").textValue()).isEqualTo("failed");
        assertThat(failed.path("failure").textValue()).isEqualTo("not_script");
        assertThat(failed.path("script_id").isNull()).isTrue();
        assertThat(Model.CALLS).hasSize(2);
        assertThat(Model.CALLS.get(0).unnamed()).isFalse();
        assertThat(Model.CALLS.get(1).unnamed()).isTrue();
        assertThat(Model.CALLS.get(1).judging()).isTrue();

        Model.CALLS.clear();
        Model.answer = call -> "대본\t예\n" + call.lines().stream().map(line -> line[0] + "\tx\t\t\n").reduce("", String::concat);
        String empty = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "어느 날 밤이었다.\n비가 내렸다!", "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        assertThat(json(get("/v2/reading/imports/{id}", empty), 200).path("failure").textValue()).isEqualTo("no_characters");
        assertThat(Model.CALLS).extracting(Model.Call::unnamed).containsExactly(false, true);
        assertThat(count("scripts")).isZero();
        assertThat(jdbc.queryForList("SELECT raw_text FROM script_imports", String.class)).containsExactly("", "");
        assertThat(jdbc.queryForList("SELECT status FROM ai_jobs ORDER BY created_at", String.class)).containsExactly("failed", "failed");
        assertThat(failures.reports()).isEmpty();
    }

    @Test
    @DisplayName("SOMA-709 1번: 다른 배역 이름만으로 된 화자는 묶음 배역으로 저장하고 함께 말하는 배역 id 를 싣는다 — 순서만 다른 묶음은 하나, 보통 배역 뒤")
    void groupSpeakersAreStoredWithTheirMembers() throws Exception {
        Model.answer = Model::oracle;
        String id = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null,
                "지해: 가자.\n연수: 응.\n연희: 어디?\n지해,연수: 같이 가!\n연수·지해: 그래!\n모두: 만세!", "paste")), 202).path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();

        JsonNode done = json(get("/v2/reading/imports/{id}", id), 200);
        JsonNode script = json(get("/v2/reading/scripts/{id}", done.path("script_id").textValue()), 200);
        JsonNode characters = script.path("characters");
        assertThat(characters).extracting(character -> character.path("name").textValue()).containsExactly("지해", "연수", "연희", "지해,연수", "모두");
        String jihae = characters.get(0).path("id").textValue();
        String yeonsu = characters.get(1).path("id").textValue();
        assertThat(characters.get(0).path("member_ids")).isEmpty();
        assertThat(characters.get(3).path("member_ids")).extracting(JsonNode::textValue).containsExactly(jihae, yeonsu);
        assertThat(characters.get(4).path("member_ids")).as("모두는 모든 배역").extracting(JsonNode::textValue)
                .containsExactly(jihae, yeonsu, characters.get(2).path("id").textValue());
        assertThat(characters.get(3).path("dialogue_count").intValue()).isEqualTo(2);
        assertThat(script.path("lines").get(4).path("character_id").textValue()).isEqualTo(characters.get(3).path("id").textValue());
        assertThat(jdbc.queryForList("SELECT array_length(member_ids, 1) FROM script_characters ORDER BY sort_order", Integer.class))
                .containsExactly(null, null, null, 2, 3);
    }

    @Test
    @DisplayName("SOMA-709 3번: 원문 머리로 쓰인 적 없는 의심 화자의 줄은 다시 묻고, 끝내 답이 없으면 첫 답으로 되돌린다 — 지문으로 잃지 않는다")
    void suspiciousSpeakersAreAskedAgainWithoutLosingTheLine() throws Exception {
        Model.answer = call -> call.instructions().contains("다시 묻는 것이다") ? "~4\tx\t\t\n"
                : Model.oracle(call).replaceAll("(?m)^5\t.*$", "5\td\t그리고\t");
        String id = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null,
                "윤서: 가자.\n윤서: 빨리.\n태오: 응.\n태오: 그래.\n그리고 손을 흔든다.", "paste")), 202).path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();

        assertThat(json(get("/v2/reading/imports/{id}", id), 200).path("status").textValue()).isEqualTo("succeeded");
        assertThat(Model.CALLS).hasSize(1 + 2);
        assertThat(Model.CALLS.get(1).input()).as("원문 머리인 드문 이름(윤서·태오)은 묻지 않는다").endsWith("\n5\t그리고 손을 흔든다.");
        assertThat(jdbc.queryForList("SELECT name FROM script_characters ORDER BY name", String.class)).containsExactly("그리고", "윤서", "태오");
    }

    @Test
    @DisplayName("SOMA-663 M1: 번호 줄도 판단 줄도 없는 답은 형식 안내를 붙여 그 호출만 한 번 더 묻는다 — 또 벗어나면 빠진 줄 다시 묻기로 간다")
    void unformattedAnswerIsAskedOnceMore() throws Exception {
        Model.answer = call -> call.instructions().contains("형식의 결과 줄이 하나도 없어") ? Model.oracle(call) : "동기화가 실패했습니다.";
        String id = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어.", "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        assertThat(json(get("/v2/reading/imports/{id}", id), 200).path("status").textValue()).isEqualTo("succeeded");
        assertThat(jdbc.queryForList("SELECT name FROM script_characters ORDER BY name", String.class)).containsExactly("윤서", "태오");
        assertThat(Model.CALLS).hasSize(2);
        assertThat(Model.CALLS.get(1).judging()).as("첫 호출의 판단 줄·배역 블록 지시는 그대로").isTrue();

        Model.CALLS.clear();
        Model.answer = call -> call.instructions().contains("다시 묻는 것이다") ? Model.oracle(call) : "동기화가 실패했습니다.";
        String again = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "윤서: 또 왔어.\n태오: 응.", "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        assertThat(json(get("/v2/reading/imports/{id}", again), 200).path("status").textValue()).isEqualTo("succeeded");
        assertThat(Model.CALLS).as("첫 호출 + 형식 다시 묻기 한 번 + 빠진 줄 다시 묻기").hasSize(3);
        assertThat(failures.reports()).isEmpty();
    }

    @Test
    @DisplayName("SOMA-663: 이름 없는 독백은 첫 판이 대본 아니오여도 이름 없는 대사 규칙으로 다시 나눠 「화자」 배역으로 저장한다")
    void unnamedMonologue() throws Exception {
        Model.answer = call -> call.unnamed()
                ? "대본\t예\n" + call.lines().stream().map(line -> line[0] + "\td\t화자\t\n").reduce("", String::concat)
                : "대본\t아니오\n";
        String id = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "왜 내 마음을 몰라?\n난 아직도 손이 떨려.", "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        JsonNode done = json(get("/v2/reading/imports/{id}", id), 200);
        assertThat(done.path("status").textValue()).isEqualTo("succeeded");
        assertThat(jdbc.queryForList("SELECT name FROM script_characters", String.class)).containsExactly("화자");
        assertThat(Model.CALLS).extracting(Model.Call::unnamed).containsExactly(false, true);
        assertThat(failures.reports()).isEmpty();
    }

    @Test
    @DisplayName("SOMA-663: 다시 나눠 통과한 글도 Jev 「말하는 글」 확신이 0.5 아래면 not_script. 확신이 높거나 Jev 가 실패하면 저장한다")
    void speechGate() throws Exception {
        Model.answer = call -> call.unnamed()
                ? "대본\t예\n" + call.lines().stream().map(line -> line[0] + "\td\t화자\t\n").reduce("", String::concat)
                : "대본\t아니오\n";
        assertThat(gated(() -> 0.2, "엄마, 잘 지내?\n나는 잘 지내.")).isEqualTo("not_script");
        assertThat(gated(() -> 0.9, "왜 내 마음을 몰라?\n난 아직도 손이 떨려.")).isEqualTo("succeeded");
        assertThat(failures.reports()).isEmpty();
        assertThat(gated(() -> { throw new IllegalStateException("decision HTTP 503"); }, "너 진짜 그럴 거야?\n대답 좀 해.")).isEqualTo("succeeded");
        assertThat(failures.reports()).singleElement().satisfies(report -> assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL));
    }

    /** 문지기만 붙인 워커로 하나 나누고 상태(실패면 failure)를 돌려준다. */
    private String gated(java.util.function.DoubleSupplier speech, String text) throws Exception {
        LineDecider decider = new LineDecider() {
            @Override public LineReview.Decision decide(LineReview.Question question) {
                throw new AssertionError("줄 두 번째 의견은 꺼져 있다");
            }

            @Override public double speech(String ignored) {
                return speech.getAsDouble();
            }

            @Override public Map<String, Double> role(SpeakerMerge.Candidate candidate, boolean reversed) {
                throw new AssertionError("같은 사람 판단은 꺼져 있다");
            }
        };
        ScriptSplitWorker gated = new ScriptSplitWorker(ledger, imports, generator, telemetry, failures, clock, decider, null);
        String id = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, text, "paste")), 202).path("import_id").textValue();
        assertThat(gated.runOnce(clock.instant())).isTrue();
        JsonNode done = json(get("/v2/reading/imports/{id}", id), 200);
        return done.path("status").textValue().equals("failed") ? done.path("failure").textValue() : done.path("status").textValue();
    }

    @Test
    @DisplayName("모델 실패: 붐빔·서버 실패는 두 번 더 보내고 그래도 안 되면 failed(기기 파서 대비 없음)와 external 보고. 한 번 실패 뒤 성공하면 succeeded")
    void modelFailuresRetryTwiceThenFail() throws Exception {
        Model.answer = call -> {
            throw new OpenAiStatusException(503, "OpenAI 생성 실패: 지금 AI가 붐빕니다. 잠시 뒤 다시 시도해 주세요.");
        };
        String importId = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕\n트레플레프: 응", "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        JsonNode failed = json(get("/v2/reading/imports/{id}", importId), 200);
        assertThat(failed.path("status").textValue()).isEqualTo("failed");
        assertThat(failed.path("failure").textValue()).isEqualTo("failed");
        assertThat(Model.CALLS).hasSize(3);
        assertThat(failures.reports()).singleElement().satisfies(report -> {
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).startsWith("ScriptSplitWorker.run");
        });
        assertThat(jdbc.queryForObject("SELECT failure_reason FROM ai_jobs", String.class)).isEqualTo("failed");

        Model.CALLS.clear();
        AtomicInteger attempts = new AtomicInteger();
        Model.answer = call -> {
            if (attempts.incrementAndGet() == 1) throw new OpenAiStatusException(429, "busy");
            return Model.oracle(call);
        };
        String retried = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕!\n트레플레프: 응", "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        assertThat(json(get("/v2/reading/imports/{id}", retried), 200).path("status").textValue()).isEqualTo("succeeded");
        assertThat(Model.CALLS).hasSize(2);

        Model.CALLS.clear();
        Model.answer = call -> {
            throw new OpenAiStatusException(400, "bad request");
        };
        String rejected = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕?\n트레플레프: 응", "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        assertThat(json(get("/v2/reading/imports/{id}", rejected), 200).path("failure").textValue()).isEqualTo("failed");
        assertThat(Model.CALLS).as("우리가 잘못 보낸 것은 다시 보내지 않는다").hasSize(1);
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 글자마다 띄어진 줄만 나누기 전에 복원 호출로 보내고, 대본 줄·제목은 고친 글, scripts.raw_text 는 받은 원문 그대로다")
    void restoresSpacingBeforeSplitting() throws Exception {
        String importId = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, SPACED, "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();

        assertThat(Model.CALLS).extracting(Model.Call::spacing).containsExactly(true, false);
        assertThat(Model.CALLS.get(0).input()).isEqualTo("1\t엄 마 의 시 험\n3\t[ 엄 마 ] 유 세 아 , 공 부 열 심 히 하 고 있 지 ?\n"
                + "4\t[ 유 세 아 ] 응 . 걱 정 하 지 마 .\n5\t( 암 전 )");
        assertThat(Model.CALLS.get(1).input()).isEqualTo("1\t엄마의 시험\n2\t[엄마] 이번엔 시험 잘 봐야지.\n"
                + "3\t[엄마] 유세아, 공부 열심히 하고 있지?\n4\t[유세아] 응. 걱정하지 마.\n5\t(암전)");

        JsonNode done = json(get("/v2/reading/imports/{id}", importId), 200);
        assertThat(done.path("status").textValue()).isEqualTo("succeeded");
        assertThat(done.path("progress").path("done_lines").intValue()).isEqualTo(5);
        assertThat(done.path("progress").path("total_lines").intValue()).isEqualTo(5);
        JsonNode script = json(get("/v2/reading/scripts/{id}", done.path("script_id").textValue()), 200);
        assertThat(script.path("title").textValue()).isEqualTo("엄마의 시험");
        assertThat(script.path("characters")).extracting(character -> character.path("name").textValue()).containsExactly("엄마", "유세아");
        assertThat(script.path("lines")).extracting(line -> line.path("kind").textValue() + "|" + line.path("text").textValue())
                .containsExactly("direction|엄마의 시험", "dialogue|이번엔 시험 잘 봐야지.", "dialogue|유세아, 공부 열심히 하고 있지?",
                        "dialogue|응. 걱정하지 마.", "direction|(암전)");
        assertThat(jdbc.queryForObject("SELECT raw_text FROM scripts", String.class)).isEqualTo(SPACED);
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, SPACED, "paste")), 200)
                .path("duplicate_script_id").textValue()).as("같은 원문은 중복으로 알아본다").isEqualTo(done.path("script_id").textValue());
        assertThat(failures.reports()).isEmpty();
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 모델이 글자 하나를 바꾼 줄은 원문 글자에 띄어쓰기만 옮기고, 다른 줄의 글을 돌려준 줄과 빠뜨린 줄은 원문 그대로 나눈다")
    void keepsOriginalLettersWhenRestorationChangesThem() throws Exception {
        Model.answer = call -> call.spacing()
                ? "1\t엄마의 시험\n3\t[엄마] 유세아, 공부 열심히 하고 있니?\n4\t[엄마] 유세아, 공부 열심히 하고 있지?\n"
                : Model.oracle(call);
        String scriptId = split(SPACED);

        assertThat(Model.CALLS.get(1).input()).isEqualTo("1\t엄마의 시험\n2\t[엄마] 이번엔 시험 잘 봐야지.\n"
                + "3\t[엄마] 유세아, 공부 열심히 하고 있지?\n4\t[ 유 세 아 ] 응 . 걱 정 하 지 마 .\n5\t( 암 전 )");
        JsonNode script = json(get("/v2/reading/scripts/{id}", scriptId), 200);
        assertThat(script.path("lines")).extracting(line -> line.path("kind").textValue() + "|" + line.path("text").textValue())
                .containsExactly("direction|엄마의 시험", "dialogue|이번엔 시험 잘 봐야지.", "dialogue|유세아, 공부 열심히 하고 있지?",
                        "direction|[ 유 세 아 ] 응 . 걱 정 하 지 마 .", "direction|( 암 전 )");
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 복원 호출이 503 을 세 번 답해도 작업은 실패하지 않고 원문으로 나눠 succeeded — external 보고 하나")
    void restorationFailureDoesNotFailTheJob() throws Exception {
        Model.answer = call -> {
            if (call.spacing()) throw new OpenAiStatusException(503, "OpenAI 생성 실패: 지금 AI가 붐빕니다. 잠시 뒤 다시 시도해 주세요.");
            return Model.oracle(call);
        };
        String scriptId = split(SPACED);

        assertThat(Model.CALLS).extracting(Model.Call::spacing).containsExactly(true, true, true, false);
        assertThat(failures.reports()).singleElement().satisfies(report -> {
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).startsWith("ScriptSplitWorker.spacing");
        });
        JsonNode script = json(get("/v2/reading/scripts/{id}", scriptId), 200);
        assertThat(script.path("title").textValue()).isEqualTo("엄 마 의 시 험");
        assertThat(script.path("lines")).extracting(line -> line.path("kind").textValue() + "|" + line.path("text").textValue())
                .containsExactly("direction|엄 마 의 시 험", "dialogue|이번엔 시험 잘 봐야지.",
                        "direction|[ 엄 마 ] 유 세 아 , 공 부 열 심 히 하 고 있 지 ?", "direction|[ 유 세 아 ] 응 . 걱 정 하 지 마 .",
                        "direction|( 암 전 )");
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 띄어진 줄이 없으면 복원 호출이 없다 — 짧게 띄어진 「( 암 전 )」 혼자로는 부르지 않는다")
    void noSpacedLineMeansNoRestorationCall() throws Exception {
        String scriptId = split("[유세아] 응.\n[엄마] 이번엔 시험 잘 봐야지.\n( 암 전 )");

        assertThat(Model.CALLS).extracting(Model.Call::spacing).containsExactly(false);
        assertThat(Model.CALLS.getFirst().input()).isEqualTo("1\t[유세아] 응.\n2\t[엄마] 이번엔 시험 잘 봐야지.\n3\t( 암 전 )");
        JsonNode script = json(get("/v2/reading/scripts/{id}", scriptId), 200);
        assertThat(script.path("lines")).extracting(line -> line.path("kind").textValue() + "|" + line.path("text").textValue())
                .containsExactly("dialogue|응.", "dialogue|이번엔 시험 잘 봐야지.", "direction|( 암 전 )");
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 한글 여덟 음절 넘게 붙은 줄은 띄어진 줄이 없어도 그 줄만 복원 호출로 보내고, 고친 글로 나눈다")
    void restoresJoinedLineWithoutSpacedLines() throws Exception {
        String scriptId = split("[유세아] 응.\n[엄마] 언제 돌아가실지모르겠지만그래도\n( 암 전 )");

        assertThat(Model.CALLS).extracting(Model.Call::spacing).containsExactly(true, false);
        assertThat(Model.CALLS.getFirst().input()).isEqualTo("2\t[엄마] 언제 돌아가실지모르겠지만그래도");
        JsonNode script = json(get("/v2/reading/scripts/{id}", scriptId), 200);
        assertThat(script.path("lines")).extracting(line -> line.path("kind").textValue() + "|" + line.path("text").textValue())
                .containsExactly("dialogue|응.", "dialogue|언제 돌아가실지 모르겠지만 그래도", "direction|( 암 전 )");
    }

    @Test
    @DisplayName("reading.script 띄어쓰기 복원: 맞게 띄어 쓴 「네 쪽 세 번 내 쪽 세 번」만 걸린 대본은 그 줄 하나를 보내고, 그대로 돌아오면 그대로 저장한다")
    void correctlySpacedShortWordsComeBackUnchanged() throws Exception {
        String scriptId = split("유세아: 이번엔 누가 먼저 해?\n엄마: 네 쪽 세 번 내 쪽 세 번");

        assertThat(Model.CALLS).extracting(Model.Call::spacing).containsExactly(true, false);
        assertThat(Model.CALLS.getFirst().input()).isEqualTo("2\t엄마: 네 쪽 세 번 내 쪽 세 번");
        JsonNode script = json(get("/v2/reading/scripts/{id}", scriptId), 200);
        assertThat(script.path("lines")).extracting(line -> line.path("kind").textValue() + "|" + line.path("text").textValue())
                .containsExactly("dialogue|이번엔 누가 먼저 해?", "dialogue|네 쪽 세 번 내 쪽 세 번");
    }

    @Test
    @DisplayName("CONTRACT §5-7: 집은 워커가 죽어도 lease(30분)가 지나면 다른 워커가 다시 집어 끝낸다 — 그동안 상태는 running 이고 같은 글의 새 요청은 그 작업을 돌려준다")
    void deadWorkersLeaseIsReclaimedAfterItExpires() throws Exception {
        String importId = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕\n트레플레프: 응", "paste")), 202)
                .path("import_id").textValue();
        // 다른 워커가 집고 죽었다.
        assertThat(ledger.claimNext("script_split", UUID.randomUUID(), Duration.ofMinutes(30), clock.instant())).isNotNull();
        assertThat(json(get("/v2/reading/imports/{id}", importId), 200).path("status").textValue()).isEqualTo("running");
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕\n트레플레프: 응", "paste")), 200)
                .path("import_id").textValue()).as("두 번 누름은 돌고 있는 작업을 돌려준다").isEqualTo(importId);
        assertThat(worker.runOnce(clock.instant())).as("lease 가 살아 있는 동안은 집지 않는다").isFalse();

        clock.set(clock.instant().plus(Duration.ofMinutes(31)));
        assertThat(worker.runOnce(clock.instant())).isTrue();

        JsonNode done = json(get("/v2/reading/imports/{id}", importId), 200);
        assertThat(done.path("status").textValue()).isEqualTo("succeeded");
        assertThat(jdbc.queryForObject("SELECT attempt_count FROM ai_jobs", Integer.class)).isEqualTo(2);
        assertThat(count("scripts")).isEqualTo(1);
    }

    @Test
    @DisplayName("CONTRACT §5-7: 시도 셋을 다 쓴 채 lease 가 지난 작업은 다시 집지 않고 sweep 이 failed 로 닫는다 — 앱은 R2.12 를 띄운다")
    void exhaustedJobIsClosedBySweep() throws Exception {
        String importId = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕\n트레플레프: 응", "paste")), 202)
                .path("import_id").textValue();
        jdbc.update("UPDATE ai_jobs SET status='running',attempt_count=3,lease_token=gen_random_uuid(),lease_expires_at=?",
                java.sql.Timestamp.from(clock.instant().minusSeconds(60)));
        assertThat(worker.runOnce(clock.instant())).isFalse();
        assertThat(json(get("/v2/reading/imports/{id}", importId), 200).path("status").textValue()).isEqualTo("running");

        assertThat(worker.sweep()).isEqualTo(1);

        JsonNode failed = json(get("/v2/reading/imports/{id}", importId), 200);
        assertThat(failed.path("status").textValue()).isEqualTo("failed");
        assertThat(failed.path("failure").textValue()).isEqualTo("failed");
        assertThat(jdbc.queryForObject("SELECT failure_reason FROM ai_jobs", String.class)).isEqualTo("max_attempts");
        assertThat(worker.sweep()).as("다시 쓸 것이 없다").isZero();
        assertThat(Model.CALLS).isEmpty();
    }

    @Test
    @DisplayName("R2.7 「새로 넣기」(allow_duplicate): 같은 글의 대본이 있어도 새 작업으로 나누고 하루 한도에 센다. 지문에 들어 같은 request_id 에 플래그만 달라도 422")
    void allowDuplicateSplitsAgain() throws Exception {
        String text = "니나: 저는 갈매기예요.\n트레플레프: 아니에요.";
        split(text);
        UUID requestId = UUID.randomUUID();
        assertThat(json(post("/v2/reading/imports").content(request(requestId, null, text, "paste")), 200).path("duplicate_script_id").isTextual()).isTrue();
        String again = json(post("/v2/reading/imports").content(request(requestId, null, text, "paste", "allow_duplicate", true)), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        assertThat(json(get("/v2/reading/imports/{id}", again), 200).path("status").textValue()).isEqualTo("succeeded");
        assertThat(count("scripts")).isEqualTo(2);
        assertThat(count("ai_jobs")).as("한도에 센다").isEqualTo(2);
        assertThat(json(post("/v2/reading/imports").content(request(requestId, null, text, "paste")), 422).path("detail").textValue())
                .isEqualTo("request_fingerprint_mismatch");
    }

    @Test
    @DisplayName("R2.8 「그래도 나누기」(skip_script_check): 대본 여부를 묻지 않고 나눈다 — 지시문에 판단 줄이 없고, 모델이 아니오라 해도 멈추지 않는다")
    void skipScriptCheckSplitsProse() throws Exception {
        Model.answer = call -> call.judging() ? "대본\t아니오\n" : Model.oracle(call);
        String importId = json(post("/v2/reading/imports")
                .content(request(UUID.randomUUID(), null, "어느 날 밤이었다.\n서진: 열쇠는 맞는데 손이 안 움직여.", "paste", "skip_script_check", true)), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        JsonNode done = json(get("/v2/reading/imports/{id}", importId), 200);
        assertThat(done.path("status").textValue()).isEqualTo("succeeded");
        assertThat(Model.CALLS).singleElement().satisfies(call -> assertThat(call.judging()).isFalse());
        assertThat(jdbc.queryForObject("SELECT skip_script_check FROM script_imports", Boolean.class)).isTrue();
    }

    @Test
    @DisplayName("한도: 원문 100,001자는 422 script_too_long, 대본 100개인 회원은 422 script_limit — 둘 다 모델 전에, 행 없이")
    void limitsAreCheckedBeforeTheModel() throws Exception {
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: " + "가".repeat(99_997), "paste")), 422)
                .path("detail").textValue()).isEqualTo("script_too_long");
        for (int index = 0; index < 100; index++) {
            jdbc.update("""
                    INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint)
                    VALUES (?,?,?,'원문',?,'paste',?,?)
                    """, UUID.randomUUID(), member, "대본 " + index, String.format("%064d", index), UUID.randomUUID(), "f".repeat(64));
        }
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕\n트레플레프: 응", "paste")), 422)
                .path("detail").textValue()).isEqualTo("script_limit");
        assertThat(count("script_imports")).isZero();
        assertThat(Model.CALLS).isEmpty();
    }

    @Test
    @DisplayName("같은 request_id 로 다른 대본을 이미 저장해 둔 기기의 요청은 저장할 수 없어 failed 로 닫힌다")
    void fingerprintMismatchAtCompletionFails() throws Exception {
        UUID requestId = UUID.randomUUID();
        String importId = json(post("/v2/reading/imports").content(request(requestId, null, "니나: 안녕\n트레플레프: 응", "paste")), 202)
                .path("import_id").textValue();
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint)
                VALUES (?,?,'다른 대본','다른 원문',repeat('1',64),'paste',?,?)
                """, UUID.randomUUID(), member, requestId, "e".repeat(64));
        assertThat(worker.runOnce(clock.instant())).isTrue();
        JsonNode failed = json(get("/v2/reading/imports/{id}", importId), 200);
        assertThat(failed.path("status").textValue()).isEqualTo("failed");
        assertThat(failed.path("failure").textValue()).isEqualTo("failed");
        assertThat(count("scripts")).isEqualTo(1);
    }

    @Test
    @DisplayName("상태 조회: 없는 것과 남의 것은 404 import_not_found. 탈퇴·이관이 먼저 끝난 계정의 접수는 403 account_deactivated")
    void notFoundAndDeactivated() throws Exception {
        String importId = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕\n트레플레프: 응", "paste")), 202)
                .path("import_id").textValue();
        assertThat(json(get("/v2/reading/imports/{id}", UUID.randomUUID()), 404).path("detail").textValue()).isEqualTo("import_not_found");
        var other = perform(get("/v2/reading/imports/{id}", importId), "Bearer " + jwt.issueAccessToken(member()).value());
        assertThat(other.getStatus()).isEqualTo(404);

        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", member);
        var closed = perform(post("/v2/reading/imports").contentType(MediaType.APPLICATION_JSON)
                .content(request(UUID.randomUUID(), null, "니나: 또 안녕\n트레플레프: 응", "paste")), bearer);
        assertThat(closed.getStatus()).isEqualTo(403);
    }

    @Test
    @DisplayName("PDF 추출기가 매핑 없는 글자로 내는 NUL(U+0000)·Hancom PDF 의 U+F000 이 글에 섞여 와도 접수된다 — 저장 전에 지우고, 같은 글 판정에도 들어가지 않는다")
    void nulCharactersAreDroppedBeforeStorage() throws Exception {
        String clean = "니나: 저는 갈매기예요.\n트레플레프: 아니에요.";
        String scriptId = split(clean);
        JsonNode duplicate = json(post("/v2/reading/imports")
                .content(request(UUID.randomUUID(), "갈\u0000매기", "니나: 저는 갈\u0000매기예요.\n\u0000트레플레프: 아니에요.", "paste")), 200);
        assertThat(duplicate.path("duplicate_script_id").textValue()).as("NUL 만 다른 글은 같은 글").isEqualTo(scriptId);

        String importId = json(post("/v2/reading/imports")
                .content(request(UUID.randomUUID(), "갈\u0000매기", "니나: 저는 \uF000갈\u0000매기\uF000예요!\n\u0000트레플레프: 아니에요.", "paste")), 202)
                .path("import_id").textValue();
        assertThat(jdbc.queryForObject("SELECT raw_text FROM script_imports WHERE id=?::uuid", String.class, importId))
                .isEqualTo("니나: 저는 갈매기예요!\n트레플레프: 아니에요.");
        assertThat(worker.runOnce(clock.instant())).isTrue();
        JsonNode done = json(get("/v2/reading/imports/{id}", importId), 200);
        assertThat(done.path("status").textValue()).isEqualTo("succeeded");
        JsonNode script = json(get("/v2/reading/scripts/{id}", done.path("script_id").textValue()), 200);
        assertThat(script.path("title").textValue()).isEqualTo("갈매기");
        assertThat(script.path("lines").get(0).path("text").textValue()).isEqualTo("저는 갈매기예요!");
    }

    @Test
    @DisplayName("요청 모양: raw_text 가 비었거나 보이는 글자가 없거나, 제목이 200자를 넘거나, source 가 목록 밖이면 422 배열")
    void shapeErrorsAreArrays() throws Exception {
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "   ", "paste")), 422).path("detail").isArray()).isTrue();
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "\u3000\u200B\n\u3000", "paste")), 422).path("detail").isArray()).isTrue();
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), "제".repeat(201), "니나: 안녕", "paste")), 422).path("detail").isArray()).isTrue();
        assertThat(count("script_imports")).isZero();
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕", "email")), 422).path("detail").isArray()).isTrue();
    }

    @Test
    @DisplayName("SOMA-670: 짧은 대본은 나누기 호출 하나의 답 끝 「배역」 블록으로 성별·나이대를 받아 저장하고, 상세가 gender·age_band 와 그에 맞는 자동 목소리를 준다")
    void shortScriptStoresTraitsFromTheTrailingCastBlock() throws Exception {
        Model.answer = call -> call.spacing() ? Model.oracle(call)
                : Model.oracle(call) + "배역\n윤서\tf\tyoung\n태오\tm\tyoung\n할머니\tf\tsenior\n";

        String scriptId = split("윤서: 여기 있을 줄 알았어.\n태오: 어떻게 알았어.\n할머니: 밥 먹자.\n");

        assertThat(Model.CALLS).as("호출을 늘리지 않는다").hasSize(1);
        assertThat(Model.CALLS.getFirst().instructions()).contains("맨 끝에 \"배역\" 한 줄을 쓰고");
        assertThat(jdbc.queryForList("SELECT name,gender,age_band FROM script_characters ORDER BY sort_order"))
                .extracting(row -> row.get("name") + "|" + row.get("gender") + "|" + row.get("age_band"))
                .containsExactly("윤서|f|young", "태오|m|young", "할머니|f|senior");
        JsonNode script = json(get("/v2/reading/scripts/{id}", scriptId), 200);
        assertThat(script.path("characters")).extracting(character -> character.path("name").textValue() + "|"
                        + character.path("gender").textValue() + "|" + character.path("age_band").textValue() + "|"
                        + character.path("voice").textValue())
                .containsExactly("윤서|f|young|F2", "태오|m|young|M1", "할머니|f|senior|F5");
    }

    @Test
    @DisplayName("SOMA-670: 긴 대본은 배역 목록 호출의 「이름<TAB>성별<TAB>나이대」로 받고, 모르는 칸·목록에 없는 배역은 null 이다")
    void longScriptStoresTraitsFromTheRoster() throws Exception {
        StringBuilder text = new StringBuilder();
        for (int line = 1; line <= 160; line++) {
            text.append(line % 2 == 0 ? "맥베스: 대사 " : "뱅코우: 대사 ").append(line).append('\n');
        }
        text.append("마녀: 마지막 대사\n");
        Model.answer = call -> call.roster() ? "대본\t예\n맥베스\tm\tadult\n뱅코우\t?\tsenior\n" : Model.oracle(call);

        String scriptId = split(text.toString());

        assertThat(Model.CALLS.getFirst().roster()).isTrue();
        assertThat(Model.CALLS.getFirst().instructions()).contains("\"이름<TAB>성별<TAB>나이대\"");
        assertThat(Model.CALLS.subList(1, Model.CALLS.size())).extracting(Model.Call::instructions)
                .as("조각 호출은 「배역」 블록을 묻지 않는다").noneMatch(instructions -> instructions.contains("맨 끝에 \"배역\""));
        JsonNode script = json(get("/v2/reading/scripts/{id}", scriptId), 200);
        assertThat(script.path("characters")).extracting(character -> character.path("name").textValue() + "|"
                        + character.path("gender").textValue() + "|" + character.path("age_band").textValue() + "|"
                        + character.path("voice").textValue())
                .as("대사 수가 같으면 먼저 말한 순 — 성별 모르는 뱅코우·마녀는 순환(F1, 다음 M1)").containsExactly("뱅코우|null|senior|F1", "맥베스|m|adult|M3", "마녀|null|null|M1");
    }

    /** 글을 접수하고 워커를 한 번 돌려 만든 대본 id. */
    private String split(String text) throws Exception {
        String importId = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, text, "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        JsonNode done = json(get("/v2/reading/imports/{id}", importId), 200);
        assertThat(done.path("status").textValue()).as(done.toString()).isEqualTo("succeeded");
        return done.path("script_id").textValue();
    }

    private String request(UUID requestId, String title, String rawText, String source, Object... flags) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("request_id", requestId.toString());
        if (title != null) body.put("title", title);
        body.put("raw_text", rawText);
        body.put("source", source);
        for (int index = 0; index < flags.length; index += 2) body.put((String) flags[index], flags[index + 1]);
        return mapper.writeValueAsString(body);
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)", UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    /** 리딩의 문서 둘에 동의한 웹 게스트의 토큰. */
    private String consentedGuest() throws Exception {
        var created = mvc.perform(post("/v2/auth/guest").with(request -> {
            request.setRemoteAddr("10.48." + ADDRESSES.incrementAndGet() + ".1");
            return request;
        })).andReturn().getResponse();
        assertThat(created.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(created.getContentAsString());
        String bearer = "Bearer " + body.path("access_token").textValue();
        boolean first = true;
        for (String type : List.of("terms", "privacy")) {
            Map<String, Object> consent = new LinkedHashMap<>();
            consent.put("document_id", documents.get(type).toString());
            consent.put("action", "granted");
            if (first) consent.put("age_confirmed", true);
            first = false;
            var response = perform(post("/v2/consents").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(consent)), bearer);
            assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
        }
        return bearer;
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String authorization) throws Exception {
        return mvc.perform(request.header("Authorization", authorization)).andReturn().getResponse();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        return json(request, status, bearer);
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status, String authorization) throws Exception {
        var response = perform(request.contentType(MediaType.APPLICATION_JSON), authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }
}
