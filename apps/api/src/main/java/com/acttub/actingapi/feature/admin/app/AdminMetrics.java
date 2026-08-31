package com.acttub.actingapi.feature.admin.app;

import java.time.OffsetDateTime;
import java.util.List;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 관리자가 보는 세션의 공개 스키마.
 *
 * <p>이 도메인은 <b>읽어 온 것이 곧 응답</b>이라 형태를 web 이 아니라 여기에 둔다 —
 * {@code report/app/PublicReport}·{@code admissions/app/Admissions} 와 같은 자리다.
 *
 * <p>지표 한 벌({@code AdminStats} 와 그 조각 셋)이 여기 있었고 {@code /v2/admin/stats} 와
 * 함께 은퇴했다 (SOMA-462).
 */
public final class AdminMetrics {
    private AdminMetrics() {
    }

    @Schema(name = "AdminTurn", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminTurn(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int turnIndex,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String role,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text) {
    }

    @Schema(name = "AdminSession", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminSession(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String coachSessionId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String closeReason,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String situation,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true)
            String characterContext,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String goal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminTurn> turns,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String videoUrl) {
    }

    @Schema(name = "AdminSessions", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminSessions(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminSession> sessions,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int playbackExpiresInSec) {
    }
}
