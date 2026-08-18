package com.acttub.actingapi.feature.practice.app;

import java.time.Instant;
import java.util.UUID;

/**
 * practice 가 멱등 원장에 요구하는 것 (ADR-017, SOMA-397 6단계).
 *
 * <p>{@link PracticeSessionRepository} 와 나뉘어 있는 이유는 트랜잭션 경계다. 여기 두 연산은
 * 세션 행과 작업 행을 <b>한 트랜잭션에서 함께</b> 남기며, 호출한 쪽의 트랜잭션과 분리된
 * 새 것으로 돈다. 조회 계열과 같은 포트에 두면 그 차이가 이름에서 사라진다.
 *
 * <p>둘 다 만들지 못했을 때 {@code null} 을 돌려준다 — 왜 못 만들었는지(업로드가 아직
 * 확정되지 않았는지, 세션이 실패 상태가 아닌지)는 규칙이 따로 확인해 상태코드로 옮긴다.
 */
public interface PracticeSessionLedger {

    /**
     * 세션을 만들면서 분석 작업을 같이 건다.
     *
     * @return 만들었거나 같은 요청 ID 로 이미 있던 것. 업로드 의도가 확정 상태가 아니면 {@code null}
     */
    PracticeSessionOperation createWithAnalysis(
            UUID userId,
            UUID uploadIntentId,
            String situation,
            String characterContext,
            String goal,
            String blockageKind,
            String subBranch,
            String blockageDetail,
            UUID continuedFrom,
            UUID requestId,
            String requestFingerprint);

    /**
     * 실패한 세션에 분석 작업을 다시 건다.
     *
     * @return 걸었거나 같은 요청 ID 로 이미 있던 것. 세션이 없거나 실패 상태가 아니면 {@code null}
     */
    PracticeSessionOperation createAnalysisRetry(
            UUID userId,
            UUID sessionId,
            UUID requestId,
            String requestFingerprint,
            Instant now);
}
