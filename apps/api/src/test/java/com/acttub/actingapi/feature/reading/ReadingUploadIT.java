package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.app.AccountCleanup;
import com.acttub.actingapi.feature.reading.app.ScriptSplitWorker;
import com.acttub.actingapi.feature.reading.app.ScriptUploadService;
import com.acttub.actingapi.feature.reading.domain.SampleScript;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.GenerationOptions;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
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
 * reading.script 「원본 파일」을 HTTP·실제 Postgres·정리 장부로 본다. 스토리지는 메모리, 모델은 콜론 형식을 나누는 가짜다.
 * 글자 뽑기 자체의 형식별 결과는 {@code DocumentTextTest} 가 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ANALYSIS_WORKER_ENABLED=false",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "CHALLENGE_SETTLEMENT_ENABLED=false",
    "SCRIPT_UPLOAD_SWEEP_ENABLED=false"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ReadingUploadIT.Fakes.class})
class ReadingUploadIT {
    private static final Instant NOW = Instant.parse("2026-10-06T03:00:00Z");
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    private static final Pattern COLON = Pattern.compile("^(\\S+?):\\s*(.*)$");
    private static final String SCENE = "니나: 저는 갈매기예요.\n트레플레프: 아니, 당신은 배우예요.\n";

    @TestConfiguration(proxyBeanMethods = false)
    static class Fakes {
        @Bean @Primary FakeStorage fakeStorage() {
            return new FakeStorage();
        }

        /** 콜론 형식을 완벽하게 나누는 답. 첫 호출에 「대본 예」를 붙인다. */
        @Bean @Primary TextGenerator stubTextGenerator() {
            return new TextGenerator() {
                @Override public GeneratedText generate(String instructions, String input) {
                    return generate(instructions, input, null);
                }

                @Override public GeneratedText generate(String instructions, String input, GenerationOptions options) {
                    StringBuilder out = new StringBuilder(instructions.contains("답의 첫 줄은") ? "대본\t예\n" : "");
                    for (String line : input.split("\n")) {
                        String[] numbered = line.split("\t", 2);
                        Matcher matcher = COLON.matcher(numbered[1]);
                        out.append(numbered[0]).append('\t')
                                .append(matcher.matches() ? "d\t" + matcher.group(1) + "\t" + matcher.group(1) + ": " : "x\t\t")
                                .append('\n');
                    }
                    return new GeneratedText(out.toString(), new TokenUsage(10, 20, 30), "");
                }
            };
        }
    }

    /** 메모리 스토리지. 기기의 PUT 은 {@link #put} 으로 흉내 낸다. */
    static final class FakeStorage implements ObjectStorage {
        final Map<String, byte[]> objects = new ConcurrentHashMap<>();
        final AtomicInteger downloads = new AtomicInteger();

        void put(String objectKey, byte[] bytes) {
            objects.put(objectKey, bytes);
        }

        @Override public String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
            return "https://storage.test/put/" + objectKey + "?type=" + mimeType + "&size=" + sizeBytes + "&ttl=" + expiresInSeconds;
        }

        @Override public String presignPlayback(String objectKey, int expiresInSeconds) {
            return "https://storage.test/get/" + objectKey;
        }

        @Override public StoredObjectMetadata head(String objectKey) {
            byte[] bytes = objects.get(objectKey);
            return bytes == null ? null : new StoredObjectMetadata(bytes.length, "application/octet-stream", "etag");
        }

        @Override public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
            downloads.incrementAndGet();
            try {
                Files.write(destination, objects.get(objectKey));
            } catch (IOException failure) {
                throw new UncheckedIOException(failure);
            }
            return head(objectKey);
        }

        @Override public void upload(String objectKey, String mimeType, Path source) {
            throw new UnsupportedOperationException();
        }

        @Override public void delete(String objectKey) {
            objects.remove(objectKey);
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_upload");
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
    @Autowired ScriptUploadService uploads;
    @Autowired FakeStorage storage;
    @Autowired AccountCleanup cleanup;

    private UUID scriptSplitDocument;
    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        clock.set(NOW);
        storage.objects.clear();
        storage.downloads.set(0);
        jdbc.execute("TRUNCATE TABLE users,consent_documents,ai_jobs,account_cleanup_operations RESTART IDENTITY CASCADE");
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention", "cloud_voice", "script_split")) {
            UUID id = UUID.randomUUID();
            if (type.equals("script_split")) scriptSplitDocument = id;
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,locale,title,body,required,published_at)
                    VALUES (?,?,'v1','ko',?,?,?,?)
                    """, id, type, type + " 제목", type + " 본문", List.of("terms", "privacy", "ai_analysis").contains(type), PUBLISHED);
        }
        member = member();
        bearer = bearerOf(member);
    }

    @Test
    @DisplayName("reading.script 원본: 올릴 자리 201 → 올리기 전 읽기 422 script_upload_not_ready → 올린 뒤 읽기 204(다시 불러도 204, 받기 한 번) → "
            + "upload_id 로 나누기 202 → 워커가 저장하면 원본이 그 대본에 연결되고 뽑은 글을 비운다")
    void uploadsReadsAndSplitsAFile() throws Exception {
        byte[] cp949 = SCENE.getBytes(Charset.forName("x-windows-949"));
        JsonNode ticket = json(post("/v2/reading/uploads").content(upload("갈매기.txt", cp949.length)), 201, bearer);
        String uploadId = ticket.path("upload_id").textValue();
        String key = "reading-source/" + member + "/" + uploadId;
        assertThat(ticket.path("upload_url").textValue())
                .isEqualTo("https://storage.test/put/" + key + "?type=application/octet-stream&size=" + cp949.length + "&ttl=900");
        assertThat(ticket.path("content_type").textValue()).isEqualTo("application/octet-stream");
        assertThat(ticket.path("expires_at").textValue()).isEqualTo("2026-10-06T03:15:00.000000Z");

        assertThat(detail(post("/v2/reading/uploads/{id}/complete", uploadId), 422)).isEqualTo("script_upload_not_ready");
        assertThat(detail(post("/v2/reading/imports").content(fileImport(UUID.randomUUID(), uploadId)), 422))
                .as("읽기 전에는 나눌 글이 없다").isEqualTo("script_upload_not_ready");

        storage.put(key, java.util.Arrays.copyOf(cp949, cp949.length - 1));
        assertThat(detail(post("/v2/reading/uploads/{id}/complete", uploadId), 422))
                .as("크기가 올릴 자리와 다르면 아직 다 올라오지 않은 것이다").isEqualTo("script_upload_not_ready");
        storage.put(key, cp949);
        assertThat(perform(post("/v2/reading/uploads/{id}/complete", uploadId), bearer).getStatus()).isEqualTo(204);
        assertThat(perform(post("/v2/reading/uploads/{id}/complete", uploadId), bearer).getStatus()).isEqualTo(204);
        assertThat(storage.downloads.get()).as("이미 읽은 파일은 다시 받지 않는다").isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT raw_text FROM script_uploads", String.class)).isEqualTo(SCENE);

        String importId = json(post("/v2/reading/imports").content(fileImport(UUID.randomUUID(), uploadId)), 202, bearer)
                .path("import_id").textValue();
        assertThat(jdbc.queryForObject("SELECT script_id FROM script_uploads", UUID.class)).as("저장 전에는 연결되지 않는다").isNull();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        JsonNode done = json(get("/v2/reading/imports/{id}", importId), 200, bearer);
        assertThat(done.path("status").textValue()).isEqualTo("succeeded");
        String scriptId = done.path("script_id").textValue();
        JsonNode script = json(get("/v2/reading/scripts/{id}", scriptId), 200, bearer);
        assertThat(script.path("source").textValue()).isEqualTo("file");
        assertThat(script.path("lines")).extracting(line -> line.path("text").textValue())
                .containsExactly("저는 갈매기예요.", "아니, 당신은 배우예요.");
        assertThat(jdbc.queryForObject("SELECT script_id FROM script_uploads", String.class)).isEqualTo(scriptId);
        assertThat(jdbc.queryForObject("SELECT raw_text FROM script_uploads", String.class)).as("글은 대본에 있어 원본 행에서 비운다").isNull();

        assertThat(perform(post("/v2/reading/uploads/{id}/complete", uploadId), bearer).getStatus())
                .as("대본에 연결된 원본은 다시 읽지 않는다").isEqualTo(204);
        assertThat(storage.downloads.get()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT raw_text FROM script_uploads", String.class)).isNull();
        Map<String, Object> again = new LinkedHashMap<>();
        again.put("request_id", UUID.randomUUID().toString());
        again.put("upload_id", uploadId);
        again.put("source", "file");
        again.put("allow_duplicate", true);
        assertThat(json(post("/v2/reading/imports").content(mapper.writeValueAsString(again)), 422, bearer).path("detail").textValue())
                .as("이미 대본이 된 원본으로는 다시 나누지 않는다 — 파일을 다시 올린다").isEqualTo("script_upload_used");
        assertThat(jdbc.queryForObject("SELECT raw_text FROM scripts", String.class)).isEqualTo(SCENE);
    }

    @Test
    @DisplayName("reading.script 원본: 50,000,000바이트는 되고 1바이트 넘으면 422 script_file_too_large, 확장자가 txt·docx·pdf·hwp·hwpx 밖이면 "
            + "422 script_file_unreadable, script_split 동의가 없으면 403 — 거절은 행을 남기지 않는다")
    void reserveRejections() throws Exception {
        assertThat(perform(post("/v2/reading/uploads").content(upload("대본.HWPX", 50_000_000)), bearer).getStatus()).isEqualTo(201);
        assertThat(detail(post("/v2/reading/uploads").content(upload("대본.pdf", 50_000_001)), 422)).isEqualTo("script_file_too_large");
        assertThat(detail(post("/v2/reading/uploads").content(upload("대본.doc", 10)), 422)).isEqualTo("script_file_unreadable");
        assertThat(detail(post("/v2/reading/uploads").content(upload("대본", 10)), 422)).isEqualTo("script_file_unreadable");
        jdbc.update("DELETE FROM user_consents WHERE user_id=? AND document_id=?", member, scriptSplitDocument);
        assertThat(detail(post("/v2/reading/uploads").content(upload("대본.txt", 10)), 403)).isEqualTo("script_split_consent_required");
        assertThat(count("script_uploads")).isEqualTo(1);
        assertThat(perform(post("/v2/reading/uploads").content("{\"file_name\":\"a.txt\",\"byte_size\":0}"), bearer).getStatus())
                .as("빈 파일은 본문 모양 오류다").isEqualTo(422);
    }

    @Test
    @DisplayName("reading.script 원본: 한글 97 은 422 script_file_unreadable, 100,000자를 넘는 글은 422 script_too_long — 둘 다 글을 남기지 않는다")
    void unreadableAndTooLongFiles() throws Exception {
        String old = reserveAndPut("옛날.hwp", java.util.Arrays.copyOf("HWP Document File V3.00 \u001A".getBytes(StandardCharsets.ISO_8859_1), 64));
        assertThat(detail(post("/v2/reading/uploads/{id}/complete", old), 422)).isEqualTo("script_file_unreadable");
        String longOne = reserveAndPut("긴 대본.txt", "가".repeat(100_001).getBytes(StandardCharsets.UTF_8));
        assertThat(detail(post("/v2/reading/uploads/{id}/complete", longOne), 422)).isEqualTo("script_too_long");
        String exact = reserveAndPut("딱 맞는 대본.txt", "가".repeat(100_000).getBytes(StandardCharsets.UTF_8));
        assertThat(perform(post("/v2/reading/uploads/{id}/complete", exact), bearer).getStatus()).isEqualTo(204);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM script_uploads WHERE raw_text IS NOT NULL", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("reading.script 원본: 나누기 요청은 raw_text 와 upload_id 가운데 하나만 — 둘 다·둘 다 없음은 422 배열, 남의 upload_id 는 404 script_upload_not_found")
    void importTakesExactlyOneSource() throws Exception {
        String uploadId = readFile("갈매기.txt", SCENE);
        Map<String, Object> both = new LinkedHashMap<>();
        both.put("request_id", UUID.randomUUID().toString());
        both.put("raw_text", SCENE);
        both.put("upload_id", uploadId);
        both.put("source", "file");
        assertThat(json(post("/v2/reading/imports").content(mapper.writeValueAsString(both)), 422, bearer).path("detail").isArray()).isTrue();
        both.remove("raw_text");
        both.remove("upload_id");
        assertThat(json(post("/v2/reading/imports").content(mapper.writeValueAsString(both)), 422, bearer).path("detail").isArray()).isTrue();

        String stranger = bearerOf(member());
        var response = perform(post("/v2/reading/imports").content(fileImport(UUID.randomUUID(), uploadId)), stranger);
        assertThat(response.getStatus()).isEqualTo(404);
        assertThat(mapper.readTree(response.getContentAsString()).path("detail").textValue()).isEqualTo("script_upload_not_found");
        var foreignRead = perform(post("/v2/reading/uploads/{id}/complete", uploadId), stranger);
        assertThat(foreignRead.getStatus()).isEqualTo(404);
        assertThat(count("script_imports")).isZero();
    }

    @Test
    @DisplayName("reading.script 원본: 뽑은 글이 예시 대본이면 나누기 접수는 글 길과 같은 순서(원문 한도 → 예시 → 동의)라 동의를 거둔 뒤에도 "
            + "모델 없이 바로 succeeded 이고 원본이 그 대본에 연결된다. 올릴 자리는 원본 보관이라 동의가 계속 필요하다")
    void sampleFileSkipsTheSplitConsent() throws Exception {
        String uploadId = readFile("예시.txt", "\r\n" + SampleScript.TEXT.replace("\n", "\r\n") + "\r\n");
        jdbc.update("DELETE FROM user_consents WHERE user_id=? AND document_id=?", member, scriptSplitDocument);

        JsonNode ticket = json(post("/v2/reading/imports").content(fileImport(UUID.randomUUID(), uploadId)), 202, bearer);
        JsonNode done = json(get("/v2/reading/imports/{id}", ticket.path("import_id").textValue()), 200, bearer);
        assertThat(done.path("status").textValue()).isEqualTo("succeeded");
        assertThat(count("ai_jobs")).as("모델을 부르지 않는다").isZero();
        assertThat(json(get("/v2/reading/scripts/{id}", done.path("script_id").textValue()), 200, bearer).path("title").textValue())
                .isEqualTo(SampleScript.TITLE);
        assertThat(jdbc.queryForObject("SELECT script_id FROM script_uploads", String.class)).isEqualTo(done.path("script_id").textValue());

        assertThat(detail(post("/v2/reading/uploads").content(upload("예시.txt", 10)), 403)).isEqualTo("script_split_consent_required");
    }

    @Test
    @DisplayName("reading.script 원본: 뽑은 글이 내 대본과 같으면 200 duplicate_script_id 이고 원본은 연결되지 않는다")
    void duplicateFileText() throws Exception {
        String scriptId = split(readFile("첫 파일.txt", SCENE));
        JsonNode duplicate = json(post("/v2/reading/imports").content(fileImport(UUID.randomUUID(), readFile("다시.txt", "  " + SCENE))), 200, bearer);
        assertThat(duplicate.path("duplicate_script_id").textValue()).isEqualTo(scriptId);
        assertThat(jdbc.queryForList("SELECT script_id FROM script_uploads ORDER BY created_at", String.class)).containsExactly(scriptId, null);
    }

    @Test
    @DisplayName("reading.script 원본: 대본을 지우면 연결된 원본의 행이 없고 객체는 올리기 주소 시한이 지난 뒤 정리 장부가 지운다. 연결되지 않은 다른 원본은 남는다")
    void deletingTheScriptDeletesItsSource() throws Exception {
        String uploadId = readFile("갈매기.txt", SCENE);
        String scriptId = split(uploadId);
        String other = readFile("다른 대본.txt", "니나: 다른 글\n트레플레프: 응");
        assertThat(storage.objects).hasSize(2);

        assertThat(perform(delete("/v2/reading/scripts/{id}", scriptId), bearer).getStatus()).isEqualTo(204);

        assertThat(jdbc.queryForList("SELECT id FROM script_uploads", String.class)).containsExactly(other);
        assertThat(storage.objects).as("올리기 주소(15분)가 살아 있는 동안은 지우지 않는다 — 먼저 지우면 다시 올린 객체가 남는다")
                .containsKeys(key(uploadId), key(other));
        clock.set(NOW.plus(Duration.ofMinutes(16)));
        cleanup.runDue();
        assertThat(storage.objects).containsOnlyKeys(key(other));
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("account.withdraw·reading.script 원본: 탈퇴하면 연결된 원본과 안 된 원본의 행·객체가 모두 없다")
    void withdrawalDeletesEverySource() throws Exception {
        split(readFile("갈매기.txt", SCENE));
        readFile("다른 대본.txt", "니나: 다른 글\n트레플레프: 응");
        assertThat(storage.objects).hasSize(2);

        MockHttpServletResponse withdrawn = perform(delete("/v2/me"), bearer);

        assertThat(withdrawn.getStatus()).as(withdrawn.getContentAsString()).isEqualTo(200);
        assertThat(count("script_uploads")).isZero();
        assertThat(storage.objects).as("주소 시한 전").hasSize(2);
        clock.set(NOW.plus(Duration.ofMinutes(16)));
        cleanup.runDue();
        assertThat(storage.objects).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("reading.script 원본: 정리는 하루 지난 미연결 원본만 지운다 — 23시간 된 것, 대본에 연결된 것, 진행 중 나누기가 쓰는 것은 남는다")
    void sweepDeletesStaleUnlinkedSources() throws Exception {
        String linked = readFile("연결.txt", SCENE);
        split(linked);
        String inFlight = readFile("나누는 중.txt", "니나: 기다려\n트레플레프: 응");
        json(post("/v2/reading/imports").content(fileImport(UUID.randomUUID(), inFlight)), 202, bearer);
        String stale = readFile("버린 파일.txt", "니나: 버린 글\n트레플레프: 응");
        String neverUploaded = json(post("/v2/reading/uploads").content(upload("안 올린 파일.pdf", 10)), 201, bearer)
                .path("upload_id").textValue();
        clock.set(NOW.plus(Duration.ofHours(2)));
        String fresh = readFile("새 파일.txt", "니나: 새 글\n트레플레프: 응");

        clock.set(NOW.plus(Duration.ofHours(25)));
        assertThat(uploads.sweepUnlinked()).as("장부 한 줄(같은 사람의 키 둘)").isEqualTo(1);

        assertThat(jdbc.queryForList("SELECT id FROM script_uploads", String.class)).containsExactlyInAnyOrder(linked, inFlight, fresh);
        assertThat(storage.objects).doesNotContainKeys(key(stale), key(neverUploaded)).containsKeys(key(linked), key(inFlight), key(fresh));
        assertThat(count("account_cleanup_operations")).isZero();
        assertThat(uploads.sweepUnlinked()).as("다시 돌면 지울 것이 없다").isZero();
    }

    private String key(String uploadId) {
        return "reading-source/" + member + "/" + uploadId;
    }

    /** 올릴 자리를 받고, 기기가 올린 것처럼 넣고, 읽힌 upload_id. */
    private String readFile(String name, String text) throws Exception {
        String uploadId = reserveAndPut(name, text.getBytes(StandardCharsets.UTF_8));
        assertThat(perform(post("/v2/reading/uploads/{id}/complete", uploadId), bearer).getStatus()).isEqualTo(204);
        return uploadId;
    }

    private String reserveAndPut(String name, byte[] bytes) throws Exception {
        String uploadId = json(post("/v2/reading/uploads").content(upload(name, bytes.length)), 201, bearer).path("upload_id").textValue();
        storage.put(key(uploadId), bytes);
        return uploadId;
    }

    /** 원본으로 나누기를 접수하고 워커를 한 번 돌려 만든 대본 id. */
    private String split(String uploadId) throws Exception {
        String importId = json(post("/v2/reading/imports").content(fileImport(UUID.randomUUID(), uploadId)), 202, bearer)
                .path("import_id").textValue();
        assertThat(worker.runOnce(clock.instant())).isTrue();
        JsonNode done = json(get("/v2/reading/imports/{id}", importId), 200, bearer);
        assertThat(done.path("status").textValue()).as(done.toString()).isEqualTo("succeeded");
        return done.path("script_id").textValue();
    }

    private String upload(String fileName, long byteSize) throws Exception {
        return mapper.writeValueAsString(Map.of("file_name", fileName, "byte_size", byteSize));
    }

    private String fileImport(UUID requestId, String uploadId) throws Exception {
        return mapper.writeValueAsString(Map.of("request_id", requestId.toString(), "upload_id", uploadId, "source", "file"));
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)", UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    private String bearerOf(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String authorization) throws Exception {
        return mvc.perform(request.contentType(MediaType.APPLICATION_JSON).header("Authorization", authorization)).andReturn().getResponse();
    }

    private String detail(MockHttpServletRequestBuilder request, int status) throws Exception {
        return json(request, status, bearer).path("detail").textValue();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status, String authorization) throws Exception {
        var response = perform(request, authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }
}
