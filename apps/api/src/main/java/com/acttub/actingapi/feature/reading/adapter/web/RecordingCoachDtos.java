package com.acttub.actingapi.feature.reading.adapter.web;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.RecordingCoachRepository.Coach;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** 리딩 녹음 코치의 요청·응답 (reading.recording-coach, 실험). 요청은 unknown key 를 거부한다. */
final class RecordingCoachDtos {
    private RecordingCoachDtos() {
    }

    @Schema(name = "RecordingCoachStartRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record StartRequest(@NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID readingSessionId) {
    }

    @Schema(name = "RecordingCoachReplyRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ReplyRequest(@NotBlank @Size(max = 1000) @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text) {
    }

    /** @param role {@code coach}·{@code actor} */
    @Schema(name = "RecordingCoachMessage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record MessageResponse(String role, String text) {
    }

    /** 코치가 영상으로 찍자고 권할 줄. 코치가 고르지 못했으면 응답의 {@code video_line} 이 {@code null} 이다. */
    @Schema(name = "RecordingCoachLine", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record LineResponse(UUID lineId, String text) {
    }

    /**
     * @param status {@code asked}(첫 차례, 배우 답을 기다림)·{@code answered}(둘째 차례까지 끝남 — 영상 권유를 보일 때)
     */
    @Schema(name = "RecordingCoach", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CoachResponse(
            UUID id,
            UUID readingSessionId,
            String status,
            List<MessageResponse> messages,
            LineResponse videoLine,
            Instant createdAt,
            Instant updatedAt) {

        static CoachResponse of(Coach coach) {
            List<MessageResponse> messages = new ArrayList<>();
            messages.add(new MessageResponse("coach", coach.firstMessage()));
            if (coach.actorReply() != null) {
                messages.add(new MessageResponse("actor", coach.actorReply()));
            }
            if (coach.secondMessage() != null) {
                messages.add(new MessageResponse("coach", coach.secondMessage()));
            }
            LineResponse line = coach.focusLineId() == null || coach.focusLineText() == null
                    ? null : new LineResponse(coach.focusLineId(), coach.focusLineText());
            return new CoachResponse(coach.id(), coach.sessionId(),
                    coach.secondMessage() == null ? "asked" : "answered",
                    List.copyOf(messages), line, coach.createdAt(), coach.updatedAt());
        }
    }
}
