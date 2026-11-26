package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 가입과 함께 받은 동의를 동의 기록에 남긴다 (account.login, account.consent).
 *
 * <p>계정과 동의는 한 트랜잭션이어야 한다 — 동의 없이 만들어진 계정이 남지 않게. 동의 기록의 테이블은 {@code consent} 의
 * 것이라 선언은 쓰는 쪽(여기)에 있고 구현은 {@code consent} 가 한다(ADR-040). 무엇을 받아도 되는지는 이미 {@code consent} 가
 * 확인했다({@link PendingConsentDocuments}). 구현은 <b>트랜잭션을 열지 않는다</b> — 계정을 만드는 트랜잭션에 참여한다.
 */
public interface SignupConsents {

    void record(UUID userId, List<AcceptedConsent> consents, Instant now);
}
