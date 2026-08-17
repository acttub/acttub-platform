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
import java.util.concurrent.atomic.AtomicLong;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
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
 * Google GenAI <b>Java</b> SDK 능력 확인 (/SPEC.md §10, M0-spike.md C).
 *
 * <p>M4 전체가 이 결과 위에 선다. 검증 대상은 셋이다.
 * <ol>
 *   <li>Files API 업로드 ({@code client.files.upload})</li>
 *   <li>{@code PROCESSING} → {@code ACTIVE} 폴링과 타임아웃 경로</li>
 *   <li>{@code responseSchema} 구조화 출력 — 특히 <b>한글 enum</b>({@code 반전/약화/국소})</li>
 * </ol>
 *
 * <p>실호출이라 {@code GEMINI_API_KEY} 가 있을 때만 돈다.
 * 영상은 저장소에 커밋하지 않고 {@code ./gradlew prepareSpikeVideo} 로 만든다
 * (Docker 의 ffmpeg 이미지를 쓴다 — 로컬에 ffmpeg 이 없어도 된다).
 *
 * <p>여기서 쓰는 프롬프트는 원본을 옮긴 것이 아니다. 목적은 SDK 능력 확인이지
 * 파이프라인 이식이 아니다 (M0-spike.md "하지 말 것" 5).
 */
class GeminiSdkSpikeTest {

    private static final String MODEL = System.getenv().getOrDefault("GEMINI_MODEL", "gemini-2.5-flash");
    private static final Path VIDEO = Paths.get(
            System.getenv().getOrDefault("M0_SPIKE_VIDEO", "build/spike/sample.mp4"));

    private static final String PROMPT = """
            첨부한 영상을 연기 연습 영상이라고 보고 분석해라.
            상황: 연습실에서 혼자 대사를 반복한다
            인물설정: 오디션을 앞둔 지원자
            서브텍스트: 겉으로는 담담한 척하지만 속으로는 조급하다

            응답은 주어진 JSON 스키마를 정확히 지킨다.
            anomalies 는 최소 2건을 채운다.
            intent_impact 는 반드시 반전/약화/국소 중 하나다.
            """;

    /** 스키마 밖 키가 하나라도 오면 깨지도록 엄격하게 읽는다 — 그래야 "스키마 준수"를 주장할 수 있다. */
    private static final ObjectMapper STRICT = new ObjectMapper()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    // ---- 2번(폴링)의 타임아웃 분기: 네트워크 없이 검증한다 ----

    @Test
    @DisplayName("PROCESSING 이 계속되면 타임아웃 예외를 던진다")
    void pollingTimesOut() {
        AtomicLong clock = new AtomicLong(0);

        assertThatThrownBy(() -> FileActivationPoller.waitUntilActive(
                "PROCESSING",
                () -> "PROCESSING",
                Duration.ofSeconds(5),
                Duration.ofSeconds(2),
                clock::get,
                duration -> clock.addAndGet(duration.toNanos())))
                .isInstanceOf(FileActivationPoller.FileActiveTimeoutException.class)
                .hasMessageContaining("not ACTIVE within 5s");
    }

    @Test
    @DisplayName("PROCESSING 이 아닌 비정상 상태(FAILED)도 타임아웃 예외로 수렴한다")
    void pollingRejectsFailedState() {
        AtomicLong clock = new AtomicLong(0);

        assertThatThrownBy(() -> FileActivationPoller.waitUntilActive(
                "PROCESSING",
                () -> "FAILED",
                Duration.ofSeconds(60),
                Duration.ofSeconds(1),
                clock::get,
                duration -> clock.addAndGet(duration.toNanos())))
                .isInstanceOf(FileActivationPoller.FileActiveTimeoutException.class)
                .hasMessageContaining("state=FAILED");
    }

    // ---- 실호출 ----

    @Test
    @EnabledIfEnvironmentVariable(named = "GEMINI_API_KEY", matches = ".+")
    @DisplayName("업로드 → 폴링 → responseSchema 구조화 출력이 전부 SDK 로 된다")
    void uploadPollAndStructuredOutput() throws Exception {
        assertThat(Files.exists(VIDEO))
                .as("샘플 영상이 없다. `./gradlew prepareSpikeVideo` 를 먼저 돌린다. 찾은 경로: "
                        + VIDEO.toAbsolutePath())
                .isTrue();

        try (Client client = Client.builder()
                .apiKey(System.getenv("GEMINI_API_KEY"))
                .build()) {

            // 1. Files API 업로드
            File uploaded = client.files.upload(VIDEO.toString(),
                    UploadFileConfig.builder().mimeType("video/mp4").build());

            assertThat(uploaded.name()).isPresent();
            assertThat(uploaded.uri()).isPresent();
            String name = uploaded.name().orElseThrow();
            System.out.println("[M0-spike] uploaded=" + name
                    + " state=" + uploaded.state().map(Object::toString).orElse("<none>")
                    + " sizeBytes=" + uploaded.sizeBytes().orElse(-1L));

            try {
                // 2. PROCESSING → ACTIVE 폴링
                String initialState = uploaded.state().map(Object::toString).orElse("PROCESSING");
                java.util.concurrent.atomic.AtomicReference<File> latest =
                        new java.util.concurrent.atomic.AtomicReference<>(uploaded);

                String finalState = FileActivationPoller.waitUntilActive(
                        initialState,
                        () -> {
                            File refreshed = client.files.get(name, GetFileConfig.builder().build());
                            latest.set(refreshed);
                            return refreshed.state().map(Object::toString).orElse("UNKNOWN");
                        },
                        Duration.ofSeconds(300),
                        Duration.ofSeconds(2),
                        System::nanoTime,
                        FileActivationPoller.Sleeper.real());

                assertThat(finalState).isEqualTo("ACTIVE");
                File active = latest.get();
                assertThat(active.uri()).isPresent();
                assertThat(active.mimeType()).isPresent();
                System.out.println("[M0-spike] ACTIVE uri=" + active.uri().orElseThrow());

                // 3. responseSchema 구조화 출력
                GenerateContentConfig config = GenerateContentConfig.builder()
                        .responseMimeType("application/json")
                        .responseSchema(Schema.fromJson(readSceneSummarySchema()))
                        .temperature(0.0f)
                        .topP(0.1f)
                        .topK(1.0f)
                        .seed(42)
                        // 영상 토큰을 초당 ~300→~100 으로 줄이는 옵션. Python 쪽과 같은 값이 SDK 에 있다.
                        .mediaResolution(MediaResolution.Known.MEDIA_RESOLUTION_LOW)
                        .build();

                GenerateContentResponse response = client.models.generateContent(
                        MODEL,
                        Content.fromParts(
                                Part.fromUri(active.uri().orElseThrow(),
                                        active.mimeType().orElse("video/mp4")),
                                Part.fromText(PROMPT)),
                        config);

                String text = response.text();
                assertThat(text).isNotBlank();
                System.out.println("[M0-spike] response head=" + text.substring(0, Math.min(300, text.length())));

                SceneSummaryDto summary = STRICT.readValue(text, SceneSummaryDto.class);

                assertThat(summary.observation()).isNotNull();
                assertThat(summary.observation().timeline()).isNotBlank();
                assertThat(summary.observation().tempo()).isNotBlank();
                assertThat(summary.observation().extra()).isNotNull();
                assertThat(summary.summary()).isNotBlank();
                assertThat(summary.intentAlignment()).isNotBlank();
                assertThat(summary.keyMoment()).isNotBlank();
                assertThat(summary.keyDimension()).isNotBlank();
                assertThat(summary.anomalies()).isNotEmpty();

                for (SceneSummaryDto.Anomaly anomaly : summary.anomalies()) {
                    assertThat(anomaly.start()).isNotBlank();
                    assertThat(anomaly.end()).isNotBlank();
                    assertThat(anomaly.dimension()).isNotBlank();
                    assertThat(anomaly.overlapsKeyMoment()).isNotNull();
                    assertThat(anomaly.onKeyDimension()).isNotNull();
                    // 한글 enum 이 스키마대로 강제되는가 — SDK 채택 여부의 핵심 관문.
                    assertThat(anomaly.intentImpact()).isIn("반전", "약화", "국소");
                    assertThat(anomaly.severity()).isIn("high", "mid", "low");
                    assertThat(anomaly.severityReason()).isNotBlank();
                }
                System.out.println("[M0-spike] anomalies=" + summary.anomalies().size()
                        + " intent_impact=" + summary.anomalies().stream()
                        .map(SceneSummaryDto.Anomaly::intentImpact).toList());
            } finally {
                try {
                    client.files.delete(name, null);
                } catch (RuntimeException ignored) {
                    // 원본도 정리 실패는 무시한다 (summarizer.py finally).
                }
            }
        }
    }

    static String readSceneSummarySchema() throws Exception {
        try (InputStream in = GeminiSdkSpikeTest.class
                .getResourceAsStream("/scene-summary.schema.json")) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    static List<String> requiredTopLevelFields() {
        return List.of("observation", "summary", "intent_alignment", "key_moment", "key_dimension",
                "anomalies");
    }
}
