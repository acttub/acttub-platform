package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

/**
 * coach 가 배우의 프로필에 요구하는 것.
 *
 * <p>코치가 배우를 알고 시작해야 같은 것을 연습마다 다시 묻지 않는다. 프로필이 어느 테이블에 어떻게
 * 있는지, 값 목록이 무엇인지는 {@code profile} 만 안다 — 구현도 그쪽이 한다. 주고받는
 * {@link ActorProfile} 은 <b>코치의 타입</b>이다: 제공자의 타입을 시그니처에 적으면 "포트로 끊었다"가
 * 이름뿐이 되고, 제공자가 이 인터페이스를 구현하는 순간 패키지 순환이 된다(ADR-017,
 * {@link CoachMemory} 와 같은 형태).
 *
 * <p>턴마다 다시 읽는다. 조회 결과는 저장하지 않는 입력이라, 설정에서 고친 값이 다음 코치 대화부터
 * 반영된다.
 */
public interface CoachProfile {

    /**
     * 필수 여섯 항목을 다 채운 프로필만 돌려준다. 프로필이 없거나(게스트) 하나라도 비어 있으면
     * {@code null} 이다 — 그때 코치의 입력은 프로필이 없던 때와 글자 하나 다르지 않아야 한다.
     */
    ActorProfile completeFor(UUID userId);
}
