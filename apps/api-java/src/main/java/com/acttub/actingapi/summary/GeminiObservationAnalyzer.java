package com.acttub.actingapi.summary;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.function.LongSupplier;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.MediaResolution;
import com.google.genai.types.Part;
import com.google.genai.types.Schema;

final class GeminiObservationAnalyzer implements ObservationAnalyzer {

    static final int PARSE_ATTEMPTS = 2;
    static final Duration ACTIVE_TIMEOUT = Duration.ofSeconds(300);
    static final Duration POLL_INTERVAL = Duration.ofSeconds(2);

    private static final Schema RESPONSE_SCHEMA = loadSchema();

    private final GeminiGateway gateway;
    private final ObjectMapper mapper;
    private final String model;
    private final Duration activeTimeout;
    private final Duration pollInterval;
    private final LongSupplier nanoTime;
    private final FileActivationPoller.Sleeper sleeper;

    GeminiObservationAnalyzer(GeminiGateway gateway, ObjectMapper mapper, String model) {
        this(
                gateway,
                mapper,
                model,
                ACTIVE_TIMEOUT,
                POLL_INTERVAL,
                System::nanoTime,
                FileActivationPoller.Sleeper.real());
    }

    GeminiObservationAnalyzer(
            GeminiGateway gateway,
            ObjectMapper mapper,
            String model,
            Duration activeTimeout,
            Duration pollInterval,
            LongSupplier nanoTime,
            FileActivationPoller.Sleeper sleeper) {
        this.gateway = gateway;
        this.mapper = mapper.copy()
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        this.model = model;
        this.activeTimeout = activeTimeout;
        this.pollInterval = pollInterval;
        this.nanoTime = nanoTime;
        this.sleeper = sleeper;
    }

    @Override
    public ObservationPack analyze(Path videoPath, String mimeType, ActorMaterial actor) {
        String prompt = ObservationPrompt.build(actor);
        GeminiFile uploaded = gateway.upload(videoPath, mimeType);
        try {
            GeminiFile active = FileActivationPoller.waitUntilActive(
                    uploaded,
                    gateway::get,
                    activeTimeout,
                    pollInterval,
                    nanoTime,
                    sleeper);
            GenerateContentConfig config = GenerateContentConfig.builder()
                    .systemInstruction(Content.fromParts(Part.fromText(ObservationPrompt.SYSTEM)))
                    .responseMimeType("application/json")
                    .responseSchema(RESPONSE_SCHEMA)
                    .temperature(0.0f)
                    .topP(0.1f)
                    .topK(1.0f)
                    .seed(42)
                    .mediaResolution(MediaResolution.Known.MEDIA_RESOLUTION_LOW)
                    .build();
            Content contents = Content.fromParts(
                    Part.fromUri(active.uri(), active.mimeType()),
                    Part.fromText(prompt));

            SummaryParseError lastError = null;
            for (int attempt = 0; attempt < PARSE_ATTEMPTS; attempt++) {
                String responseText = gateway.generate(model, contents, config);
                try {
                    return filter(parse(responseText), actor.durationMs());
                } catch (SummaryParseError exc) {
                    lastError = exc;
                }
            }
            throw new SummaryParseError(
                    "failed to parse after retry: " + lastError.getMessage(), lastError);
        } finally {
            try {
                gateway.delete(uploaded.name());
            } catch (Exception ignored) {
                // Python 원본과 같이 Files API 정리 실패가 성공한 분석을 뒤집지 않는다.
            }
        }
    }

    private ObservationPack parse(String text) {
        if (text == null || text.isEmpty()) {
            throw new SummaryParseError("no parseable observation pack in response");
        }
        try {
            return mapper.readValue(text, ObservationPack.class);
        } catch (JsonProcessingException exc) {
            throw new SummaryParseError(exc.getMessage(), exc);
        }
    }

    private static ObservationPack filter(ObservationPack pack, long durationMs) {
        List<ObservationItem> observations = pack.observations().stream()
                .filter(item -> item.startMs() >= 0)
                .filter(item -> item.endMs() > item.startMs())
                .filter(item -> item.endMs() <= durationMs)
                .limit(3)
                .toList();
        return new ObservationPack(observations, pack.uncertainties());
    }

    private static Schema loadSchema() {
        try (InputStream input = GeminiObservationAnalyzer.class.getResourceAsStream(
                "/summary/observation-pack.schema.json")) {
            if (input == null) {
                throw new IllegalStateException("observation pack schema is missing");
            }
            return Schema.fromJson(new String(input.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException exc) {
            throw new IllegalStateException("failed to read observation pack schema", exc);
        }
    }
}
