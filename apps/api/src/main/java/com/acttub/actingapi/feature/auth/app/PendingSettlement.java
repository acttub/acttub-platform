package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 계정이 아직 활성일 때 끝내야 하는 일. 계정을 닫는 트랜잭션이 상태를 바꾸기 <b>직전에</b> 부른다
 * ({@link AccountErasureSequence#close}). 다시 온 탈퇴에서는 부르지 않는다.
 *
 * <p>지금은 밀린 챌린지 마감 집계 하나다. 마감 당시 자격이 있던 참여작이 이 탈퇴 때문에 최종 순위에서 빠지지 않게 한다.
 */
public interface PendingSettlement {

    /** 부르는 쪽의 트랜잭션에 참여한다. */
    void settleBeforeDeactivation(UUID userId, Instant now);
}
