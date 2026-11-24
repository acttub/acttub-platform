package com.acttub.actingapi.feature.practice.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 무료 코칭 하루 한도에 더하는 회차 수(SOMA-1067 — 보상형 광고를 끝까지 보고 받은 1회). 한도가 걸린 사람에게만 쓰인다.
 * 기능이 꺼져 있으면 0 이고 DB 를 읽지 않는다.
 */
public interface CoachingBonus {
    /** @param since 한국 시간 오늘 0시 */
    int extraSessions(UUID userId, Instant since);

    /** 더하지 않는 구현 — 보상 기능이 없는 조립(좁은 테스트 등). */
    CoachingBonus NONE = (userId, since) -> 0;
}
