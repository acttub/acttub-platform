package com.acttub.actingapi.feature.practice.app;

import java.util.Set;

/**
 * 연습 삭제에서 한 기능이 자기 테이블에서 하는 몫 (practice.library 「연습 삭제」, ADR-040).
 *
 * <p>선언은 쓰는 쪽(여기)에 있고 구현은 그 테이블의 주인이 한다. <b>트랜잭션을 열지 않는다</b> — 연습을 지우는 트랜잭션에
 * 참여해야 묶음이 반만 지워진 채 남지 않는다. 순서는 {@link PracticeGroupErasureSequence} 가 정한다.
 */
public interface PracticeGroupErasurePart {

    /** 이 구현이 맡는 자리. 자리마다 구현이 꼭 하나다. */
    Set<PracticeGroupErasureStep> steps();

    void erase(PracticeGroupErasureStep step, ErasedPracticeGroup group);
}
