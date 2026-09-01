package com.acttub.actingapi.platform.security;

import java.util.UUID;

/**
 * 지금 이 사용자의 최신 필수 동의 결정이 보호 기능을 허용하는가.
 *
 * <p>선택 문서는 이 게이트의 대상이 아니다. 필수 문서가 여럿이면 차단을 미결정보다 먼저
 * 답하고, 둘 다 없을 때만 허용한다.
 */
public interface RequiredConsentGate {

    Status statusFor(UUID userId);

    enum Status {
        ALLOWED,
        DECISION_REQUIRED,
        BLOCKED
    }
}
