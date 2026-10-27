package com.acttub.actingapi.feature.reading.app;

import java.util.UUID;

/**
 * 리딩 고품질 목소리(클라우드 음성)를 무료 기간이 끝난 뒤에도 쓸 수 있는가(SOMA-818). 2026-11-01부터 고품질 목소리는
 * Pro 혜택이다. 구현은 결제 도메인이 한다 — 결제를 했거나 서버가 준 Pro 기간(billing_pro_grants) 안이면 true.
 */
public interface VoicePlan {
    boolean pro(UUID userId);

    /** 아무도 Pro 가 아닌 구현 — 결제 도메인이 없을 때(테스트 등). 무료 기간에만 쓸 수 있다. */
    VoicePlan NONE = userId -> false;
}
