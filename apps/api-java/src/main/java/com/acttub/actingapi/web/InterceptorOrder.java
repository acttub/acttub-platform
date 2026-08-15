package com.acttub.actingapi.web;

/**
 * 인터셉터 실행 순서. <b>등록은 각 기능 패키지가 하되 순서는 여기서만 정한다</b> — 등록이
 * 흩어진 뒤에도 순서를 한자리에서 읽을 수 있어야 하기 때문이다 (ADR-016).
 */
public final class InterceptorOrder {

    /** 동의 게이트가 먼저다. 미동의 사용자의 요청 바디를 검증할 이유가 없다. */
    public static final int CONSENT_GATE = 0;

    public static final int BODY_VALIDATION = 1;

    private InterceptorOrder() {}
}
