package com.acttub.actingapi.memory.app;

/**
 * 다듬고 나니 아무것도 안 남은 값 (ADR-018 — 예외는 쓰는 쪽의 {@code app} 에 산다).
 *
 * <p>무엇을 응답할지는 부르는 자리가 정한다. 웹에서는 422 지만, 이 규칙 자체는 HTTP 를 모른다.
 */
public class BlankMemoryValue extends RuntimeException {

    public BlankMemoryValue() {
        super("memory value is blank after normalization");
    }
}
