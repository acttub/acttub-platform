package com.acttub.actingapi.feature.auth.app;

import java.util.List;
import java.util.UUID;

/**
 * auth 가 동의에 요구하는 것 — 로그인 응답에 실을 <b>아직 받지 않은 필수 문서</b>.
 *
 * <p>선언이 여기 있고 구현은 문서를 소유한 {@code consent} 가 한다(ADR-017). 간선은
 * {@code consent} → {@code auth} 한 방향이라 순환이 없다 — auth 는 consent 를 알지 못한다.
 *
 * <p>교환 타입 {@link PendingConsent} 도 소비자인 여기에 산다. 제공자({@code consent})의
 * 타입을 시그니처에 두면 소비자 → 제공자 간선이 남고, 그러면 제공자가 이 포트를 구현하는
 * 순간 순환이다(ADR-017 의 ⚠, 6단계에서 실제로 걸렸던 자리).
 *
 * <p>🔎 <b>게이트와 다른 포트다.</b> "지금 이 요청을 막을 것인가"는
 * {@code platform/security/PendingConsentGate} 가 묻는다 — 배관이 쓰는 것이라 배관에 선언이
 * 있고, 문서의 형태를 알 이유가 없어 {@code boolean} 하나로 답한다.
 */
public interface PendingConsentDocuments {

    /** 발행 시각·식별자 순. 받을 것이 없으면 빈 목록. */
    List<PendingConsent> pendingFor(UUID userId);
}
