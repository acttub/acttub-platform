package com.acttub.actingapi.integration.observation;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.media.VideoRecordChunks;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.Part;
import com.google.genai.types.Schema;
import com.google.genai.types.ThinkingConfig;
import com.google.genai.types.ThinkingLevel;
import com.google.genai.types.VideoMetadata;

/** 전체 기록의 청크 처리·검증·실패 구간 보존. 구형 관찰 팩으로 폴백하지 않는다. */
final class GeminiVideoRecordAnalyzer implements VideoRecordAnalyzer {
    static final double SAMPLE_FPS = 6.0;
    static final long CHUNK_MS = 30_000;
    static final long MIN_CHUNK_MS = 7_500;
    private static final String PROMPT = StructuredJson.textResource("/coaching/video-record-prompt.txt");
    private static final JsonNode CONTRACT = StructuredJson.schema("layer1_chunk");
    private static final Schema SCHEMA = Schema.fromJson(geminiSchema(CONTRACT, CONTRACT.path("$defs")).toString());
    private final GeminiGateway gateway;
    private final VideoRecordChunks chunks;
    private final String model;
    private final FailureReporter failures;
    private final LlmTelemetry telemetry;

    GeminiVideoRecordAnalyzer(GeminiGateway gateway, VideoRecordChunks chunks, String model,
            FailureReporter failures, LlmTelemetry telemetry) {
        this.gateway = gateway;
        this.chunks = chunks;
        this.model = model;
        this.failures = failures;
        this.telemetry = telemetry;
    }

    @Override
    public ObjectNode analyze(Path video, ActorMaterial actor, UUID practiceSessionId, UUID userId, SpeechAnalysis speech) {
        boolean audio = chunks.hasAudio(video);
        ObjectNode record = VideoRecord.empty(UUID.randomUUID(), actor.durationMs(), audio, actor);
        List<RuntimeException> rangeFailures = new ArrayList<>();
        // 정상 호출은 청크당 한 번, 파싱 재시도/재분할도 최초 분석의 명시적인 예산 안에서만 한다.
        for (long start = 0; start < actor.durationMs(); start += CHUNK_MS) {
            analyzeRange(video, actor, practiceSessionId, userId, speech, record,
                    start, Math.min(actor.durationMs(), start + CHUNK_MS), new int[]{6}, rangeFailures);
        }
        ObjectNode sampling = ((ArrayNode) record.path("limitations")).addObject()
                .put("id", "capture:sampling").put("start_ms", 0).put("end_ms", actor.durationMs())
                .putNull("subject_id").put("kind", "timing")
                .put("description", "영상 입력은 초당 6프레임 샘플링을 요청했다. 프레임 사이의 미세한 변화와 정확한 시작 시각은 확정할 수 없다.");
        sampling.putArray("dimensions").add("gaze").add("face").add("movement");
        try {
            VideoRecord.finish(record, speech);
        } catch (SummaryParseError failure) {
            if (!rangeFailures.isEmpty()) {
                throw new SummaryParseError(failure.getMessage(), rangeFailures.getLast());
            }
            throw failure;
        }
        return record;
    }

    private void analyzeRange(Path video, ActorMaterial actor, UUID practiceId, UUID userId, SpeechAnalysis speech,
            ObjectNode record, long start, long end, int[] remaining, List<RuntimeException> rangeFailures) {
        if (Thread.currentThread().isInterrupted()) {
            throw new IllegalStateException("video record analysis interrupted");
        }
        if (remaining[0] <= 0) {
            VideoRecord.missing(record, start, end);
            return;
        }
        String chunkId = "chunk_" + start + "_" + end;
        Path chunk = null;
        GeminiFile uploaded = null;
        RuntimeException last = null;
        try {
            chunk = chunks.extract(video, start, end);
            uploaded = gateway.upload(chunk, "video/mp4");
            GeminiFile active = FileActivationPoller.waitUntilActive(uploaded, gateway::get,
                    GeminiObservationAnalyzer.ACTIVE_TIMEOUT, GeminiObservationAnalyzer.POLL_INTERVAL,
                    System::nanoTime, FileActivationPoller.Sleeper.real());
            ObjectNode input = StructuredJson.MAPPER.createObjectNode().put("chunk_id", chunkId)
                    .put("chunk_duration_ms", end - start)
                    .put("source_duration_ms", actor.durationMs())
                    .put("chunk_start_ms", start).put("chunk_end_ms", end)
                    .put("audio_track_present", record.path("media").path("audio_track_present").asBoolean());
            input.set("actor_context", record.path("actor_context"));
            input.putNull("reference_transcript");
            if (speech != null && !speech.words().isEmpty()) {
                ArrayNode words = input.putArray("reference_transcript");
                for (var word : speech.words()) {
                    if (word.end() * 1000 > start && word.start() * 1000 < end) {
                        words.addObject().put("text", word.word())
                                .put("start_ms", Math.max(0, Math.round(word.start() * 1000) - start))
                                .put("end_ms", Math.min(end - start, Math.round(word.end() * 1000) - start));
                    }
                }
            }
            GenerateContentConfig config = GenerateContentConfig.builder()
                    .systemInstruction(Content.fromParts(Part.fromText(PROMPT)))
                    .responseMimeType("application/json").responseSchema(SCHEMA)
                    .temperature(0.0f).maxOutputTokens(16_384)
                    .thinkingConfig(ThinkingConfig.builder()
                            .thinkingLevel(new ThinkingLevel(ThinkingLevel.Known.LOW)).build())
                    .build();
            for (int attempt = 0; attempt < 2 && remaining[0] > 0; attempt++) {
                remaining[0]--;
                Instant began = Instant.now();
                String raw = "";
                LlmTokens tokens = LlmTokens.unknown();
                try {
                    String instruction = input + (attempt == 0 ? "" :
                            "\n직전 결과가 구조/참조/시간/전체 구간 검증을 통과하지 못했다. 빠진 구간 없이 다시 기록하라.");
                    var generated = gateway.generateResponse(model, Content.fromParts(
                            Part.fromUri(active.uri(), active.mimeType()).toBuilder()
                                    .videoMetadata(VideoMetadata.builder().fps(SAMPLE_FPS).build()).build(),
                            Part.fromText(instruction)), config);
                    raw = generated.text();
                    tokens = GeminiUsage.tokens(generated);
                    JsonNode result = VideoRecord.prepareChunk(StructuredJson.parse(raw), chunkId, end - start);
                    if (!record.path("media").path("audio_track_present").asBoolean()) {
                        if (!result.path("utterances").isEmpty()) {
                            throw new IllegalArgumentException("speech in a video without audio");
                        }
                    }
                    VideoRecord.append(record, result, start);
                    recordCall(practiceId, userId, chunkId, input, raw, tokens, began, null);
                    return;
                } catch (RuntimeException failure) {
                    last = failure;
                    recordCall(practiceId, userId, chunkId, input, raw, tokens, began, failure.getClass().getSimpleName());
                }
            }
        } catch (RuntimeException failure) {
            last = failure;
        } finally {
            if (uploaded != null) {
                try {
                    gateway.delete(uploaded.name());
                } catch (RuntimeException failure) {
                    failures.report(failure, FailureKind.EXTERNAL, new FailureContext("GeminiVideoRecordAnalyzer.fileCleanup"));
                }
            }
            if (chunk != null) {
                try {
                    Files.deleteIfExists(chunk);
                } catch (IOException failure) {
                    failures.report(failure, new FailureContext("GeminiVideoRecordAnalyzer.chunkCleanup"));
                }
            }
        }
        if (last != null) {
            rangeFailures.add(last);
            failures.report(last, new FailureContext("GeminiVideoRecordAnalyzer.chunk", practiceId));
        }
        if (end - start > MIN_CHUNK_MS && remaining[0] >= 2) {
            long middle = start + (end - start) / 2;
            analyzeRange(video, actor, practiceId, userId, speech, record, start, middle, remaining, rangeFailures);
            analyzeRange(video, actor, practiceId, userId, speech, record, middle, end, remaining, rangeFailures);
        } else {
            VideoRecord.missing(record, start, end);
        }
    }

    private void recordCall(UUID practiceId, UUID userId, String chunk, JsonNode input, String output, LlmTokens tokens, Instant began, String error) {
        telemetry.record(new LlmCall(LlmStep.OBSERVATION, practiceId, userId, model,
                PROMPT + "\n" + input, output, tokens, began, Duration.between(began, Instant.now()),
                error, Map.of("contract", VideoRecord.VERSION, "chunk", chunk)));
    }

    /** Gemini가 지원하는 스키마로 변환한다. 전체 제약은 StructuredJson으로 검증한다. */
    private static JsonNode geminiSchema(JsonNode node, JsonNode definitions) {
        if (node.has("$ref")) {
            return geminiSchema(definitions.path(node.path("$ref").asText().substring("#/$defs/".length())), definitions);
        }
        if (node.has("anyOf")) {
            JsonNode nonNull = null;
            for (JsonNode variant : node.path("anyOf")) {
                if (!"null".equals(variant.path("type").asText())) nonNull = variant;
            }
            ObjectNode result = (ObjectNode) geminiSchema(nonNull, definitions);
            result.put("nullable", true);
            return result;
        }
        ObjectNode result = StructuredJson.MAPPER.createObjectNode();
        result.put("type", node.path("type").asText(node.has("enum") ? "string" : "object").toUpperCase(Locale.ROOT));
        if (node.has("enum")) result.set("enum", node.path("enum"));
        if (node.has("required")) result.set("required", node.path("required"));
        if (node.has("items")) result.set("items", geminiSchema(node.path("items"), definitions));
        if (node.has("properties")) {
            ObjectNode properties = result.putObject("properties");
            node.path("properties").fields().forEachRemaining(entry -> {
                JsonNode property = geminiSchema(entry.getValue(), definitions);
                // Alignment is assigned by the server from verified word timings, never by the model.
                if ("timing_basis".equals(entry.getKey())) {
                    ((ObjectNode) property).putArray("enum").add("estimated");
                }
                properties.set(entry.getKey(), property);
            });
        }
        return result;
    }
}
