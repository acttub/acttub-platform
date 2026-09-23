package com.acttub.actingapi.feature.challenge.adapter.web;

import java.util.UUID;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.OutputLanguage;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

/** 챌린지는 한국어 앱 회원 전용이다. 게스트·웹·다른 언어는 403 member_only. */
@Component
class ChallengeMembers {
    private final AccessGate auth;
    ChallengeMembers(AccessGate auth) { this.auth = auth; }

    UUID member(HttpServletRequest request) {
        var user = auth.gatedUser(request);
        String client = request.getHeader("X-Acttub-Client");
        if (user.guest() || client == null || !client.startsWith("app/") || !OutputLanguage.isKorean()) {
            throw new ApiException(403, "member_only");
        }
        return user.id();
    }
}
