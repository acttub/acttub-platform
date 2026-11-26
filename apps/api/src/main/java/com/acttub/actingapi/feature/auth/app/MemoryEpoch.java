package com.acttub.actingapi.feature.auth.app;

import java.util.UUID;

/**
 * 배우 기억의 세대 (practice.memory). 기억을 지우거나 이전에서 한쪽을 고를 때 올라가고, 그때 돌던 갱신 작업의 결과는 반영되지
 * 않는다. 계정 행의 칸({@code users.memory_epoch})이라 계정 행의 주인이 이 Port 로 내준다(ADR-040).
 */
public interface MemoryEpoch {

    /** 세대를 하나 올린다. <b>트랜잭션을 열지 않는다</b> — 기억을 지우는 쪽의 것에 참여한다. */
    void bump(UUID userId);
}
