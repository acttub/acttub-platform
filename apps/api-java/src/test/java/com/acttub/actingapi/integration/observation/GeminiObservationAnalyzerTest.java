package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.MediaResolution;
import com.google.genai.types.Part;
import org.junit.jupiter.api.Test;

class GeminiObservationAnalyzerTest {

    private static final String MODEL = "gemini-2.5-flash";
    private static final ActorMaterial ACTOR = new ActorMaterial(
            "연습실",
            "햄릿",
            "진실을 묻는다",
            "분석",
            "대사가 붕 뜬다",
            12_000);

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void generationRequestMatchesActingSummaryGolden() throws Exception {
        StubGateway gateway = new StubGateway();
        gateway.responses.add("{\"observations\":[],\"uncertainties\":[]}");
        ObservationAnalyzer analyzer = new GeminiObservationAnalyzer(gateway, mapper, MODEL);

        ObservationPack result = analyzer.analyze(
                Path.of("/tmp/take.video"), "video/quicktime", ACTOR);

        assertThat(result.observations()).isEmpty();
        assertThat(result.uncertainties()).isEmpty();
        assertThat(gateway.uploadedPath).isEqualTo(Path.of("/tmp/take.video"));
        assertThat(gateway.uploadedMimeType).isEqualTo("video/quicktime");
        assertThat(gateway.model).isEqualTo(MODEL);

        GenerateContentConfig config = gateway.config;
        assertThat(config.temperature()).contains(0.0f);
        assertThat(config.topP()).contains(0.1f);
        assertThat(config.topK()).contains(1.0f);
        assertThat(config.seed()).contains(42);
        assertThat(config.mediaResolution())
                .contains(new MediaResolution(MediaResolution.Known.MEDIA_RESOLUTION_LOW));
        assertThat(config.responseMimeType()).contains("application/json");
        assertThat(sha256(config.systemInstruction().orElseThrow().text()))
                .isEqualTo("b73330b8c3d7e3f37e1786d893837771e84de9b1adf54558bd18dd1d25ac2c95");
        assertThat(mapper.readTree(config.responseSchema().orElseThrow().toJson()))
                .isEqualTo(observationSchema());

        List<Part> parts = gateway.contents.parts().orElseThrow();
        assertThat(parts).hasSize(2);
        assertThat(parts.get(0).fileData().orElseThrow().fileUri())
                .contains("https://files.test/take");
        assertThat(parts.get(0).fileData().orElseThrow().mimeType())
                .contains("video/quicktime");
        assertThat(parts.get(1).text()).contains(ObservationPrompt.build(ACTOR));
        assertThat(sha256(parts.get(1).text().orElseThrow()))
                .isEqualTo("57dfba033b9a3caa1b7bb6db09ec040015eee63c226028025d007472cfd45006");
        assertThat(gateway.deletedNames).containsExactly("files/take");
    }

    @Test
    void observationFilteringKeepsBoundaryValuesAndOnlyTheFirstThreeValidItems() {
        StubGateway gateway = new StubGateway();
        gateway.responses.add("""
                {
                  "observations": [
                    {"start_ms":0,"end_ms":1,"label":"start-zero","confidence":0.1},
                    {"start_ms":1,"end_ms":12000,"label":"end-duration","confidence":0.2},
                    {"start_ms":5,"end_ms":5,"label":"equal","confidence":0.5},
                    {"start_ms":-1,"end_ms":2,"label":"negative","confidence":0.6},
                    {"start_ms":11999,"end_ms":12001,"label":"too-late","confidence":0.7},
                    {"start_ms":2,"end_ms":3,"label":"third","confidence":0.3},
                    {"start_ms":3,"end_ms":4,"label":"fourth","confidence":0.4}
                  ],
                  "uncertainties": ["얼굴이 화면 밖"]
                }
                """);

        ObservationPack result = analyzer(gateway).analyze(
                Path.of("/tmp/take.mp4"), "video/mp4", ACTOR);

        assertThat(result.observations())
                .extracting(ObservationItem::label)
                .containsExactly("start-zero", "end-duration", "third");
        assertThat(result.uncertainties()).containsExactly("얼굴이 화면 밖");
    }

    @Test
    void parsingRetriesOnceAndThenReturnsTheSecondResponse() {
        StubGateway gateway = new StubGateway();
        gateway.responses.add("not-json");
        gateway.responses.add("""
                {"observations":[{"start_ms":0,"end_ms":1,"label":"두 번째","confidence":1.0}],
                 "uncertainties":[]}
                """);

        ObservationPack result = analyzer(gateway).analyze(
                Path.of("/tmp/take.mp4"), "video/mp4", ACTOR);

        assertThat(result.observations()).extracting(ObservationItem::label)
                .containsExactly("두 번째");
        assertThat(gateway.generateCalls).isEqualTo(2);
    }

    @Test
    void twoParseFailuresRaiseSummaryParseErrorWithoutAThirdGeneration() {
        StubGateway gateway = new StubGateway();
        gateway.responses.add("first-invalid");
        gateway.responses.add("second-invalid");
        gateway.responses.add("{\"observations\":[],\"uncertainties\":[]}");

        assertThatThrownBy(() -> analyzer(gateway).analyze(
                Path.of("/tmp/take.mp4"), "video/mp4", ACTOR))
                .isInstanceOf(SummaryParseError.class)
                .hasMessageStartingWith("failed to parse after retry: ");

        assertThat(gateway.generateCalls).isEqualTo(2);
        assertThat(gateway.responses).hasSize(1);
    }

    @Test
    void fileDeleteFailureDoesNotReplaceASuccessfulAnalysis() {
        StubGateway gateway = new StubGateway();
        gateway.responses.add("{\"observations\":[],\"uncertainties\":[]}");
        gateway.deleteFailure = new IllegalStateException("already deleted");

        ObservationPack result = analyzer(gateway).analyze(
                Path.of("/tmp/take.mp4"), "video/mp4", ACTOR);

        assertThat(result).isEqualTo(new ObservationPack(List.of(), List.of()));
        assertThat(gateway.deletedNames).containsExactly("files/take");
    }

    @Test
    void processingFileUsesTheThreeHundredSecondTimeoutAndTwoSecondPollInterval() {
        AtomicLong clock = new AtomicLong();

        assertThatThrownBy(() -> FileActivationPoller.waitUntilActive(
                new GeminiFile("files/take", "uri", "video/mp4", "PROCESSING"),
                name -> new GeminiFile(name, "uri", "video/mp4", "PROCESSING"),
                GeminiObservationAnalyzer.ACTIVE_TIMEOUT,
                GeminiObservationAnalyzer.POLL_INTERVAL,
                clock::get,
                duration -> clock.addAndGet(duration.toNanos())))
                .isInstanceOf(FileActiveTimeout.class)
                .hasMessage("file files/take not ACTIVE within 300s");

        assertThat(clock).hasValue(Duration.ofSeconds(300).toNanos());
    }

    @Test
    void processingUploadIsPolledAndTheActiveFileComesBeforeThePrompt() {
        StubGateway gateway = new StubGateway();
        gateway.uploadedFile = new GeminiFile(
                "files/take", "https://files.test/processing", "video/mp4", "PROCESSING");
        gateway.polledFiles.add(new GeminiFile(
                "files/take", "https://files.test/active", "video/mp4", "ACTIVE"));
        gateway.responses.add("{\"observations\":[],\"uncertainties\":[]}");
        ObservationAnalyzer analyzer = new GeminiObservationAnalyzer(
                gateway,
                mapper,
                MODEL,
                Duration.ofSeconds(300),
                Duration.ofSeconds(2),
                () -> 0L,
                duration -> { });

        analyzer.analyze(Path.of("/tmp/take.mp4"), "video/mp4", ACTOR);

        assertThat(gateway.getCalls).isEqualTo(1);
        assertThat(gateway.contents.parts().orElseThrow().getFirst()
                .fileData().orElseThrow().fileUri())
                .contains("https://files.test/active");
    }

    private ObservationAnalyzer analyzer(StubGateway gateway) {
        return new GeminiObservationAnalyzer(gateway, mapper, MODEL);
    }

    private JsonNode observationSchema() throws Exception {
        try (InputStream input = getClass().getResourceAsStream(
                "/observation-pack.schema.json")) {
            return mapper.readTree(input);
        }
    }

    private static String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256")
                        .digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    private static final class StubGateway implements GeminiGateway {
        private final ArrayDeque<String> responses = new ArrayDeque<>();
        private final ArrayDeque<GeminiFile> polledFiles = new ArrayDeque<>();
        private final java.util.ArrayList<String> deletedNames = new java.util.ArrayList<>();
        private GeminiFile uploadedFile = new GeminiFile(
                "files/take", "https://files.test/take", "video/quicktime", "ACTIVE");
        private Path uploadedPath;
        private String uploadedMimeType;
        private String model;
        private Content contents;
        private GenerateContentConfig config;
        private int generateCalls;
        private RuntimeException deleteFailure;
        private int getCalls;

        @Override
        public GeminiFile upload(Path path, String mimeType) {
            uploadedPath = path;
            uploadedMimeType = mimeType;
            return new GeminiFile(
                    uploadedFile.name(), uploadedFile.uri(), mimeType, uploadedFile.state());
        }

        @Override
        public GeminiFile get(String name) {
            getCalls++;
            return polledFiles.removeFirst();
        }

        @Override
        public String generate(
                String requestedModel,
                Content requestedContents,
                GenerateContentConfig requestedConfig) {
            model = requestedModel;
            contents = requestedContents;
            config = requestedConfig;
            generateCalls++;
            return responses.removeFirst();
        }

        @Override
        public void delete(String name) {
            deletedNames.add(name);
            if (deleteFailure != null) {
                throw deleteFailure;
            }
        }
    }
}
