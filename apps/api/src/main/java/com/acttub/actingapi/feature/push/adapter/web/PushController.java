package com.acttub.actingapi.feature.push.adapter.web;

import java.util.List;

import com.acttub.actingapi.feature.push.adapter.web.PushDtos.RegisterPushTokenRequest;
import com.acttub.actingapi.feature.push.adapter.web.PushDtos.UnregisterPushTokenRequest;
import com.acttub.actingapi.feature.push.app.PushService;
import com.acttub.actingapi.platform.security.AccessGate;
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

    PushController(PushService push, AccessGate auth) {
        this.push = push;
        this.auth = auth;
    }

    @Operation(
            summary = "Register Push Token",
            description = "이 단말의 Expo push token 을 현재 사용자 것으로 등록한다. 멱등.",
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
        var user = auth.rateLimitedUser(request);
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
            description = "이 단말의 토큰을 지운다. 로그아웃·알림 끄기에서 부른다. 멱등.",
            operationId = "unregister_push_token_v2_push_tokens_delete",
            tags = "v2-push",
            security = @SecurityRequirement(name = "HTTPBearer"))
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
        var user = auth.rateLimitedUser(request);
        push.unregister(user.id(), requireToken(body.token()));
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
