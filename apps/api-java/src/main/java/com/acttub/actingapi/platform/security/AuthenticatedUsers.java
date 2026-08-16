package com.acttub.actingapi.platform.security;

import java.util.UUID;

/**
 * 요청을 통과시킬지 정하는 데 필요한 만큼의 사용자 조회. 구현은 사용자를 소유한 쪽
 * ({@code auth}) 이 한다 — 위임만 하는 어댑터를 끼우지 않는다 (ADR-017, SOMA-397 6단계).
 *
 * <p>동의 여부가 여기 있는 것은 {@code consentedUser} 게이트 때문이다. 동의 <b>문서</b>를
 * 다루는 것은 {@code consent} 의 일이고, 이 포트는 "지금 이 요청을 막을 것인가"만 묻는다.
 */
public interface AuthenticatedUsers {

    /** 없으면 {@code null}. */
    AuthenticatedUser find(UUID id);

    boolean hasPendingConsents(UUID id);
}
