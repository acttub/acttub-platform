package com.acttub.actingapi.feature.admin.app;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

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

    @Schema(name = "AdminFeedbackItem", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminFeedbackItem(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"exit_survey", "note_rating"})
            String kind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String actor,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean isTeam,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    allowableValues = {"helpful", "not_helpful"})
            String rating,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    allowableValues = {"answered", "dismissed"})
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"coach", "report", "practice_note"})
            String source,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    allowableValues = {"x", "leave", "back"})
            String trigger,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID practiceId) {
    }

    @Schema(name = "AdminFeedbackPage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminFeedbackPage(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminFeedbackItem> items,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1", maximum = "100") int limit,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean hasMore) {
    }

    @Schema(name = "AdminChallengeVideo", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminChallengeVideo(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, pattern = "^[0-9a-f]{8}$") String actor,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"public", "private"})
            String visibility,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"visible", "hidden_by_report"})
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"team", "member"})
            String challengeKind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, pattern = "^[0-9a-f]{8}$")
            String challengeRef,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean hasVideo) {
    }

    @Schema(name = "AdminChallengeVideoPage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminChallengeVideoPage(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminChallengeVideo> entries,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") int count) {
    }

    @Schema(name = "AdminChallengePlayback", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminChallengePlayback(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String playbackUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"600"}) int expiresIn) {
    }

    @Schema(name = "AdminReadingSession", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminReadingSession(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, pattern = "^[0-9a-f]{8}$") String actor,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String scriptTitle,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime startedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) OffsetDateTime endedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"in_progress", "completed", "stopped"})
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"read", "quiz"})
            String mode,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") int elapsedSeconds,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") int recordingCount) {
    }

    @Schema(name = "AdminReadingSessionPage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminReadingSessionPage(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminReadingSession> sessions,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") int count) {
    }

    @Schema(name = "AdminReadingLine", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminReadingLine(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1") int ordinal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"dialogue", "direction", "scene"})
            String kind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String characterName,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean inRange,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean isMine) {
    }

    @Schema(name = "AdminReadingRecording", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminReadingRecording(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID lineId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1") int attemptNo,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") int durationMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"stt", "none"})
            String transcriptSource,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String transcript,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Boolean matched) {
    }

    @Schema(name = "AdminReadingSessionDetail", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminReadingSessionDetail(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) AdminReadingSession session,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminReadingLine> lines,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminReadingRecording> recordings) {
    }

    @Schema(name = "AdminReadingPlayback", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminReadingPlayback(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String playbackUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"600"}) int expiresIn) {
    }
}
