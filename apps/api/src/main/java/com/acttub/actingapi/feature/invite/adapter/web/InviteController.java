package com.acttub.actingapi.feature.invite.adapter.web;

import com.acttub.actingapi.feature.invite.adapter.web.InviteDtos.MeResponse;
import com.acttub.actingapi.feature.invite.adapter.web.InviteDtos.RedeemRequest;
import com.acttub.actingapi.feature.invite.app.InviteService;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 친구 초대(SOMA-865, account.invite). 스위치 {@code INVITE_ENABLED} 가 꺼져 있으면 모든 경로가 404 {@code invite_unavailable} 이고
 * 앱은 그것으로 초대 입구를 숨긴다. 실험 플래그 뒤의 기능이라 OpenAPI 에 싣지 않는다({@link Hidden}) — 계약은
 * specs/account/invite.md 가 정한다.
 *
 * <ul>
 *   <li>{@code GET /v2/invite/me} — 내 초대 코드와 코드 넣기 가능 여부</li>
 *   <li>{@code POST /v2/invite/redeem} {@code {code}} — 받은 코드 넣기</li>
 * </ul>
 */
@Hidden
@RestController
@RequestMapping("/v2/invite")
class InviteController {
    private final InviteService service;
    private final AccessGate auth;
    private final FixedWindowRateLimiter limiter;

    InviteController(InviteService service, AccessGate auth, FixedWindowRateLimiter limiter) {
        this.service = service;
        this.auth = auth;
        this.limiter = limiter;
    }

    @GetMapping("/me")
    MeResponse me(HttpServletRequest request, HttpServletResponse response) {
        noStore(response);
        AuthenticatedUser user = auth.gatedUser(request);
        return MeResponse.of(service.view(user));
    }

    @PostMapping("/redeem")
    MeResponse redeem(@Valid @RequestBody RedeemRequest body, HttpServletRequest request, HttpServletResponse response) {
        noStore(response);
        AuthenticatedUser user = auth.gatedUser(request);
        // 코드 맞히기를 막는다 — 한 사람이 1분에 10번까지.
        if (!limiter.allow("invite-redeem:" + user.id(), 10)) {
            throw new ApiException(429, "rate limit exceeded");
        }
        return MeResponse.of(service.redeem(user, body.code()));
    }

    private static void noStore(HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    }
}
