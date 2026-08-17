package com.acttub.actingapi.platform.security;

import java.util.UUID;

/**
 * 지금 이 요청을 동의 때문에 막을 것인가.
 *
 * <p><b>{@link AuthenticatedUsers} 에서 갈라져 나왔다</b>(SOMA-397 12단계). 한 포트였을 때는
 * 사용자를 소유한 {@code auth} 가 동의 테이블까지 직접 읽었는데, 그 데이터의 주인은
 * {@code consent} 다 — 한 포트는 한 쪽만 구현할 수 있으므로 소유가 갈리면 포트도 갈린다.
 *
 * <p>답이 {@code boolean} 하나인 것은 배관이 동의 <b>문서</b>의 형태를 알 이유가 없어서다.
 * 로그인 응답에 실리는 목록은 다른 포트가 낸다({@code auth/app/PendingConsentDocuments}).
 */
public interface PendingConsentGate {

    boolean hasPending(UUID userId);
}
