package com.acttub.actingapi.observation;

import java.nio.file.Path;

import com.google.genai.Client;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GetFileConfig;
import com.google.genai.types.UploadFileConfig;

final class GoogleGenAiGateway implements GeminiGateway {

    private final Client client;

    GoogleGenAiGateway(Client client) {
        this.client = client;
    }

    @Override
    public GeminiFile upload(Path path, String mimeType) {
        return file(
                client.files.upload(
                        path.toString(), UploadFileConfig.builder().mimeType(mimeType).build()),
                mimeType);
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
