package com.acttub.actingapi.feature.reading.domain;

import java.util.Locale;

/**
 * 대본 나누기 방식 (SOMA-1090, 환경변수 {@code SCRIPT_SPLIT_MODE}).
 *
 * <ul>
 *   <li>{@link #LLM} — 지금처럼 모델이 처음부터 나눈다(기본값).</li>
 *   <li>{@link #HYBRID} — 규칙({@link RuleSplit})이 확신하는 대본은 모델 첫 판과 줄 검토(Jev)를 건너뛰고, 규칙이 답하지 못한 줄만
 *   「빠진 줄 다시 묻기」로 모델에 보낸다. 확신하지 못하는 대본은 LLM 과 같다.</li>
 *   <li>{@link #RULES} — 풀규칙({@link RuleSplit#full}): 모델 없이 모든 줄을 규칙으로 나눈다. 띄어쓰기 복원·외국어 줄 판정·줄 검토(Jev)·
 *   같은 화자 묻기도 하지 않고, 배역 성별만 모델에 한 번 묻는다(상대역 목소리 고르기). 이름을 못 찾은 산문은 「대본 아님」이다.</li>
 * </ul>
 */
public enum ScriptSplitMode {
    LLM, HYBRID, RULES;

    /** 비었거나 모르는 값이면 {@link #LLM} — 잘못 쓴 설정이 나누기를 바꾸지 않게. */
    public static ScriptSplitMode parse(String value) {
        if (value == null || value.isBlank()) {
            return LLM;
        }
        return switch (value.strip().toLowerCase(Locale.ROOT)) {
            case "hybrid" -> HYBRID;
            case "rules" -> RULES;
            default -> LLM;
        };
    }
}
