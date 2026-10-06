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
import com.acttub.actingapi.feature.reading.app.ScriptSplitWorker;
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
 * 콜론 형식 대본을 완벽하게 나누는 답을 기본으로 내며, 테스트가 답을 비틀거나(빠진 줄·틀린 이름·대본 아님) 실패하게 한다.
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

        /** 콜론 형식을 완벽하게 나누는 답. 괄호 줄은 지문, 「제N막」은 장면, 「등장인물」 줄은 소개다. */
        static String oracle(Call call) {
            StringBuilder out = new StringBuilder();
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
        assertThat(script.path("lines")).hasSize(17);
        assertThat(worker.runOnce(clock.instant())).isFalse();
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
        assertThat(calls.get(4).input()).isEqualTo("7\t뱅코우: 대사 7\n200\t맥베스: 대사 200");
        assertThat(calls.get(5).input()).isEqualTo("7\t뱅코우: 대사 7");

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
                .as("맥베س 로 쓴 4번째 줄은 맥베스의 대사다").isEqualTo(script.path("characters").get(1).path("id").textValue());
        assertThat(script.path("lines").get(5).path("kind").textValue()).as("끝까지 빠진 7번째 줄은 지문").isEqualTo("direction");
        assertThat(script.path("lines").get(5).path("text").textValue()).isEqualTo("뱅코우: 대사 7");
        assertThat(script.path("lines").get(198).path("text").textValue()).as("한 번 빠졌다 되찾은 200번째 줄").isEqualTo("대사 200");
    }

    @Test
    @DisplayName("SOMA-593 7-14: 첫 호출이 「대본 아니오」면 호출 하나로 failed not_script. 배역이 0명이면 failed no_characters")
    void notScriptAndNoCharacters() throws Exception {
        Model.answer = call -> "대본\t아니오\n";
        String prose = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "어느 날 밤이었다.\n비가 내렸다.", "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        JsonNode failed = json(get("/v2/reading/imports/{id}", prose), 200);
        assertThat(failed.path("status").textValue()).isEqualTo("failed");
        assertThat(failed.path("failure").textValue()).isEqualTo("not_script");
        assertThat(failed.path("script_id").isNull()).isTrue();
        assertThat(Model.CALLS).hasSize(1);

        Model.CALLS.clear();
        Model.answer = call -> "대본\t예\n" + call.lines().stream().map(line -> line[0] + "\tx\t\t\n").reduce("", String::concat);
        String empty = json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "어느 날 밤이었다.\n비가 내렸다!", "paste")), 202)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        assertThat(json(get("/v2/reading/imports/{id}", empty), 200).path("failure").textValue()).isEqualTo("no_characters");
        assertThat(count("scripts")).isZero();
        assertThat(jdbc.queryForList("SELECT raw_text FROM script_imports", String.class)).containsExactly("", "");
        assertThat(jdbc.queryForList("SELECT status FROM ai_jobs ORDER BY created_at", String.class)).containsExactly("failed", "failed");
        assertThat(failures.reports()).isEmpty();
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
    @DisplayName("요청 모양: raw_text 가 비었거나 보이는 글자가 없거나, 제목이 200자를 넘거나, source 가 목록 밖이면 422 배열")
    void shapeErrorsAreArrays() throws Exception {
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "   ", "paste")), 422).path("detail").isArray()).isTrue();
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "\u3000\u200B\n\u3000", "paste")), 422).path("detail").isArray()).isTrue();
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), "제".repeat(201), "니나: 안녕", "paste")), 422).path("detail").isArray()).isTrue();
        assertThat(count("script_imports")).isZero();
        assertThat(json(post("/v2/reading/imports").content(request(UUID.randomUUID(), null, "니나: 안녕", "email")), 422).path("detail").isArray()).isTrue();
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
        var response = perform(request.contentType(MediaType.APPLICATION_JSON), bearer);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }
}
