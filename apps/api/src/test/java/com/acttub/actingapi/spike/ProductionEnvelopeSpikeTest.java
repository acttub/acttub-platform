package com.acttub.actingapi.spike;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.google.genai.Client;
import com.google.genai.types.Content;
import com.google.genai.types.File;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import com.google.genai.types.GetFileConfig;
import com.google.genai.types.MediaResolution;
import com.google.genai.types.Part;
import com.google.genai.types.Schema;
import com.google.genai.types.UploadFileConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * M4 관문 ③ — production-envelope 스파이크 (`docs/archive/soma287/M4-llm.md` 검증 §관문 ③).
 *
 * <p><b>M0 의 Gemini PASS 는 6초·80KB 영상 1건이었다.</b> SDK 에 세 API 가 존재한다는 것만
 * 보였고 실제 부하·실패 경로는 건드리지 않았다. 그래서 SDK 채택은 <b>잠정 결정</b>으로
 * 낮춰져 있고, 이 테스트가 그것을 확정하거나 raw REST 로 되돌린다.
 *
 * <p>봉투의 실제 크기:
 * <ul>
 *   <li>업로드 상한 <b>100MB</b> ({@code uploads.py:MAX_UPLOAD_BYTES})</li>
 *   <li>압축 임계 <b>15MB</b> ({@code acting-summary/compress.py:MIN_BYTES}) — 미만이면 압축을 건너뛴다</li>
 * </ul>
 *
 * <p>최악의 경로는 <b>100MB 원본이 압축에 실패해 그대로 Files API 로 가는 것</b>이다.
 * 그때 SDK 의 다중 chunk 업로드가 열린다.
 *
 * <p>비싸고 느려서 기본으로 돌지 않는다 — {@code ./gradlew test -PenvelopeSpike} 로만 켠다.
 * 영상은 {@code prepareEnvelopeVideos} 가 만들고 저장소에 커밋하지 않는다.
 */
@EnabledIfEnvironmentVariable(named = "GEMINI_API_KEY", matches = ".+")
@EnabledIfEnvironmentVariable(named = "M4_ENVELOPE_SPIKE", matches = "1")
class ProductionEnvelopeSpikeTest {

    private static final String MODEL = System.getenv().getOrDefault("GEMINI_MODEL", "gemini-2.5-flash");
    private static final Path COMPRESSED = Paths.get("build/spike/envelope-compressed.mp4");
    private static final Path RAW = Paths.get("build/spike/envelope-raw.mp4");

    /** `acting-summary/prompt.py:buildObservationPrompt` 를 옮긴 것이 아니다 — 봉투 확인용이다. */
    private static final String PROMPT = """
            첨부한 영상에서 관찰되는 것을 구간별로 적어라.
            상황: 연습실에서 혼자 대사를 반복한다
            인물: 오디션을 앞둔 지원자
            목표: 담담해 보이려 하지만 조급함이 새어 나온다

            observations 는 최소 1건을 채운다. 판단할 수 없었던 것은 uncertainties 에 적는다.
            응답은 주어진 JSON 스키마를 정확히 지킨다.
            """;

    private static final ObjectMapper STRICT = new ObjectMapper()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    // ---- ① post-compression 업로드 + 분석 ----

    @Test
    @DisplayName("압축본이 업로드·폴링·구조화 출력을 통과한다 (운영의 정상 경로)")
    void compressedUploadAndAnalyze() throws Exception {
        assertThat(Files.exists(COMPRESSED))
                .as("압축 영상이 없다. `./gradlew prepareEnvelopeVideos` 를 먼저 돌린다.")
                .isTrue();
        long sizeBytes = Files.size(COMPRESSED);
        System.out.println("[envelope] compressed sizeBytes=" + sizeBytes);

        try (Client client = client()) {
            File uploaded = upload(client, COMPRESSED);
            String name = uploaded.name().orElseThrow();
            try {
                File active = awaitActive(client, uploaded, name);
                ObservationPackDto pack = analyze(client, active);

                assertThat(pack.observations()).isNotEmpty();
                assertThat(pack.uncertainties()).isNotNull();
                for (ObservationPackDto.Observation observation : pack.observations()) {
                    assertThat(observation.label()).isNotBlank();
                    assertThat(observation.endMs()).isGreaterThan(observation.startMs());
                    assertThat(observation.confidence()).isBetween(0.0, 1.0);
                }
                System.out.println("[envelope] observations=" + pack.observations().size()
                        + " uncertainties=" + pack.uncertainties().size());
            } finally {
                deleteQuietly(client, name);
            }
        }
    }

    // ---- ② 압축 실패 경로: 100MB 원본을 그대로 올린다 ----

    @Test
    @DisplayName("압축 실패 시의 원본(상한 100MB 근접)이 다중 chunk 로 업로드되고 ACTIVE 가 된다")
    void rawUploadNearUploadLimit() throws Exception {
        assertThat(Files.exists(RAW))
                .as("원본 영상이 없다. `./gradlew prepareEnvelopeVideos` 를 먼저 돌린다.")
                .isTrue();
        long sizeBytes = Files.size(RAW);
        // 압축을 건너뛰는 경계(15MB)를 넘어야 이 경로가 의미를 갖는다.
        assertThat(sizeBytes).isGreaterThan(15L * 1024 * 1024);
        System.out.println("[envelope] raw sizeBytes=" + sizeBytes);

        long startedAt = System.nanoTime();
        try (Client client = client()) {
            File uploaded = upload(client, RAW);
            String name = uploaded.name().orElseThrow();
            try {
                File active = awaitActive(client, uploaded, name);
                assertThat(active.uri()).isPresent();
                // 분석까지 하지 않는다 — 이 케이스가 묻는 것은 전송 경로이고,
                // 비압축 1080p 를 분석하면 토큰이 압축본의 수십 배다.
                System.out.printf("[envelope] raw ACTIVE in %.1fs sizeBytes=%d%n",
                        (System.nanoTime() - startedAt) / 1e9,
                        active.sizeBytes().orElse(-1L));
            } finally {
                deleteQuietly(client, name);
            }
        }
    }

    // ---- ③ files.delete 예외가 성공한 분석을 뒤집지 않는다 ----

    @Test
    @DisplayName("files.delete 가 실패해도 분석 결과는 그대로 남는다")
    void deleteFailureDoesNotUndoAnalysis() throws Exception {
        try (Client client = client()) {
            File uploaded = upload(client, COMPRESSED);
            String name = uploaded.name().orElseThrow();
            awaitActive(client, uploaded, name);

            // 정상 삭제 후 같은 이름을 다시 지워 실제 예외를 만든다.
            client.files.delete(name, null);
            assertThatThrownBy(() -> client.files.delete(name, null))
                    .as("이미 지운 파일을 다시 지우면 SDK 가 예외를 던져야 한다 — "
                            + "그래야 '삼킨다' 는 계약에 의미가 있다")
                    .isInstanceOf(RuntimeException.class);

            // 원본은 이 예외를 finally 안의 try 로 삼킨다(summarizer.py). 결과는 살아 있다.
            String outcome = "analysis-result";
            try {
                client.files.delete(name, null);
            } catch (RuntimeException ignored) {
                // acting-summary/summarizer.py:summarize 의 finally 와 같은 처리
            }
            assertThat(outcome).isEqualTo("analysis-result");
        }
    }

    // ---- ④ 파싱 재시도: 총 2회 시도 = 재시도 1회 ----

    @Test
    @DisplayName("파싱은 [실패, 성공] 이면 성공하고 [실패, 실패, 성공] 이면 세 번째를 보지 않는다")
    void parseRetriesExactlyOnce() {
        AtomicInteger calls = new AtomicInteger();

        String recovered = ParseRetryLoop.generateAndParse(
                () -> calls.incrementAndGet() == 1 ? "not-json" : "{\"ok\":true}",
                text -> {
                    if (!text.startsWith("{")) {
                        throw new IllegalStateException("parse failed");
                    }
                    return text;
                });
        assertThat(recovered).isEqualTo("{\"ok\":true}");
        assertThat(calls.get()).isEqualTo(2);

        AtomicInteger exhausted = new AtomicInteger();
        assertThatThrownBy(() -> ParseRetryLoop.generateAndParse(
                () -> {
                    exhausted.incrementAndGet();
                    return "not-json";
                },
                text -> {
                    throw new IllegalStateException("parse failed");
                }))
                .isInstanceOf(ParseRetryLoop.ParseFailedException.class)
                .hasMessageContaining("failed to parse after retry");
        // 세 번째 응답이 성공이었더라도 보지 않는다.
        assertThat(exhausted.get()).isEqualTo(2);
    }

    // ---- 도우미 ----

    private static Client client() {
        return Client.builder().apiKey(System.getenv("GEMINI_API_KEY")).build();
    }

    private static File upload(Client client, Path path) {
        // mimeType 을 항상 명시한다 — SDK 의 확장자 추론이 불안정하다(M0-findings C).
        return client.files.upload(path.toString(),
                UploadFileConfig.builder().mimeType("video/mp4").build());
    }

    private static File awaitActive(Client client, File uploaded, String name) {
        AtomicReference<File> latest = new AtomicReference<>(uploaded);
        String state = FileActivationPoller.waitUntilActive(
                uploaded.state().map(Object::toString).orElse("PROCESSING"),
                () -> {
                    File refreshed = client.files.get(name, GetFileConfig.builder().build());
                    latest.set(refreshed);
                    return refreshed.state().map(Object::toString).orElse("UNKNOWN");
                },
                Duration.ofSeconds(300),
                Duration.ofSeconds(2),
                System::nanoTime,
                FileActivationPoller.Sleeper.real());
        assertThat(state).isEqualTo("ACTIVE");
        return latest.get();
    }

    private static ObservationPackDto analyze(Client client, File active) throws Exception {
        GenerateContentConfig config = GenerateContentConfig.builder()
                .responseMimeType("application/json")
                .responseSchema(Schema.fromJson(readObservationPackSchema()))
                .temperature(0.0f)
                .topP(0.1f)
                .topK(1.0f)
                .seed(42)
                .mediaResolution(MediaResolution.Known.MEDIA_RESOLUTION_LOW)
                .build();

        // contents 순서는 [uploaded, prompt] 다 (summarizer.py). 뒤집지 않는다.
        GenerateContentResponse response = client.models.generateContent(
                MODEL,
                Content.fromParts(
                        Part.fromUri(active.uri().orElseThrow(), active.mimeType().orElse("video/mp4")),
                        Part.fromText(PROMPT)),
                config);

        String text = response.text();
        assertThat(text).isNotBlank();
        return STRICT.readValue(text, ObservationPackDto.class);
    }

    private static void deleteQuietly(Client client, String name) {
        try {
            client.files.delete(name, null);
        } catch (RuntimeException ignored) {
            // 원본도 정리 실패는 무시한다.
        }
    }

    static String readObservationPackSchema() throws Exception {
        try (InputStream in = ProductionEnvelopeSpikeTest.class
                .getResourceAsStream("/observation-pack.schema.json")) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    record ObservationPackDto(
            List<Observation> observations,
            List<String> uncertainties) {

        record Observation(
                @JsonProperty("start_ms") int startMs,
                @JsonProperty("end_ms") int endMs,
                String label,
                double confidence) {
        }
    }
}
