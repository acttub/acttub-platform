package com.acttub.actingapi.feature.ads.app;

import java.util.UUID;

/**
 * 광고 고르기가 묻는 「Pro 인가」(SOMA-876). 구현은 결제 도메인이 한다(billing 의 SubscriptionService.pro —
 * 스토어·토스 구독과 Pro 부여를 함께 본다). 결제 도메인이 없으면 항상 무료로 본다.
 */
public interface ProStatusReader {
    boolean pro(UUID userId);

    /** 결제 도메인이 없을 때(테스트 등) — 모두 무료. */
    ProStatusReader ALWAYS_FREE = userId -> false;
}
