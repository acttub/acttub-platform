package com.acttub.actingapi.feature.practice.app;

import java.time.Instant;
import java.util.UUID;

/** 보상형 광고로 받은 무료 코칭 1회의 장부(SOMA-1067, {@code coaching_rewards}). */
public interface CoachingRewardRepository {

    /** {@code since} 뒤에 받은 보상 수. */
    int grantedSince(UUID userId, Instant since);

    /** {@code since} 뒤에 만든 무료 코칭 회차 수 — 무료 한도가 세는 것과 같은 기준이다. */
    int sessionsSince(UUID userId, Instant since);

    /**
     * 사용자 행을 잡고(회차 시작의 한도 세기와 같은 행) 오늘 상한을 본 뒤 한 줄을 넣는다. 같은 {@code transactionId} 나 같은
     * 사람의 같은 {@code requestId} 가 이미 있으면 넣지 않는다.
     *
     * @param since 한국 시간 오늘 0시 — 상한은 이 뒤에 받은 보상 수로 센다
     */
    Grant grant(NewReward reward, Instant since, int dailyLimit, Instant now);

    /** 이 사람의 이 요청 id 로 보상이 들어왔는가. */
    boolean granted(UUID userId, UUID requestId);

    record NewReward(String transactionId, UUID userId, UUID requestId) {
    }

    enum Grant {
        GRANTED,
        /** 같은 시청(transaction_id)이나 같은 요청 id 가 이미 지급됐다. */
        DUPLICATE,
        /** 오늘 상한을 이미 채웠다. */
        CAPPED,
        /** 그런 사용자가 없다. */
        NO_USER
    }
}
