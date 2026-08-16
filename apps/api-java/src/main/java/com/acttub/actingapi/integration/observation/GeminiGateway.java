package com.acttub.actingapi.integration.observation;

import java.nio.file.Path;

import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;

interface GeminiGateway {
    GeminiFile upload(Path path, String mimeType);

    GeminiFile get(String name);

    String generate(String model, Content contents, GenerateContentConfig config);

    void delete(String name);
}

record GeminiFile(String name, String uri, String mimeType, String state) {
}
