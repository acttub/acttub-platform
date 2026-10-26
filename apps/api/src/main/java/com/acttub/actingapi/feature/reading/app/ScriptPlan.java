package com.acttub.actingapi.feature.reading.app;

import java.util.UUID;

/**
 * 무료 이용자의 리딩 대본 보관 한도(3개)가 걸리는가(SOMA-818). 구현은 결제 도메인이 한다 — 한도 강제 플래그
 * ({@code BILLING_FREE_LIMITS_ENABLED}, 기본 false)가 켜져 있고 Pro 가 아니면 true.
 */
public interface ScriptPlan {
    /** 무료 이용자가 보관할 수 있는 대본 수. */
    int FREE_SCRIPTS = 3;

    boolean freeLimited(UUID userId);

    /** 한도를 걸지 않는 구현 — 결제 도메인이 없을 때(테스트 등). */
    ScriptPlan UNLIMITED = userId -> false;
}
