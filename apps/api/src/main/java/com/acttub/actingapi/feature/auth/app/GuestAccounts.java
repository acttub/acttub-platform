package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 게스트 이관이 계정 쪽에 요구하는 것. 계정·신원·리프레시 토큰의 주인은 {@code auth} 라 이관은 그것을
 * 직접 고치지 않고 이 포트로 부른다 — 간선은 {@code transfer} → {@code auth} 한 방향이다.
 */
public interface GuestAccounts {

    /** 아직 살아 있는 게스트인가. 신원이 전부 {@code guest} 이고 상태가 {@code active} 다. */
    boolean activeGuest(UUID userId);

    /**
     * 옮겨진 게스트를 닫는다 — 상태를 {@code deactivated} 로, 신원 행은 지우고, 리프레시 토큰은 폐기하되
     * 행은 남긴다. <b>부르는 쪽의 트랜잭션에 참여한다.</b>
     */
    void closeTransferredGuest(UUID guestId, Instant now);
}
