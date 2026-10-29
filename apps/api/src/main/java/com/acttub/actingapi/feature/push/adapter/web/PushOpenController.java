package com.acttub.actingapi.feature.push.adapter.web;

import java.util.List;

import com.acttub.actingapi.feature.push.adapter.web.PushDtos.RecordPushOpenRequest;
import com.acttub.actingapi.feature.push.app.PushService;
import com.acttub.actingapi.platform.security.AccessGate;
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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 푸시 알림을 눌러 앱을 연 한 번의 기록. 측정용이라 동의 게이트 밖이다 — 동의가 남은 회원이 알림을 눌러도
 * 눌렀다는 사실은 남는다. 대신 로그인한 회원이어야 하고(게스트 403 member_only) 한 회원당 분당 60회까지다.
 */
@RestController
@RequestMapping("/v2/push-opens")
class PushOpenController {
    private final PushService push;
    private final AccessGate auth;
    private final FixedWindowRateLimiter limiter;

    PushOpenController(PushService push, AccessGate auth, FixedWindowRateLimiter limiter) {
        this.push = push;
        this.auth = auth;
        this.limiter = limiter;
    }

    @Operation(
            summary = "Record Push Open",
            description = """
                    푸시 알림을 눌러 앱을 연 것을 기록한다. 보낸 기록과 이어 푸시로 돌아온 사람을 재는 데 쓴다.
                    로그인한 회원이면 되고 동의가 남아 있어도 받는다. 게스트는 403 member_only. 한 회원이 분당
                    60회까지다.""",
            operationId = "record_push_open_v2_push_opens_post",
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
    ResponseEntity<Void> record(
            @Valid @RequestBody RecordPushOpenRequest body, HttpServletRequest request) {
        var user = auth.rateLimitedUser(request);
        if (user.guest()) {
            throw new ApiException(403, "member_only");
        }
        if (!limiter.allow("push-open:" + user.id(), 60)) {
            throw new ApiException(429, "rate limit exceeded");
        }
        String kind = body.kind() == null ? "" : body.kind().trim();
        if (kind.isEmpty() || kind.length() > 40) {
            throw ApiValidationException.valueError(
                    List.of("body", "kind"),
                    "Value error, kind must be a non-empty string of at most 40 characters",
                    body.kind());
        }
        String reminderKind = optional(body.reminderKind(), 40, "reminder_kind");
        String templateId = optional(body.templateId(), 60, "template_id");
        if (body.platform() != null && !PushService.PLATFORMS.contains(body.platform())) {
            throw ApiValidationException.valueError(
                    List.of("body", "platform"),
                    "Value error, platform must be one of: ios, android",
                    body.platform());
        }
        push.recordOpen(user.id(), kind, reminderKind, templateId, body.platform(),
                ClientAppVersion.parse(request.getHeader("X-Acttub-Client")));
        return ResponseEntity.noContent().build();
    }

    private static String optional(String raw, int max, String field) {
        if (raw == null) {
            return null;
        }
        String value = raw.trim();
        if (value.length() > max) {
            throw ApiValidationException.valueError(
                    List.of("body", field),
                    "Value error, " + field + " must be at most " + max + " characters",
                    raw);
        }
        return value.isEmpty() ? null : value;
    }
}
