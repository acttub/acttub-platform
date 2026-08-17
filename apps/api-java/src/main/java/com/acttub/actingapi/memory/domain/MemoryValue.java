package com.acttub.actingapi.memory.domain;

import java.util.regex.Pattern;

import com.acttub.actingapi.platform.web.PythonText;

/**
 * 배우가 쓴 한 칸의 값.
 *
 * <p>원본 {@code UpdateMemoryRequest._normalize} 는 {@code " ".join(value.split())} 이다 —
 * 안쪽 공백을 하나로 접고 앞뒤를 턴다. 접고 나서 아무것도 안 남으면 값이 아니다.
 */
public final class MemoryValue {

    /**
     * 한 칸에 담을 수 있는 길이(코드포인트).
     *
     * <p>DB 제약 {@code ck_actor_memory_value_length} 와 같은 값이어야 한다 — 그쪽이 최종
     * 방어선이고, 여기 값은 요청 문서와 에이전트 추출이 그 앞에서 걸러내기 위한 것이다.
     */
    public static final int MAX_LENGTH = 1000;

    private static final Pattern INTERNAL_WHITESPACE =
            Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);

    private MemoryValue() {
    }

    /**
     * 저장할 꼴로 다듬는다. 다듬고 나면 빈 값이면 {@code null} — 무엇을 응답할지는 부르는
     * 쪽이 정한다.
     *
     * <p>앞뒤 제거를 {@link PythonText} 로 하는 이유는 {@code String.strip()} 이 NBSP 를
     * 남기기 때문이다. 파이썬 {@code str.split()} 은 그것도 공백으로 본다.
     */
    public static String normalize(String raw) {
        String collapsed = PythonText.strip(INTERNAL_WHITESPACE.matcher(raw).replaceAll(" "));
        return collapsed.isEmpty() ? null : collapsed;
    }
}
