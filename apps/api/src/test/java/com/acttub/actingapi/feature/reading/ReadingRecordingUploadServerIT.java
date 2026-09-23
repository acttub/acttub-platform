package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.integration.media.AudioTranscoder;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 녹음 올리기를 <b>실제 서블릿 컨테이너</b>로 본다 (reading.recording). MockMvc 는 파트를 메모리에 미리 채워 컨테이너의
 * multipart 파싱을 타지 않는다 — 요청 본문을 미리 읽어 두는 {@code RequestBodyCachingFilter} 가 파트 파싱과 부딪히는지는
 * 여기서만 드러난다. 같은 서버에서 JSON 본문의 오류 되돌림({@code input})이 그대로인 것도 함께 본다.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "JWT_SECRET=test-secret",
            "ACCOUNT_CLEANUP_ENABLED=false",
            "ACCOUNT_HOUSEKEEPING_ENABLED=false",
            // 컨테이너 상한을 낮춰 413 도 같은 서버에서 본다(운영 값은 application.yml).
            "spring.servlet.multipart.max-file-size=1MB",
            "spring.servlet.multipart.max-request-size=2MB"
        })
@Import(ReadingRecordingUploadServerIT.Fixture.class)
class ReadingRecordingUploadServerIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_recording_server");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @LocalServerPort
    int port;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    JwtService jwt;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    FakeStorage storage;

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private UUID member;
    private String bearer;
    private UUID session;
    private UUID line;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        jdbc.update("INSERT INTO consent_documents(id,type,version,title,body,required,published_at) VALUES (?,'terms','v1','약관','본문',true,now())",
                UUID.randomUUID());
        storage.objects.clear();
        member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        AccountFixtures.passGate(jdbc, member);
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
        UUID script = UUID.randomUUID();
        UUID nina = UUID.randomUUID();
        line = UUID.randomUUID();
        session = UUID.randomUUID();
        jdbc.update("INSERT INTO scripts(id,user_id,title,raw_text,source,request_id,request_fingerprint) VALUES (?,?,'갈매기','원문','paste',?,?)",
                script, member, UUID.randomUUID(), "a".repeat(64));
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'니나',0)", nina, script);
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (?,?,1,'dialogue',?,'안녕')", line, script, nina);
        jdbc.update("""
                INSERT INTO reading_sessions(id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,advance,record,
                                             status,current_line_id)
                VALUES (?,?,?,?,CAST(? AS uuid[]),'read',?,?,'manual',true,'in_progress',?)
                """, session, script, member, UUID.randomUUID(), "{" + nina + "}", line, line, line);
    }

    @Test
    @DisplayName("reading.recording: 실제 컨테이너를 거친 multipart 올리기 — 파트가 그대로 닿아 201 이고 행·객체가 있다. 상한을 넘는 파일은 413 upload_too_large. 같은 서버의 JSON 오류는 여전히 보낸 값을 되돌려 준다")
    void multipartReachesTheHandlerThroughTheRealContainer() throws Exception {
        UUID requestId = UUID.randomUUID();
        HttpResponse<String> uploaded = http.send(multipart(requestId, "m4a-bytes".getBytes(StandardCharsets.UTF_8)),
                HttpResponse.BodyHandlers.ofString());

        assertThat(uploaded.statusCode()).as(uploaded.body()).isEqualTo(201);
        JsonNode body = mapper.readTree(uploaded.body());
        assertThat(body.path("line_id").textValue()).isEqualTo(line.toString());
        assertThat(body.path("byte_size").longValue()).isEqualTo(9);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_recordings", Integer.class)).isEqualTo(1);
        assertThat(storage.objects).containsKey("reading/" + member + "/" + session + "/" + line + "/" + requestId + ".m4a");

        HttpResponse<String> tooLarge = http.send(multipart(UUID.randomUUID(), new byte[1_500_000]), HttpResponse.BodyHandlers.ofString());
        assertThat(tooLarge.statusCode()).as(tooLarge.body()).isEqualTo(413);
        assertThat(mapper.readTree(tooLarge.body())).isEqualTo(mapper.readTree("{\"detail\":\"upload_too_large\"}"));

        HttpResponse<String> malformed = http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v2/reading/scripts"))
                .header("Authorization", bearer)
                .header("X-Acttub-Client", "web/1.0.0")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"title\":123}"))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(malformed.statusCode()).isEqualTo(422);
        JsonNode errors = mapper.readTree(malformed.body()).path("detail");
        assertThat(errors.isArray()).isTrue();
        assertThat(errors.toString()).as("JSON 본문은 여전히 캐시돼 input 으로 되돌아온다").contains("\"input\":123");
    }

    private HttpRequest multipart(UUID requestId, byte[] audio) throws IOException {
        String boundary = "acttub-" + UUID.randomUUID();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        for (Map.Entry<String, String> field : Map.of(
                "request_id", requestId.toString(),
                "line_id", line.toString(),
                "attempt_no", "1",
                "duration_ms", "1500",
                "transcript_source", "none").entrySet()) {
            body.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + field.getKey() + "\"\r\n\r\n"
                    + field.getValue() + "\r\n").getBytes(StandardCharsets.UTF_8));
        }
        body.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"line.m4a\"\r\n"
                + "Content-Type: audio/mp4\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        body.write(audio);
        body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        return HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v2/reading/sessions/" + session + "/recordings"))
                .header("Authorization", bearer)
                .header("X-Acttub-Client", "web/1.0.0")
                .header("X-Request-Id", requestId.toString())
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
                .build();
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Fixture {
        @Bean
        @Primary
        FakeStorage fakeStorage() {
            return new FakeStorage();
        }

        /** ffmpeg 없이 — 이 테스트는 m4a 만 올린다. 혹시 변환이 불리면 실패로 드러난다. */
        @Bean
        @Primary
        AudioTranscoder fakeAudioTranscoder() {
            return new AudioTranscoder((command, timeout) -> {
                throw new IOException("ffmpeg must not be called for audio/mp4");
            });
        }
    }

    static final class FakeStorage implements ObjectStorage {
        final Map<String, Long> objects = new ConcurrentHashMap<>();

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
        public void upload(String objectKey, String mimeType, Path source) {
            try {
                objects.put(objectKey, Files.size(source));
            } catch (IOException failure) {
                throw new java.io.UncheckedIOException(failure);
            }
        }

        @Override
        public void delete(String objectKey) {
            objects.remove(objectKey);
        }
    }
}
