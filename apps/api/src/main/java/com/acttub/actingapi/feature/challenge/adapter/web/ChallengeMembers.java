package com.acttub.actingapi.feature.challenge.adapter.web;

import java.util.UUID;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

/** 챌린지는 앱 회원 전용이다. 앱 언어는 따지지 않는다. 게스트·웹은 403 member_only. */
@Component
class ChallengeMembers {
    private final AccessGate auth;
    ChallengeMembers(AccessGate auth) { this.auth = auth; }

    UUID member(HttpServletRequest request) {
        var user = auth.gatedUser(request);
        String client = request.getHeader("X-Acttub-Client");
        if (user.guest() || client == null || !client.startsWith("app/")) {
            throw new ApiException(403, "member_only");
        }
        return user.id();
    }
}
