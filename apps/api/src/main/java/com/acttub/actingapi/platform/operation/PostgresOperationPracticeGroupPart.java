package com.acttub.actingapi.platform.operation;

import java.util.EnumSet;
import java.util.Set;

import com.acttub.actingapi.feature.practice.app.ErasedPracticeGroup;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasurePart;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasureStep;
import org.springframework.stereotype.Repository;

/**
 * 연습을 지울 때 그 묶음의 AI 작업을 닫고 사람과 끊는다 (practice.library 「연습 삭제」, apps/api/CONTRACT.md §5-7).
 *
 * <p>진행 중인 분석·기억 갱신은 실패로 닫는다. lease 를 떼므로 돌던 워커의 완료는 lease 가 맞지 않아 저장되지 않는다. 그 뒤
 * 작업 행의 주인을 보관 계정으로 바꾼다. 문장은 작업의 상태를 바꾸는 다른 문장과 함께 {@link PostgresAiJobLedger} 에 있다.
 *
 * <p>트랜잭션을 열지 않는다 — 연습을 지우는 트랜잭션에 참여한다.
 */
@Repository
class PostgresOperationPracticeGroupPart implements PracticeGroupErasurePart {

    private final PostgresAiJobLedger jobs;

    PostgresOperationPracticeGroupPart(PostgresAiJobLedger jobs) {
        this.jobs = jobs;
    }

    @Override
    public Set<PracticeGroupErasureStep> steps() {
        return EnumSet.of(PracticeGroupErasureStep.AI_JOBS);
    }

    @Override
    public void erase(PracticeGroupErasureStep step, ErasedPracticeGroup group) {
        jobs.failAndHandOverOfDeletedPractices(group.userId(), group.practiceIds(), group.keeper(), group.now());
    }
}
