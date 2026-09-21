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
        return generate(video, history, instruction, false);
    }

    @Override
    public String classify(Video video, List<Message> history, String instruction) {
        return generate(video, history, instruction, true);
    }

    private String generate(Video video, List<Message> history, String instruction, boolean classification) {
        List<Content> contents = new ArrayList<>();
        contents.add(Content.builder().role("user").parts(
                Part.fromUri(video.uri(), video.mimeType())).build());
        for (Message message : history) {
            contents.add(Content.builder().role(message.role())
                    .parts(Part.fromText(message.text())).build());
        }
        var config = GenerateContentConfig.builder()
                        .systemInstruction(Content.fromParts(Part.fromText(instruction)))
                        .httpOptions(HttpOptions.builder().timeout(90000).build())
                        .thinkingConfig(model.startsWith("gemini-3")
                                ? ThinkingConfig.builder().thinkingLevel("LOW").build()
                                : ThinkingConfig.builder().thinkingBudget(0).build())
                        .maxOutputTokens(8192);
        if (classification) {
            config.responseMimeType("application/json").responseJsonSchema(java.util.Map.of(
                    "type", "object", "properties", java.util.Map.of("route", java.util.Map.of(
                            "type", "string", "enum", List.of("advance", "scaffold", "repair", "respond"))),
                    "required", List.of("route"), "additionalProperties", false));
        }
        String text = client.models.generateContent(model, contents, config.build()).text();
        if (text == null || text.isBlank()) throw new IllegalStateException("empty video coaching reply");
        return text.strip();
    }

    @Override public void delete(Video video) {
        client.files.delete(video.name(), DeleteFileConfig.builder()
                .httpOptions(HttpOptions.builder().timeout(15000).build()).build());
    }
    @Override public String model() { return model; }
}
