package com.acttub.actingapi.feature.coach.adapter;

import com.acttub.actingapi.feature.coach.app.LineNoteModel;
import com.google.genai.Client;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;

/** 「대사별로 본 것」의 Gemini 연결(SOMA-900). 코칭 키 클라이언트로 글만 보내고 JSON 답을 받는다. */
class GeminiLineNoteModel implements LineNoteModel {

    private final Client client;
    private final String model;

    GeminiLineNoteModel(Client client, String model) {
        this.client = client;
        this.model = model;
    }

    @Override
    public String generate(String prompt) {
        GenerateContentConfig config = GenerateContentConfig.builder()
                .responseMimeType("application/json")
                .temperature(0.4f)
                .maxOutputTokens(4000)
                .build();
        GenerateContentResponse response = client.models.generateContent(model, prompt, config);
        String text = response.text();
        if (text == null || text.isBlank()) throw new IllegalStateException("line note model returned no text");
        return text;
    }
}
