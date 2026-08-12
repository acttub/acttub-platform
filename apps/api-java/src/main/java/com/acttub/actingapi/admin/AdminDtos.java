package com.acttub.actingapi.admin;

import java.time.OffsetDateTime;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

final class AdminDtos {
    private AdminDtos() {
    }

    @Schema(name = "AdminFunnelStep", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdminFunnelStep(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String step,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long users,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long usersReal) {
    }

    @Schema(
            name = "AdminCloseReasonCount",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdminCloseReasonCount(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String reason,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long count,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long countReal) {
    }

    @Schema(name = "AdminStats", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdminStats(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long usersTotal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long usersTotalReal,
            @JsonProperty("users_last_7d")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long usersLast7d,
            @JsonProperty("users_last_7d_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long usersLast7dReal,
            @JsonProperty("users_last_24h")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long usersLast24h,
            @JsonProperty("users_last_24h_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long usersLast24hReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long practiceSessionsTotal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long practiceSessionsTotalReal,
            @JsonProperty("practice_sessions_last_7d")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long practiceSessionsLast7d,
            @JsonProperty("practice_sessions_last_7d_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long practiceSessionsLast7dReal,
            @JsonProperty("practice_sessions_last_24h")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long practiceSessionsLast24h,
            @JsonProperty("practice_sessions_last_24h_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long practiceSessionsLast24hReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long uploadsFinalizedTotal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long uploadsFinalizedTotalReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long analysesCompletedTotal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long analysesCompletedTotalReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachSessionsTotal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachSessionsTotalReal,
            @JsonProperty("coach_sessions_last_7d")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachSessionsLast7d,
            @JsonProperty("coach_sessions_last_7d_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachSessionsLast7dReal,
            @JsonProperty("coach_sessions_last_24h")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachSessionsLast24h,
            @JsonProperty("coach_sessions_last_24h_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachSessionsLast24hReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachTurnsTotal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachTurnsTotalReal,
            @JsonProperty("coach_turns_last_7d")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachTurnsLast7d,
            @JsonProperty("coach_turns_last_7d_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachTurnsLast7dReal,
            @JsonProperty("coach_turns_last_24h")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachTurnsLast24h,
            @JsonProperty("coach_turns_last_24h_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long coachTurnsLast24hReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long reportsTotal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long reportsTotalReal,
            @JsonProperty("active_users_last_7d")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long activeUsersLast7d,
            @JsonProperty("active_users_last_7d_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long activeUsersLast7dReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long usersWithSession,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long usersWithSessionReal,
            @JsonProperty("returning_2x")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long returning2x,
            @JsonProperty("returning_2x_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long returning2xReal,
            @JsonProperty("returning_3x")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long returning3x,
            @JsonProperty("returning_3x_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long returning3xReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long usersYesterday,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long usersYesterdayReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long activeUsersYesterday,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long activeUsersYesterdayReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
            List<AdminFunnelStep> funnelSteps,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
            List<AdminCloseReasonCount> closeReasons,
            @JsonProperty("gap_stated_24h")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long gapStated24h,
            @JsonProperty("gap_stated_24h_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long gapStated24hReal,
            @JsonProperty("gap_stated_7d")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long gapStated7d,
            @JsonProperty("gap_stated_7d_real")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long gapStated7dReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long gapStatedAll,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long gapStatedAllReal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String dbSize,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long observationsTotal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) double observationsPerSummary,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true)
            OffsetDateTime lastSignupAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true)
            OffsetDateTime lastSessionAt) {
    }

    @Schema(name = "AdminTurn", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdminTurn(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int turnIndex,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String role,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text) {
    }

    @Schema(name = "AdminSession", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdminSession(
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
    record AdminSessions(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminSession> sessions,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int playbackExpiresInSec) {
    }
}
