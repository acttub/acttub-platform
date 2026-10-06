package com.acttub.actingapi.integration.llm;

import java.time.Duration;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Per-call settings; a null model preserves the configured generation model.
 *
 * @param timeout 이 호출만의 응답 대기 상한. {@code null} 이면 옵션 호출의 기본(20초)이다 — 대본 나누기처럼 한 번에 150줄을
 *        받는 호출이 따로 둔다
 */
public record GenerationOptions(String model, String reasoningEffort, int maxOutputTokens,
        String schemaName, JsonNode schema, Duration timeout) {
    public GenerationOptions {
        if (maxOutputTokens < 1) throw new IllegalArgumentException("positive output budget required");
        if ((schema == null) != (schemaName == null)) throw new IllegalArgumentException("schema name required");
        if (timeout != null && (timeout.isZero() || timeout.isNegative())) throw new IllegalArgumentException("positive timeout required");
    }

    public GenerationOptions(String model, String reasoningEffort, int maxOutputTokens, String schemaName, JsonNode schema) {
        this(model, reasoningEffort, maxOutputTokens, schemaName, schema, null);
    }
}
