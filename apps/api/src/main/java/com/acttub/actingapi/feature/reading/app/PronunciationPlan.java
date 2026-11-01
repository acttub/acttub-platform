package com.acttub.actingapi.feature.reading.app;

import java.util.UUID;

/**
 * 리딩 발음 보고서를 받을 수 있는 Pro 인가(SOMA-967). 구현은 결제 도메인이 한다 — 결제를 했거나 서버가 준 Pro 기간
 * (billing_pro_grants) 안이면 true. 허용 사용자 목록(PRON_REPORT_ALLOWED_USERS)은 Pro 와 상관없이 따로 연다.
 */
public interface PronunciationPlan {
    boolean pro(UUID userId);

    /** 아무도 Pro 가 아닌 구현 — 결제 도메인이 없을 때(테스트 등). 허용 목록만 받는다. */
    PronunciationPlan NONE = userId -> false;
}
