package com.acttub.actingapi.feature.practice.app;

import java.time.Instant;
import java.time.OffsetDateTime;
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
 *
 * <p><b>하루 한도도 여기서 본다</b>({@link AnalysisQuota}). 세는 일과 작업을 만드는 일이 다른 트랜잭션이면
 * 겹쳐 온 요청이 같은 수를 보고 함께 지나간다 — 그 사람의 {@code users} 행을 잡은 채 세고, 넘었으면
 * {@link PracticeSessionOperation#overQuota()} 를 돌려준다. 같은 요청 ID 의 재전송은 한도보다 먼저 갈라
 * 세지 않는다 (apps/api/CONTRACT.md §5-2·§6-9).
 */
public interface PracticeSessionLedger {

    /**
     * {@code since} 부터 건 분석 요청이 {@code limit} 번이면 더 걸지 않는다. 한도가 없는 사람(회원)은
     * {@code null} 을 넘긴다.
     */
    record AnalysisQuota(int limit, OffsetDateTime since) {
    }

    /**
     * 세션을 만들면서 분석 작업을 같이 건다.
     *
     * @return 만들었거나 같은 요청 ID 로 이미 있던 것. 업로드 의도가 확정 상태가 아니면 {@code null},
     *         한도에 걸렸으면 {@link PracticeSessionOperation#overQuota()}
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
            String requestFingerprint,
            AnalysisQuota quota);

    default PracticeSessionOperation createWithAnalysis(
            UUID userId, UUID uploadIntentId, String situation, String characterContext, String goal,
            String blockageKind, String subBranch, String blockageDetail, UUID continuedFrom,
            UUID requestId, String requestFingerprint, String experienceVersion, AnalysisQuota quota) {
        if (!PracticeExperience.LEGACY.equals(experienceVersion)) {
            throw new IllegalStateException("versioned practice writer is not configured");
        }
        return createWithAnalysis(userId, uploadIntentId, situation, characterContext, goal, blockageKind, subBranch,
                blockageDetail, continuedFrom, requestId, requestFingerprint, quota);
    }

    /**
     * 실패한 세션에 분석 작업을 다시 건다.
     *
     * @return 걸었거나 같은 요청 ID 로 이미 있던 것. 세션이 없거나 실패 상태가 아니면 {@code null},
     *         한도에 걸렸으면 {@link PracticeSessionOperation#overQuota()} — 한도가 실패 상태 확인보다 먼저다
     */
    PracticeSessionOperation createAnalysisRetry(
            UUID userId,
            UUID sessionId,
            UUID requestId,
            String requestFingerprint,
            Instant now,
            AnalysisQuota quota);
}
