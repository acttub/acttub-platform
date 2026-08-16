package com.acttub.actingapi.security;

import java.util.UUID;

import com.acttub.actingapi.schema.UserStatus;
import com.acttub.actingapi.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

@Service
public class CurrentUserService {

    public static final String ATTRIBUTE = CurrentUserService.class.getName() + ".user";

    private final AccessTokenVerifier tokens;
    private final AuthenticatedUsers users;

    public CurrentUserService(AccessTokenVerifier tokens, AuthenticatedUsers users) {
        this.tokens = tokens;
        this.users = users;
    }

    public AuthenticatedUser require(HttpServletRequest request) {
        if (request.getAttribute(ATTRIBUTE) instanceof AuthenticatedUser user) {
            return user;
        }
        String header = request.getHeader("Authorization");
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            throw new ApiException(401, "invalid or missing access token");
        }
        UUID userId = tokens.verifyAccessToken(header.substring(7));
        if (userId == null) {
            throw new ApiException(401, "invalid or missing access token");
        }
        AuthenticatedUser user = users.find(userId);
        if (user == null) {
            throw new ApiException(401, "invalid or missing access token");
        }
        requireUsableStatus(user.status());
        request.setAttribute(ATTRIBUTE, user);
        return user;
    }

    /**
     * 쓸 수 없는 계정 상태를 403 으로 막는다 (`auth/dependencies.py`).
     *
     * <p>탈퇴({@code deactivated})는 행을 지우지 않고 상태만 바꾼다 — 커뮤니티 글과 연습 기록이
     * {@code user_id} 를 참조하기 때문이다(`0011_user_deactivation`). 그래서 <b>이미 발급된
     * 액세스 토큰은 만료까지 유효하고</b>, 그것을 막는 것이 이 게이트뿐이다. 여기서 빠뜨리면
     * 탈퇴한 계정이 토큰 수명 동안 계속 API 를 쓴다.
     */
    private static void requireUsableStatus(UserStatus status) {
        if (status == UserStatus.SUSPENDED) {
            throw new ApiException(403, "account_suspended");
        }
        if (status == UserStatus.DEACTIVATED) {
            throw new ApiException(403, "account_deactivated");
        }
    }

    public AuthenticatedUser optional(HttpServletRequest request) {
        return request.getHeader("Authorization") == null ? null : require(request);
    }
}
