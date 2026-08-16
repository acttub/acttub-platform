package com.acttub.actingapi.platform.security;

import java.util.UUID;

import com.acttub.actingapi.schema.UserStatus;
import com.acttub.actingapi.platform.web.ApiException;

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

    /**
     * 쓸 수 없는 계정 상태를 403 으로 막는다 (`auth/dependencies.py`).
     *
     * <p>탈퇴({@code deactivated})는 행을 지우지 않고 상태만 바꾼다 — 커뮤니티 글과 연습 기록이
     * {@code user_id} 를 참조하기 때문이다(`0011_user_deactivation`). 그래서 <b>이미 발급된
     * 액세스 토큰은 만료까지 유효하고</b>, 그것을 막는 것이 이 검사뿐이다.
     *
     * <p>🔥 <b>이 판정이 한 자리에 있어야 하는 이유가 사고로 남아 있다.</b> 토큰 경로
     * ({@link CurrentUserService})와 로그인·refresh 경로({@code auth/AuthController})가 같은
     * 규칙을 두 벌로 갖고 있었고, 로그인 쪽만 {@code DEACTIVATED} 를 빠뜨려 <b>탈퇴 계정이 다시
     * 로그인됐다</b>(SOMA-306 흡수 누락). 7단계에서 패키지까지 갈렸으므로 두 벌로 두면 다음에는
     * 어긋난 것조차 보이지 않는다.
     */
    public void requireUsable() {
        if (status == UserStatus.SUSPENDED) {
            throw new ApiException(403, "account_suspended");
        }
        if (status == UserStatus.DEACTIVATED) {
            throw new ApiException(403, "account_deactivated");
        }
    }
}
