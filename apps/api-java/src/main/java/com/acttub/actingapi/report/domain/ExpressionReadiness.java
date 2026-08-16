package com.acttub.actingapi.report.domain;

/**
 * 표현 갈래로 성적표를 만들 수 있는 상태인지.
 *
 * <p>표현은 <b>해 보고 달라진 것</b>이 있어야 쓸 말이 생긴다. 코치가 실험을 제안만 하고 배우가
 * 아직 해 보지 않았거나, 해 봤는데 무엇이 달라졌는지 적히지 않았으면 성적표를 만들지 않고
 * 차단 노트를 낸다 — 그 상태로 모델을 부르면 "실험했다고 치고" 지어낸 문장이 나온다.
 *
 * <p>분석 갈래에는 이 관문이 없다. 분석은 확정된 핸드오프 하나로 충분하다.
 */
public final class ExpressionReadiness {

    private ExpressionReadiness() {
    }

    /**
     * @param tested 배우가 실험을 실제로 해 봤는지. 적히지 않았으면 {@code null}
     * @param instruction 해 본 실험의 지시문. 없거나 문자열이 아니면 {@code null}
     * @param observedChange 해 보고 달라진 것. 없거나 문자열이 아니면 {@code null}
     */
    public static boolean playable(Boolean tested, String instruction, String observedChange) {
        return Boolean.TRUE.equals(tested)
                && isPresent(instruction)
                && isPresent(observedChange);
    }

    /** 공백만 있는 것은 안 적힌 것으로 본다. */
    private static boolean isPresent(String value) {
        return value != null && !value.strip().isEmpty();
    }
}
