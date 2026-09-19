package com.acttub.actingapi.feature.push.adapter.web;

import java.util.List;

import com.acttub.actingapi.feature.push.adapter.web.PushDtos.RegisterPushTokenRequest;
import com.acttub.actingapi.feature.push.adapter.web.PushDtos.UnregisterPushTokenRequest;
import com.acttub.actingapi.feature.push.app.PushService;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.ClientAddress;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 푸시 수신 단말의 등록·해제. 둘 다 멱등이라 재시도에 안전하고, 그래서 둘 다 204 다.
 * 어느 단말로 보낼지는 서버가 판단하지 않는다 — 로그인한 앱이 자기 토큰을 맡길 뿐이다.
 */
@RestController
@RequestMapping("/v2/push-tokens")
class PushController {
    private final PushService push;
    private final AccessGate auth;
    private final FixedWindowRateLimiter limiter;
    private final ClientAddress addresses;

    PushController(PushService push, AccessGate auth, FixedWindowRateLimiter limiter, ClientAddress addresses) {
        this.push = push;
        this.auth = auth;
        this.limiter = limiter;
        this.addresses = addresses;
    }

    @Operation(
            summary = "Register Push Token",
            description = """
                    이 단말의 Expo push token 을 현재 회원 것으로 등록한다. 멱등. 보호 기능이라 동의와 프로필이
                    끝난 회원만 부를 수 있다 — 동의 전에는 기기 정보를 받지 않는다. 게스트는 403 member_only.""",
            operationId = "register_push_token_v2_push_tokens_post",
            tags = "v2-push",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Successful Response"),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping
    ResponseEntity<Void> register(
            @Valid @RequestBody RegisterPushTokenRequest body, HttpServletRequest request) {
        var user = auth.gatedUser(request);
        String token = requireToken(body.token());
        if (!PushService.PLATFORMS.contains(body.platform())) {
            throw ApiValidationException.valueError(
                    List.of("body", "platform"),
                    "platform must be one of: ios, android",
                    body.platform());
        }
        push.register(user.id(), token, body.platform());
        return ResponseEntity.noContent().build();
    }

    @Operation(
            summary = "Unregister Push Token",
            description = """
                    이 단말의 토큰을 지운다. 로그아웃의 첫 단계와, 로그아웃 때 실패한 삭제의 다음 실행 재시도에서
                    부른다. 멱등. <b>로그인 없이 받는다</b> — 푸시 토큰을 갖고 있다는 것이 본인 확인이고, 주인을
                    따지지 않고 그 토큰 행을 지운다. 한 IP 에서 분당 60회까지다.""",
            operationId = "unregister_push_token_v2_push_tokens_delete",
            tags = "v2-push")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Successful Response"),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @DeleteMapping
    ResponseEntity<Void> unregister(
            @Valid @RequestBody UnregisterPushTokenRequest body, HttpServletRequest request) {
        if (!limiter.allow("push-delete-ip:" + addresses.of(request), 60)) {
            throw new ApiException(429, "rate limit exceeded");
        }
        push.unregister(requireToken(body.token()));
        return ResponseEntity.noContent().build();
    }

    private static String requireToken(String raw) {
        String token = raw == null ? "" : raw.trim();
        if (token.isEmpty() || token.length() > 512) {
            throw ApiValidationException.valueError(
                    List.of("body", "token"),
                    "token must be a non-empty string of at most 512 characters",
                    raw);
        }
        return token;
    }
}
