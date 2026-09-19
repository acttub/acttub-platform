package com.acttub.actingapi.platform.security;

import java.util.UUID;

import com.acttub.actingapi.platform.web.ApiException;
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
        if (!acceptsDeactivated(request)) {
            user.requireUsable();
        }
        request.setAttribute(ATTRIBUTE, user);
        return user;
    }

    /**
     * 탈퇴 API 만 탈퇴한 계정의 토큰을 받는다 (account.withdraw). 탈퇴 도중 앱이 죽어 다시 누른 사람이
     * 403 을 받으면 기기의 자료를 지우는 다음 단계로 가지 못한다. 그 밖의 모든 경로는 남은 액세스
     * 토큰을 요청마다 403 {@code account_deactivated} 로 막는다.
     */
    private static boolean acceptsDeactivated(HttpServletRequest request) {
        String path = request.getRequestURI();
        if (path.length() > 1 && path.endsWith("/")) {
            path = path.substring(0, path.length() - 1);
        }
        return "DELETE".equalsIgnoreCase(request.getMethod()) && "/v2/me".equals(path);
    }
}
