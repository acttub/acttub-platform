package com.acttub.actingapi.platform.observability;

import java.util.Objects;
import java.util.UUID;

/**
 * 기록 하나에 붙는 판정. {@code practiceSessionId} 가 기록의 열쇠이므로 점수도 그 값으로
 * 붙는다.
 *
 * <p>여기 담는 것은 <b>모델을 한 번도 더 부르지 않고 알 수 있는 것</b>뿐이다. 서버가 이미
 * 판정하고 있는 것들 — 금지어에 걸렸나, 다시 냈나, 서버가 대신 말했나, 노트가 막혔나,
 * 관찰이 몇 개였나. 모델에게 채점시키는 것(judge)은 유료 호출이라 이 자리에 넣지 않는다.
 */
public record LlmScore(
        UUID practiceSessionId,
        String name,
        /** Langfuse 의 자료형 이름. NUMERIC · BOOLEAN · CATEGORICAL 셋뿐이다. */
        String dataType,
        /** NUMERIC·BOOLEAN 이면 Double, CATEGORICAL 이면 String. */
        Object value,
        String comment) {

    public LlmScore {
        Objects.requireNonNull(practiceSessionId, "practiceSessionId");
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(value, "value");
    }

    /** 있었나 없었나. Langfuse 는 0·1 로 받는다. */
    public static LlmScore flag(UUID practiceSessionId, String name, boolean value) {
        return new LlmScore(practiceSessionId, name, "BOOLEAN", value ? 1.0 : 0.0, null);
    }

    /** 개수·길이처럼 세는 것. */
    public static LlmScore number(UUID practiceSessionId, String name, double value) {
        return new LlmScore(practiceSessionId, name, "NUMERIC", value, null);
    }

    /** 무엇에 걸렸는지처럼 갈래를 세는 것. */
    public static LlmScore category(UUID practiceSessionId, String name, String value) {
        return new LlmScore(practiceSessionId, name, "CATEGORICAL", value, null);
    }

    public LlmScore withComment(String newComment) {
        return new LlmScore(practiceSessionId, name, dataType, value, newComment);
    }
}
