package com.acttub.actingapi.platform.observability;

import java.util.Objects;

/**
 * 모델 호출이 쓴 프롬프트 템플릿. 기록마다 "어느 프롬프트 몇 버전이었나"를 잇는 데 쓴다(SOMA-585).
 *
 * <p><b>정적 템플릿만 담는다.</b> 배우 프로필·이전 맥락·언어 지시처럼 요청마다 달라지는 조각은
 * 넣지 않는다 — 그러면 배우 정보가 프롬프트 저장소에 들어가고, 요청마다 새 버전이 생긴다.
 * 원본은 계속 코드(resources)가 정본이다. 관측 서버에서 받아 쓰지 않는다.
 *
 * <p>이름은 기록 사이에서 같은 프롬프트를 묶는 열쇠다. 바꾸면 지난 버전과 갈린다.
 */
public record LlmPrompt(String name, String text) {

    public LlmPrompt {
        Objects.requireNonNull(text, "text");
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("프롬프트 이름이 비었다");
        }
    }
}
