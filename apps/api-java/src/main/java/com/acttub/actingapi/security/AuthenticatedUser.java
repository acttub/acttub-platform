package com.acttub.actingapi.security;

import java.util.UUID;

import com.acttub.actingapi.schema.UserStatus;

/**
 * 인증된 요청 주체. <b>어느 도메인의 것도 아닌 교환 타입이다</b> (ADR-017).
 *
 * <p>여기 있는 이유는 방향이다 — 이 record 가 {@code auth} 에 살면 이것을 받는 여덟 도메인이
 * 전부 {@code auth} 를 import 하게 되고, 그러면 포트를 어디에 선언하든 소비자 → 제공자 간선이
 * 남는다. 6단계에서 {@code SyncOperationBegin} 을 {@code ledger} 로 올려 푼 매듭과 같은 형태다.
 *
 * <p>소비자 여덟은 {@link #id()} 만 쓴다. {@code email}·{@code status} 는 로그인 응답을 만드는
 * {@code auth} 자신을 위한 것이다.
 */
public record AuthenticatedUser(UUID id, String email, UserStatus status) {
}
