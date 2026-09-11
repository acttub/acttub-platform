package com.acttub.actingapi.platform.observability;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * 끝난 모델 호출 하나. 성공이든 실패든 같은 모양으로 남긴다.
 *
 * <p><b>{@code practiceSessionId} 가 묶는 열쇠다.</b> 이 값 하나로 관찰·받아쓰기·코치
 * 턴·노트·기억 추출이 한 기록에 모인다. 워커에서 도는 것과 요청에서 도는 것이 며칠
 * 떨어져 있어도 같은 곳에 붙는다 — 그래서 호출 맥락을 코드로 실어 나를 필요가 없다.
 *
 * <p>입력·출력은 <b>원문 그대로</b> 담는다. 관측 서버가 우리 홈서버에 있어 배우의 말이
 * 밖으로 나가지 않으므로 줄이거나 가릴 이유가 없다. 줄이면 재현이 안 되고, 재현이
 * 안 되면 이 작업이 뜻을 잃는다.
 */
public record LlmCall(
        LlmStep step,
        UUID practiceSessionId,
        UUID userId,
        String model,
        String input,
        String output,
        LlmTokens tokens,
        Instant startedAt,
        Duration took,
        /** 실패했으면 그 메시지. 성공이면 null. */
        String errorMessage,
        /** 코치 세션·응답 번호·막힘 갈래처럼 걸러 볼 때 쓰는 것들. */
        Map<String, String> metadata) {

    public LlmCall {
        Objects.requireNonNull(step, "step");
        Objects.requireNonNull(practiceSessionId, "practiceSessionId");
        Objects.requireNonNull(startedAt, "startedAt");
        Objects.requireNonNull(took, "took");
        tokens = tokens == null ? LlmTokens.unknown() : tokens;
        input = input == null ? "" : input;
        output = output == null ? "" : output;
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }

    public boolean failed() {
        return errorMessage != null;
    }

    /** 값이 있는 것만 담는 metadata 조립기 — 빈 칸이 속성으로 나가지 않게 한다. */
    public static Map<String, String> metadata(String... keyValues) {
        if (keyValues.length % 2 != 0) {
            throw new IllegalArgumentException("키와 값이 짝을 이루어야 한다");
        }
        Map<String, String> values = new LinkedHashMap<>();
        for (int index = 0; index < keyValues.length; index += 2) {
            String value = keyValues[index + 1];
            if (value != null && !value.isBlank()) {
                values.put(keyValues[index], value);
            }
        }
        return values;
    }
}
