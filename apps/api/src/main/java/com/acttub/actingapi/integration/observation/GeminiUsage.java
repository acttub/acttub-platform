package com.acttub.actingapi.integration.observation;

import com.acttub.actingapi.platform.observability.LlmTokens;
import com.google.genai.types.GenerateContentResponse;

final class GeminiUsage {
    private GeminiUsage() {
    }

    static LlmTokens tokens(GenerateContentResponse response) {
        return response.usageMetadata().map(usage -> {
            Integer candidates = usage.candidatesTokenCount().orElse(null);
            Integer thoughts = usage.thoughtsTokenCount().orElse(null);
            // Gemini 는 사고 토큰을 응답 토큰과 별도로 준다. 둘 다 출력 비용에 들어간다.
            // https://ai.google.dev/gemini-api/docs/generate-content/thinking
            Integer output = candidates == null && thoughts == null ? null
                    : (candidates == null ? 0 : candidates) + (thoughts == null ? 0 : thoughts);
            // 캐시 적중분(SOMA-1063)은 promptTokenCount 안에 들어 있다. 입력 합계는 그대로 두고 따로 남긴다.
            return LlmTokens.of(usage.promptTokenCount().orElse(null), output,
                    usage.totalTokenCount().orElse(null), usage.cachedContentTokenCount().orElse(null));
        }).orElseGet(LlmTokens::unknown);
    }
}
