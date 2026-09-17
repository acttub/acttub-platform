package com.acttub.actingapi.integration.observation;

import java.nio.file.Path;
import java.nio.file.Files;
import java.io.IOException;
import java.io.UncheckedIOException;

import com.google.genai.Client;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import com.google.genai.types.GetFileConfig;
import com.google.genai.types.UploadFileConfig;

final class GoogleGenAiGateway implements GeminiGateway {

    private final Client client;

    GoogleGenAiGateway(Client client) {
        this.client = client;
    }

    @Override
    public GeminiFile upload(Path path, String mimeType) {
        // The path overload guesses a second MIME for the resumable-upload header.
        // Stream upload uses the same explicit MIME in metadata and transport.
        try (var input = Files.newInputStream(path)) {
            return file(client.files.upload(input, Files.size(path),
                    UploadFileConfig.builder().mimeType(mimeType).build()), mimeType);
        } catch (IOException failure) {
            throw new UncheckedIOException("failed to read media for upload", failure);
        }
    }

    @Override
    public GeminiFile get(String name) {
        return file(client.files.get(name, GetFileConfig.builder().build()), null);
    }

    @Override
    public String generate(
            String model,
            Content contents,
            GenerateContentConfig config) {
        return client.models.generateContent(model, contents, config).text();
    }

    @Override
    public GenerateContentResponse generateResponse(
            String model, Content contents, GenerateContentConfig config) {
        return client.models.generateContent(model, contents, config);
    }

    @Override
    public void delete(String name) {
        client.files.delete(name, null);
    }

    private static GeminiFile file(
            com.google.genai.types.File file,
            String fallbackMimeType) {
        return new GeminiFile(
                file.name().orElseThrow(),
                file.uri().orElse(null),
                file.mimeType().orElse(fallbackMimeType),
                file.state().map(Object::toString).orElse("PROCESSING"));
    }
}
