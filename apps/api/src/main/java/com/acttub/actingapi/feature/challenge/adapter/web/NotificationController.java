package com.acttub.actingapi.feature.challenge.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.NotificationRepository.Inbox;
import com.acttub.actingapi.feature.challenge.app.NotificationService;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** 챌린지 알림함 (challenge.notification). 한국어 앱 회원 전용이다. */
@RestController
@RequestMapping("/v2/me/notifications")
class NotificationController {
    private final NotificationService notifications;
    private final ChallengeMembers members;
    NotificationController(NotificationService notifications, ChallengeMembers members) {
        this.notifications = notifications; this.members = members;
    }

    @Schema(name = "NotificationReadBefore", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Before(@NotNull @Schema(type = "string", format = "date-time") String createdAt,
                  @Schema(nullable = true, description = "그 시각의 알림 id. 묶음 키를 보내면 시각까지만 본다") String id) { }

    @Schema(name = "NotificationReadRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Read(@Schema(nullable = true, description = "연 묶음들 — 그때까지 포함된 사건 전부가 읽음") List<String> groupKeys,
                @Schema(nullable = true, description = "모두 읽음 — 이 시각(·id)까지의 알림만 읽음") @Valid Before allBefore) { }

    @Schema(name = "NotificationUnreadCount", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record Count(@Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "읽지 않은 묶음 수") long count) { }

    @GetMapping
    @Operation(summary = "List Challenge Notifications", operationId = "list_notifications_v2_me_notifications_get",
            description = """
                    묶음 20개씩, 묶음의 최신 사건 시각 역순. 인원·수는 지금도 유효한(취소·삭제·숨김·차단되지 않은) 사건만 센다.
                    이름·본문은 조회 때 조립하고 탈퇴한 행동자는 "탈퇴한 사용자"다.""",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    Inbox list(@RequestParam(required = false) String cursor, HttpServletRequest request) {
        return notifications.inbox(members.member(request), cursor);
    }

    @PostMapping("/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Read Challenge Notifications", operationId = "read_notifications_v2_me_notifications_read_post",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    void read(@Valid @RequestBody Read body, HttpServletRequest request) {
        notifications.read(members.member(request), body.groupKeys(),
                body.allBefore() == null ? null : instant(body.allBefore().createdAt()),
                body.allBefore() == null ? null : uuidOrNull(body.allBefore().id()));
    }

    private static Instant instant(String value) {
        try { return Instant.parse(value); }
        catch (java.time.format.DateTimeParseException invalid) {
            throw com.acttub.actingapi.platform.web.ApiValidationException.valueError(
                    List.of("body", "all_before", "created_at"), "Value error, invalid date-time", value);
        }
    }

    private static UUID uuidOrNull(String value) {
        if (value == null) return null;
        try { return UUID.fromString(value); } catch (IllegalArgumentException groupKey) { return null; }
    }

    @GetMapping("/unread-count")
    @Operation(summary = "Count Unread Challenge Notifications", operationId = "unread_notifications_v2_me_notifications_unread_count_get",
            tags = "v2-challenges", security = @SecurityRequirement(name = "HTTPBearer"))
    Count unread(HttpServletRequest request) { return new Count(notifications.unread(members.member(request))); }
}
