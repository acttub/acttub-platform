package com.acttub.actingapi.integration.observation;

import java.time.Duration;
import java.time.Instant;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import com.google.genai.types.HttpOptions;
import com.google.genai.types.Part;
import com.google.genai.types.ThinkingConfig;

/**
 * 1층 관찰(SOMA-815): 받아쓰기로 대사 덩어리와 시간을 정하고, 관찰 모델(기본 Gemini 4 Argon)이 그 덩어리마다 본 것을 적는다.
 *
 * <p>2026-10-22~23 오프라인 실험(코칭 시험 세트 영상 14개, 블라인드 프레임 판정): 코치가 말한 배우 행동 중 맞은 비율이
 * 지금 코치 35%, 받아쓰기+Argon 60~67%, Argon만 23%, 받아쓰기만 약 29%였다. Argon 혼자 대사를 나누면 근처 다른 순간의
 * 동작을 엉뚱한 대사에 붙였다. 그래서 대사 덩어리와 시간은 받아쓰기가 정하고, Argon 은 그 구간만 본다.
 */
public final class GeminiLayerOneObserver implements LayerOneObserver {
    static final String DEFAULT_MODEL = "gemini-4-argon";
    /** 이 간격보다 오래 쉬면 덩어리를 나눈다. */
    static final double CHUNK_GAP = 0.5;
    /** 이보다 짧은 덩어리는 앞 덩어리에 붙인다. */
    static final double MIN_CHUNK = 0.6;
    /** 코치 지시문이 너무 길어지지 않게 덩어리 수를 자른다. */
    static final int MAX_CHUNKS = 40;

    static final String PROMPT = """
            너는 연기 영상의 관찰자다. 코치가 아니다. 판정·칭찬·조언을 쓰지 않는다.
            아래는 서버가 받아쓴 대사 덩어리와 시각이다. 영상을 직접 보고 덩어리마다 JSON으로 적는다.
            - seen: 그 시간에 실제로 보이고 들리는 것(몸·손·시선·표정·소리·상대와 주고받기). 확실한 것만, 1~2문장.
            - reading: 이 순간을 연기로 볼 때 가능한 해석 후보 1개(단정하지 않는다). 근거가 약하면 빈 문자열.
            대사 받아쓰기가 틀렸으면 heard 에 실제로 들린 말을 적는다(맞으면 빈 문자열).
            배우가 적은 장면: %s
            덩어리:
            %s
            출력: {"chunks":[{"i":번호,"heard":"","seen":"","reading":""}],"overall":"장면 전체 흐름 2~3문장(본 것만)"}""";

    static final String BLOCK_HEAD = """
            ## 1층 관찰
            서버가 이 영상을 미리 살펴본 기록이다. 받아쓰기와 관찰 모델이 만든 것이라 틀릴 수 있다. 영상에서 직접 보고 들은 것과 다르면 영상을 따른다.
            관찰은 근본 문제의 증상(근거)을 고르고 배우에게 그때의 대사로 가리킬 때 쓴다. 해석 후보는 단정하지 않고 배우에게 묻는 재료로만 쓴다. 숫자·영상 시간·이 칸의 존재를 배우에게 말하지 않는다.
            시선은 상대를 볼 수 있는 장면에서만 근거로 쓴다. 통화, 혼잣말 독백, 기억을 떠올리는 독백처럼 상대 얼굴을 볼 수 없거나 보지 않는 게 자연스러운 장면에서는 시선이 아래·옆으로 가는 것만으로 집중 문제로 보지 않는다.""";

    private final SpeechAnalyzer speech;
    private final GeminiGateway gateway;
    private final String model;
    private final ObjectMapper mapper;
    private final FailureReporter failures;
    private final LlmTelemetry telemetry;

    GeminiLayerOneObserver(SpeechAnalyzer speech, GeminiGateway gateway, String model, ObjectMapper mapper,
            FailureReporter failures, LlmTelemetry telemetry) {
        this.speech = speech;
        this.gateway = gateway;
        this.model = model == null || model.isBlank() ? DEFAULT_MODEL : model.strip();
        this.mapper = mapper;
        this.failures = failures;
        this.telemetry = telemetry;
    }

    @Override
    public String observe(Path video, String mimeType, String scene, UUID practiceSessionId, UUID userId) {
        SpeechAnalysis heard = speech.analyze(video, practiceSessionId, userId);
        List<Chunk> chunks = chunks(heard.words());
        if (chunks.isEmpty()) return "";
        GeminiFile uploaded = null;
        Instant started = Instant.now();
        String output = "";
        LlmTokens tokens = LlmTokens.unknown();
        String error = null;
        String prompt = prompt(scene, chunks);
        try {
            uploaded = gateway.upload(video, mimeType == null || mimeType.isBlank() ? "video/mp4" : mimeType);
            GeminiFile active = FileActivationPoller.waitUntilActive(uploaded, gateway::get,
                    GeminiObservationAnalyzer.ACTIVE_TIMEOUT, GeminiObservationAnalyzer.POLL_INTERVAL,
                    System::nanoTime, FileActivationPoller.Sleeper.real());
            GenerateContentConfig config = GenerateContentConfig.builder()
                    .responseMimeType("application/json")
                    .maxOutputTokens(16000)
                    .thinkingConfig(ThinkingConfig.builder().thinkingLevel("LOW").build())
                    .httpOptions(HttpOptions.builder().timeout(240_000).build())
                    .build();
            Content contents = Content.builder().role("user").parts(
                    Part.fromUri(active.uri(), active.mimeType()), Part.fromText(prompt)).build();
            JsonNode parsed = null;
            for (int attempt = 0; attempt < 2 && parsed == null; attempt++) {
                GenerateContentResponse response = gateway.generateResponse(model, contents, config);
                tokens = GeminiUsage.tokens(response);
                output = response.text() == null ? "" : response.text();
                parsed = parse(output);
            }
            if (parsed == null) {
                error = "unparsed_observation";
                return "";
            }
            return block(chunks, parsed);
        } catch (RuntimeException failure) {
            error = failure.getClass().getSimpleName();
            throw failure;
        } finally {
            if (practiceSessionId != null) {
                telemetry.record(new LlmCall(LlmStep.OBSERVATION, practiceSessionId, userId, model, prompt, output, tokens,
                        started, Duration.between(started, Instant.now()), error, Map.of("layer", "coach_layer1")));
            }
            if (uploaded != null) {
                try {
                    gateway.delete(uploaded.name());
                } catch (RuntimeException cleanup) {
                    failures.report(cleanup, FailureKind.EXTERNAL, new FailureContext("GeminiLayerOneObserver.fileCleanup"));
                }
            }
        }
    }

    private JsonNode parse(String text) {
        if (text == null || text.isBlank()) return null;
        try {
            JsonNode node = mapper.readTree(text.strip());
            return node != null && node.path("chunks").isArray() ? node : null;
        } catch (Exception broken) {
            return null;
        }
    }

    record Chunk(double start, double end, String text) { }

    /** 받아쓴 단어를 쉼으로 덩어리로 묶는다. 너무 짧은 덩어리는 앞에 붙이고, {@link #MAX_CHUNKS} 개까지만 쓴다. */
    static List<Chunk> chunks(List<SpeechFacts.Word> words) {
        List<Chunk> raw = new ArrayList<>();
        StringBuilder text = null;
        double start = 0;
        double end = 0;
        for (SpeechFacts.Word word : words == null ? List.<SpeechFacts.Word>of() : words) {
            String w = word.word() == null ? "" : word.word().strip();
            if (w.isEmpty()) continue;
            if (text != null && word.start() - end < CHUNK_GAP) {
                text.append(' ').append(w);
                end = word.end();
                continue;
            }
            if (text != null) raw.add(new Chunk(start, end, text.toString()));
            text = new StringBuilder(w);
            start = word.start();
            end = word.end();
        }
        if (text != null) raw.add(new Chunk(start, end, text.toString()));
        List<Chunk> merged = new ArrayList<>();
        for (Chunk c : raw) {
            if (!merged.isEmpty() && c.end() - c.start() < MIN_CHUNK) {
                Chunk last = merged.removeLast();
                merged.add(new Chunk(last.start(), c.end(), last.text() + " " + c.text()));
            } else {
                merged.add(c);
            }
        }
        return merged.size() > MAX_CHUNKS ? List.copyOf(merged.subList(0, MAX_CHUNKS)) : List.copyOf(merged);
    }

    static String prompt(String scene, List<Chunk> chunks) {
        StringBuilder rows = new StringBuilder();
        for (int i = 0; i < chunks.size(); i++) {
            Chunk c = chunks.get(i);
            if (i > 0) rows.append('\n');
            rows.append(i).append(". ").append(clock(c.start())).append('~').append(clock(c.end()))
                    .append(" \"").append(c.text()).append('"');
        }
        return PROMPT.formatted(scene == null || scene.isBlank() ? "없음" : scene.strip(), rows);
    }

    /** 관찰 JSON 을 코치 지시문 칸으로 옮긴다. 들린 말이 받아쓰기와 다르면 들린 말을 대사로 쓴다. */
    static String block(List<Chunk> chunks, JsonNode parsed) {
        StringBuilder out = new StringBuilder(BLOCK_HEAD);
        String overall = parsed.path("overall").asText("").strip();
        if (!overall.isEmpty()) out.append("\n- 장면 흐름: ").append(overall);
        out.append("\n- 대사별 (시간 순서):");
        int written = 0;
        for (int i = 0; i < chunks.size(); i++) {
            JsonNode row = null;
            for (JsonNode r : parsed.path("chunks")) {
                if (r.path("i").asInt(-1) == i) {
                    row = r;
                    break;
                }
            }
            if (row == null) continue;
            String seen = row.path("seen").asText("").strip();
            if (seen.isEmpty()) continue;
            String heard = row.path("heard").asText("").strip();
            String reading = row.path("reading").asText("").strip();
            out.append("\n  \"").append(heard.isEmpty() ? chunks.get(i).text() : heard).append("\" — 본 것: ").append(seen);
            if (!reading.isEmpty()) out.append(" / 해석 후보: ").append(reading);
            written++;
        }
        return written == 0 ? "" : out.toString();
    }

    private static String clock(double seconds) {
        long t = Math.max(0, Math.round(seconds));
        return (t / 60) + ":" + String.format("%02d", t % 60);
    }
}
