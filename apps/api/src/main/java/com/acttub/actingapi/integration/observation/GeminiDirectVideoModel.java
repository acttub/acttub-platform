package com.acttub.actingapi.integration.observation;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;

import com.acttub.actingapi.integration.media.VideoRecordChunks;
import com.acttub.actingapi.integration.media.VideoFrameEvidence;
import com.acttub.actingapi.integration.media.AudioSignalEvidence;
import com.google.genai.Client;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.Part;
import com.google.genai.types.UploadFileConfig;
import com.google.genai.types.GetFileConfig;
import com.google.genai.types.DeleteFileConfig;
import com.google.genai.types.HttpOptions;
import com.google.genai.types.ThinkingConfig;

public final class GeminiDirectVideoModel implements DirectVideoModel {
    /**
     * 코치 답의 출력 한도. 생각(thinking) 토큰도 이 한도를 함께 쓴다(SOMA-657).
     * 정상 답은 생각까지 합쳐 많아야 약 1,600토큰이었다(10/11 운영 입력 재현). 8,192이던 때는 생각이 한도까지 차는
     * 폭주가 30~55초 동안 이어진 뒤 빈 답이나 엉뚱한 글이 나왔다. 2,048이면 폭주를 10~20초 안에 끊고 다시 쓴다.
     */
    static final int REPLY_TOKEN_LIMIT = 2048;
    private final Client client;
    private final String model;
    private final Predicate<Path> audioProbe;
    private final Predicate<Path> blackFrameProbe;
    private final Predicate<Path> audioSignalProbe;

    public GeminiDirectVideoModel(Client client, String model) {
        this(client, model, new VideoRecordChunks()::hasAudio, new VideoFrameEvidence()::entirelyBlack,
                new AudioSignalEvidence()::hasSignal);
    }

    /** Test-only: existing upload tests do not inspect video frames. */
    GeminiDirectVideoModel(Client client, String model, Predicate<Path> audioProbe) {
        this(client, model, audioProbe, new VideoFrameEvidence()::entirelyBlack, path -> true);
    }

    /** Test-only: both track/frame probes are injected; audio signal is assumed valid. */
    GeminiDirectVideoModel(Client client, String model, Predicate<Path> audioProbe, Predicate<Path> blackFrameProbe) {
        this(client, model, audioProbe, blackFrameProbe, path -> true);
    }

    GeminiDirectVideoModel(Client client, String model, Predicate<Path> audioProbe,
            Predicate<Path> blackFrameProbe, Predicate<Path> audioSignalProbe) {
        this.client = client;
        this.model = model;
        this.audioProbe = audioProbe;
        this.blackFrameProbe = blackFrameProbe;
        this.audioSignalProbe = audioSignalProbe;
    }

    @Override
    public InputInspection inspect(Path path) {
        boolean audio = audioProbe.test(path);
        // A track is not proof of sound. Full decode failure blocks upload, never becomes silence.
        // Real audio signal preserves audio-only acting regardless of black frames.
        return audio ? new InputInspection(true, null, audioSignalProbe.test(path))
                : new InputInspection(false, blackFrameProbe.test(path), null);
    }

    @Override
    public Video upload(Path path, String mimeType, InputInspection inspection) {
        if (inspection == null || inspection.hasAudioTrack() == null) return upload(path, mimeType);
        if (inspection.emptyInput()) throw new IllegalArgumentException("empty input must not be uploaded");
        if (inspection.unusableAudio()) throw new IllegalArgumentException("silent audio must not be uploaded");
        if (Boolean.TRUE.equals(inspection.hasAudioTrack()) && inspection.hasAudioSignal() == null) {
            requireAudioSignal(path);
        }
        return uploadInspected(path, mimeType, inspection.hasAudioTrack());
    }

    @Override
    public Video upload(Path path, String mimeType) {
        // Existing/rollback callers must not bypass silence or decode-failure protection.
        boolean audio = audioProbe.test(path);
        if (audio) requireAudioSignal(path);
        return uploadInspected(path, mimeType, audio);
    }

    private void requireAudioSignal(Path path) {
        if (!audioSignalProbe.test(path)) throw new IllegalArgumentException("silent audio must not be uploaded");
    }

    private Video uploadInspected(Path path, String mimeType, boolean hasAudioTrack) {
        try (var input = Files.newInputStream(path)) {
            var file = client.files.upload(input, Files.size(path),
                    UploadFileConfig.builder().mimeType(mimeType)
                            .httpOptions(HttpOptions.builder().timeout(120000).build()).build());
            return new Video(file.name().orElseThrow(), file.uri().orElseThrow(), mimeType, hasAudioTrack);
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    }

    @Override
    public boolean ready(Video video) {
        String state = client.files.get(video.name(), GetFileConfig.builder()
                .httpOptions(HttpOptions.builder().timeout(15000).build()).build())
                .state().map(Object::toString).orElse("");
        if ("FAILED".equals(state)) throw new IllegalStateException("video processing failed");
        return "ACTIVE".equals(state);
    }

    @Override
    public String reply(Video video, List<Message> history, String instruction) {
        return generate(video, history, instruction, null);
    }

    @Override
    public String classify(List<Message> history, String instruction, List<String> categories) {
        return generate(null, history, instruction, categories);
    }

    private String generate(Video video, List<Message> history, String instruction, List<String> categories) {
        boolean classification = categories != null;
        List<Content> contents = new ArrayList<>();
        if (video != null) contents.add(Content.builder().role("user").parts(
                Part.fromUri(video.uri(), video.mimeType())).build());
        if (classification) {
            // The first coaching turn has model role. Send the transcript as data in a user message,
            // rather than asking the classifier to continue that assistant-led conversation.
            var transcript = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.arrayNode();
            history.forEach(message -> transcript.addObject().put("role", message.role()).put("text", message.text()));
            contents.add(Content.builder().role("user").parts(Part.fromText(transcript.toString())).build());
        } else {
            for (Message message : history) {
                contents.add(Content.builder().role(message.role())
                        .parts(Part.fromText(message.text())).build());
            }
        }
        var config = GenerateContentConfig.builder()
                        .systemInstruction(Content.fromParts(Part.fromText(instruction)))
                        .httpOptions(HttpOptions.builder().timeout(classification ? 15000 : 90000).build())
                        .thinkingConfig(model.startsWith("gemini-3")
                                ? ThinkingConfig.builder().thinkingLevel("LOW").build()
                                : ThinkingConfig.builder().thinkingBudget(0).build())
                        .maxOutputTokens(classification ? 1024 : REPLY_TOKEN_LIMIT);
        if (classification) {
            config.temperature(0f).responseMimeType("application/json").responseJsonSchema(java.util.Map.of(
                    "type", "object", "properties", java.util.Map.of("signals", java.util.Map.of(
                            "type", "array", "items", java.util.Map.of("type", "string", "enum", categories))),
                    "required", List.of("signals"), "additionalProperties", false));
        }
        var response = client.models.generateContent(model, contents, config.build());
        // 한도에 걸려 끊긴 답은 중간에 잘린 글이다. 빈 답과 같이 다루어 연습 루프가 한 번 다시 쓰게 한다.
        if (!classification && outputLimitReached(response)) {
            throw new IllegalStateException("empty video coaching reply: output limit reached");
        }
        String text = response.text();
        if (text == null || text.isBlank()) throw new IllegalStateException("empty video coaching reply");
        return text.strip();
    }

    private static boolean outputLimitReached(com.google.genai.types.GenerateContentResponse response) {
        return response.candidates().flatMap(candidates -> candidates.stream().findFirst())
                .flatMap(com.google.genai.types.Candidate::finishReason)
                .map(reason -> reason.knownEnum() == com.google.genai.types.FinishReason.Known.MAX_TOKENS)
                .orElse(false);
    }

    @Override
    public String compare(List<Video> videos, List<String> labels, String instruction) {
        if (videos.size() != labels.size()) throw new IllegalArgumentException("each video needs a label");
        List<Part> parts = new ArrayList<>();
        for (int i = 0; i < videos.size(); i++) {
            parts.add(Part.fromText(labels.get(i)));
            parts.add(Part.fromUri(videos.get(i).uri(), videos.get(i).mimeType()));
        }
        var config = GenerateContentConfig.builder()
                .systemInstruction(Content.fromParts(Part.fromText(instruction)))
                .httpOptions(HttpOptions.builder().timeout(180000).build())
                .thinkingConfig(model.startsWith("gemini-3")
                        ? ThinkingConfig.builder().thinkingLevel("LOW").build()
                        : ThinkingConfig.builder().thinkingBudget(0).build())
                .responseMimeType("application/json")
                .maxOutputTokens(8192);
        String text = client.models.generateContent(model,
                List.of(Content.builder().role("user").parts(parts).build()), config.build()).text();
        if (text == null || text.isBlank()) throw new IllegalStateException("empty video comparison");
        return text.strip();
    }

    @Override public void delete(Video video) {
        client.files.delete(video.name(), DeleteFileConfig.builder()
                .httpOptions(HttpOptions.builder().timeout(15000).build()).build());
    }
    @Override public String model() { return model; }
}
