package com.acttub.actingapi.integration.llm;

import com.fasterxml.jackson.databind.JsonNode;

/** Per-call settings; a null model preserves the configured generation model. */
public record GenerationOptions(String model, String reasoningEffort, int maxOutputTokens,
        String schemaName, JsonNode schema) {
    public GenerationOptions {
        if (maxOutputTokens < 1) throw new IllegalArgumentException("positive output budget required");
        if ((schema == null) != (schemaName == null)) throw new IllegalArgumentException("schema name required");
    }
}
