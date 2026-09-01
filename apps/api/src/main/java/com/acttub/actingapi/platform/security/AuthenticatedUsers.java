package com.acttub.actingapi.platform.security;

import java.util.UUID;

/**
 * 요청을 통과시킬지 정하는 데 필요한 만큼의 사용자 조회. 구현은 사용자를 소유한 쪽
 * ({@code auth}) 이 한다 — 위임만 하는 어댑터를 끼우지 않는다 (ADR-017, SOMA-397 6단계).
 *
 * <p>동의 여부는 여기 없다. 종전에는 이 포트가 그것까지 물어 {@code auth} 가 동의 테이블을
 * 직접 읽었는데, 그 데이터의 주인은 {@code consent} 다 — 한 포트는 한 쪽만 구현할 수 있으므로
 * 소유가 갈리면 포트도 갈린다. 게이트는 {@link RequiredConsentGate} 가 묻는다
 * (SOMA-397 12단계).
 */
public interface AuthenticatedUsers {

    /** 없으면 {@code null}. */
    AuthenticatedUser find(UUID id);
}
