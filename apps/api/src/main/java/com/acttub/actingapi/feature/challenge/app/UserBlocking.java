package com.acttub.actingapi.feature.challenge.app;

import java.util.UUID;

/**
 * 사람을 차단한다 (challenge.reaction, community). 차단은 챌린지와 게시판이 함께 쓰는 한 목록({@code user_blocks})이고 그
 * 테이블은 {@code challenge} 의 것이라, 게시판은 이 Port 로 차단을 넣는다(ADR-040).
 */
public interface UserBlocking {

    /** 이미 차단했으면 아무 일도 없다. <b>트랜잭션을 열지 않는다</b> — 부르는 쪽의 것에 참여한다. */
    void block(UUID blockerId, UUID blockedId);
}
