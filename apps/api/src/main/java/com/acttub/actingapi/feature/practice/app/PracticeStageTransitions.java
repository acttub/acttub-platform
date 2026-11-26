package com.acttub.actingapi.feature.practice.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 다른 기능의 일이 끝나서 회차의 단계({@code practices.stage})가 넘어가는 자리 (practice.analyze, practice.coach).
 *
 * <p>회차의 테이블은 {@code practice} 의 것이라 분석과 코치는 이 Port 로 단계를 넘긴다(ADR-040). 구현은 <b>트랜잭션을 열지
 * 않는다</b> — 분석 결과나 대화의 턴을 저장하는 트랜잭션에 참여해야 결과와 단계가 함께 남거나 함께 없다.
 */
public interface PracticeStageTransitions {

    /** 분석 결과가 저장됐다: {@code analyzing} → {@code conversing}. 이미 닫힌 회차(취소·이전)는 되살리지 않는다. */
    void analysisSaved(UUID practiceId, Instant now);

    /**
     * 분석이 끝내 실패했다: 그 작업의 회차를 {@code analyzing} → {@code closed}(사유 {@code analysis_failed}). 배우가 다시
     * 시도하면 재시도가 되살린다.
     */
    void analysisFailed(UUID jobId, Instant now);

    /** 대화가 닫혔다: 그 대화의 회차를 {@code closed}(사유 {@code conversation_closed}). */
    void conversationClosed(UUID conversationId, Instant now);

    /** 닫힌 대화를 다시 열었다: 그 대화의 회차를 {@code conversing} 으로 되돌리고 닫힌 사유를 비운다. */
    void conversationReopened(UUID conversationId, Instant now);
}
