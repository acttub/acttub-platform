package com.acttub.actingapi.feature.auth.app;

import java.util.List;
import java.util.UUID;

/**
 * auth 가 동의에 요구하는 것 — 로그인 응답에 실을 <b>아직 결정하지 않은 문서</b>, 처음 온 신원에게
 * 보일 <b>현재 판 문서</b>, 그리고 가입 제출에 담긴 결정의 확인.
 *
 * <p>선언이 여기 있고 구현은 문서를 소유한 {@code consent} 가 한다(ADR-017). 간선은
 * {@code consent} → {@code auth} 한 방향이라 순환이 없다 — auth 는 consent 를 알지 못한다.
 *
 * <p>교환 타입({@link PendingConsent}·{@link SignupDecision}·{@link AcceptedConsent})도 소비자인
 * 여기에 산다. 제공자({@code consent})의 타입을 시그니처에 두면 소비자 → 제공자 간선이 남고, 그러면
 * 제공자가 이 포트를 구현하는 순간 순환이다(ADR-017 의 ⚠, 6단계에서 실제로 걸렸던 자리).
 *
 * <p>🔎 <b>게이트와 다른 포트다.</b> "지금 이 요청을 막을 것인가"는
 * {@code platform/security/PendingConsentGate} 가 묻는다 — 배관이 쓰는 것이라 배관에 선언이 있다.
 * 둘 다 같은 규칙(현재 판 · 선택 문서 포함 · 거절도 결정)으로 센다.
 */
public interface PendingConsentDocuments {

    /** 종류 순. 결정할 것이 없으면 빈 목록. */
    List<PendingConsent> pendingFor(UUID userId);

    /** 종류마다 현재 판 하나씩, 종류 순. 가입 화면이 이것을 그린다. */
    List<PendingConsent> currentDocuments();

    /**
     * 가입 제출의 결정을 확인해 저장할 모양으로 돌려준다.
     *
     * @throws com.acttub.actingapi.platform.web.ApiException 없는 문서 404 · 옛 판 409 · 필수 문서
     *         거절 422 · 현재 판 가운데 결정이 빠진 문서가 있으면 422
     */
    List<AcceptedConsent> acceptSignupDecisions(List<SignupDecision> decisions);
}
