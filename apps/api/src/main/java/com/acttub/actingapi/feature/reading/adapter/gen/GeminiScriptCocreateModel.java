package com.acttub.actingapi.feature.reading.adapter.gen;

import com.acttub.actingapi.feature.reading.app.ScriptCocreateModel;
import com.google.genai.Client;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;

/**
 * 찍을 대사 같이 만들기의 Gemini 연결(SOMA-721). JSON 답만 받는다(responseMimeType). 인계본과 같은 온도 1.0 이다.
 *
 * <p>코칭 키 클라이언트(@Primary, GEMINI_COACH_API_KEY → GEMINI_API_KEY)를 쓴다 — 새 비밀 값이 없다. 막혔거나(안전 필터)
 * 답이 비면 예외로 던져 서비스가 다른 조건으로 한 번 더 만든다.
 */
public class GeminiScriptCocreateModel implements ScriptCocreateModel {

    private final Client client;
    private final String model;

    public GeminiScriptCocreateModel(Client client, String model) {
        this.client = client;
        this.model = model;
    }

    @Override
    public Reply generate(String prompt, int maxOutputTokens) {
        GenerateContentConfig config = GenerateContentConfig.builder()
                .responseMimeType("application/json")
                .temperature(1.0f)
                .maxOutputTokens(maxOutputTokens)
                .build();
        GenerateContentResponse response = client.models.generateContent(model, prompt, config);
        String text = response.text();
        if (text == null || text.isBlank()) {
            throw new IllegalStateException("sample script model returned no text: "
                    + response.promptFeedback().flatMap(feedback -> feedback.blockReason()).map(Object::toString).orElse("empty"));
        }
        return new Reply(text, model);
    }
}
