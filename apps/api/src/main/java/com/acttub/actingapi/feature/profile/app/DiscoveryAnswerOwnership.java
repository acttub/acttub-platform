package com.acttub.actingapi.feature.profile.app;

import java.util.UUID;

/**
 * 게스트 이관이 닫힐 게스트의 유입 경로 답을 정리하는 포트.
 *
 * <p>가입 유입 기록({@link SignupAttributionOwnership})과 같은 까닭으로 회원에게 옮기지 않고 게스트의 행만 지운다.
 */
public interface DiscoveryAnswerOwnership {

    /** 부르는 쪽의 이관 트랜잭션에 참여한다. */
    void discardTransferredGuestAnswer(UUID guestId);
}
