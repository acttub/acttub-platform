package com.acttub.actingapi.security;

import java.util.UUID;

/**
 * 액세스 토큰에서 주체를 꺼낸다. 토큰을 <b>발급</b>하는 것은 {@code auth} 의 일이고, 요청마다
 * 그것을 <b>검증</b>하는 것은 배관의 일이라 여기에 포트로 선언한다.
 *
 * <p><b>실패를 예외가 아니라 {@code null} 로 알린다.</b> 예외 타입을 두면 그것이 어느 패키지의
 * 것이냐는 문제가 따라오고, 제공자 쪽에 두는 순간 포트 시그니처에 제공자 이름이 보이게 된다
 * (ADR-017). 부르는 쪽은 {@link CurrentUserService} 하나뿐이고 거기서 401 로 바꾼다.
 */
public interface AccessTokenVerifier {

    /** 유효하면 주체의 id, 서명·만료·타입 중 하나라도 어긋나면 {@code null}. */
    UUID verifyAccessToken(String token);
}
