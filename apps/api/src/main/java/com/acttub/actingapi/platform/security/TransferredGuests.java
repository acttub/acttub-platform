package com.acttub.actingapi.platform.security;

import java.util.UUID;

/**
 * 앱으로 옮겨져 닫힌 게스트인가. 탈퇴로 닫힌 계정과 사유가 다르다 — 웹은 이것을 보고 "옮겼어요" 안내를
 * 띄운다. 닫힌 계정에만 묻는다.
 *
 * <p>표식은 <b>쓰인 이관 코드</b>이고 그 테이블의 주인은 {@code transfer} 다. 그래서 {@link AuthenticatedUsers}
 * ({@code auth} 가 구현한다)에 두지 않고 포트를 가른다 — 한 포트는 한 쪽만 구현하고, 소유가 갈리면 포트도
 * 갈린다 (ADR-017. {@link PendingConsentGate} 를 가른 것과 같은 판단이다). 액세스 토큰의 403 과 갱신의 401 이
 * 같은 답을 쓴다.
 */
public interface TransferredGuests {

    boolean transferredGuest(UUID userId);
}
