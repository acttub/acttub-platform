package com.acttub.actingapi.platform.observability;

/**
 * 한 번의 호출이 쓴 토큰. 모르면 {@link #unknown()} 이다 — 0 과 구분해야 한다.
 *
 * <p>{@code integration/llm} 의 {@code TokenUsage} 를 그대로 쓰지 않는 이유는 방향이다.
 * platform 이 integration 을 알면 간선이 거꾸로 선다(ADR-019) — 부르는 쪽이 옮겨 담는다.
 *
 * <p>Gemini 쪽은 아직 응답의 사용량을 파싱조차 하지 않아 당분간 {@link #unknown()} 이
 * 들어온다. 그 자리는 뒤 단계에서 채운다.
 */
public record LlmTokens(Integer input, Integer output, Integer total) {

    private static final LlmTokens UNKNOWN = new LlmTokens(null, null, null);

    public static LlmTokens unknown() {
        return UNKNOWN;
    }

    public static LlmTokens of(Integer input, Integer output, Integer total) {
        return new LlmTokens(input, output, total);
    }

    public boolean isUnknown() {
        return input == null && output == null && total == null;
    }
}
