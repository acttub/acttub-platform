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
        user.requireUsable();
        request.setAttribute(ATTRIBUTE, user);
        return user;
    }

    public AuthenticatedUser optional(HttpServletRequest request) {
        return request.getHeader("Authorization") == null ? null : require(request);
    }
}
