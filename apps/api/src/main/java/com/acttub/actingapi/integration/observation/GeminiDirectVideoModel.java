package com.acttub.actingapi.integration.observation;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

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
    private final Client client;
    private final String model;

    public GeminiDirectVideoModel(Client client, String model) {
        this.client = client;
        this.model = model;
    }

    @Override
    public Video upload(Path path, String mimeType) {
        try (var input = Files.newInputStream(path)) {
            var file = client.files.upload(input, Files.size(path),
                    UploadFileConfig.builder().mimeType(mimeType)
                            .httpOptions(HttpOptions.builder().timeout(120000).build()).build());
            return new Video(file.name().orElseThrow(), file.uri().orElseThrow(), mimeType);
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
                        .maxOutputTokens(classification ? 1024 : 8192);
        if (classification) {
            config.temperature(0f).responseMimeType("application/json").responseJsonSchema(java.util.Map.of(
                    "type", "object", "properties", java.util.Map.of("signals", java.util.Map.of(
                            "type", "array", "items", java.util.Map.of("type", "string", "enum", categories))),
                    "required", List.of("signals"), "additionalProperties", false));
        }
        String text = client.models.generateContent(model, contents, config.build()).text();
        if (text == null || text.isBlank()) throw new IllegalStateException("empty video coaching reply");
        return text.strip();
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
