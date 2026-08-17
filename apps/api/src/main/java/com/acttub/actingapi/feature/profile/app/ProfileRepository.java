package com.acttub.actingapi.feature.profile.app;

import java.util.UUID;

import com.acttub.actingapi.feature.profile.domain.Profile;

/**
 * profile 이 저장소에 요구하는 것.
 *
 * <p>없음을 {@code null} 로 알린다(ADR-018) — 세 연산 모두 갈래가 하나다("그 사용자가 없다").
 * 없음을 404 로 옮기는 일은 서비스가 한다.
 */
public interface ProfileRepository {

    Profile find(UUID userId);

    /** 없으면 {@code null}. */
    Profile updateNickname(UUID userId, String nickname);

    /**
     * 탈퇴 처리. 없으면 {@code null}.
     *
     * <p><b>상태 전환·개인정보 파기·토큰 폐기가 한 트랜잭션이어야 한다</b> — 그래서 이 셋을
     * 서비스가 나눠 부르는 형태로 가르지 않고 연산 하나로 둔다. 나누면 중간 실패 시
     * "탈퇴했는데 refresh 는 살아 있는" 계정이 남는다.
     */
    Profile deactivate(UUID userId);
}
