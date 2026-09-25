package com.acttub.actingapi.platform.security;

import java.util.UUID;

/**
 * 이 회원이 프로필 필수 여섯 항목을 다 채웠는가. 동의 다음에 서는 게이트다.
 *
 * <p>구현은 프로필을 소유한 {@code profile} 이 한다 (ADR-017). 요청마다 DB 의 상태로 판정하므로
 * 토큰을 갱신해도 열리지 않는다.
 */
public interface ProfileGate {

    boolean completeFor(UUID userId);
}
