package com.acttub.actingapi.feature.profile.app;

import java.util.UUID;

/**
 * 게스트 이관이 닫힐 게스트의 가입 유입 기록을 정리하는 포트.
 *
 * <p>웹 게스트의 출처를 회원의 과거 가입 출처로 추정해서 옮기지 않는다. 회원이 게스트 뒤에 새로 가입했는지
 * 서버가 확실히 증명할 신호가 없으므로, 이관 때 게스트 행만 지우고 회원의 기존 값은 그대로 둔다.
 */
public interface SignupAttributionOwnership {

    /** 부르는 쪽의 이관 트랜잭션에 참여한다. */
    void discardTransferredGuest(UUID guestId);
}
