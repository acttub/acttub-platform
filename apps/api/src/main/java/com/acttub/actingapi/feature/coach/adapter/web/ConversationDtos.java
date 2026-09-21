package com.acttub.actingapi.feature.coach.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.ConversationRepository.ConversationView;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NoteView;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

final class ConversationDtos {
    private ConversationDtos() {
    }

    /** 대화 시작. 분석이 끝난 회차에서만 연다. */
    @Schema(name = "CoachStartRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record StartRequest(@NotNull UUID practiceId, @NotNull UUID requestId) {
    }

    /** 배우의 답. 300자까지이고 "그만"이라고 쓰면 언제든 마친다. */
    @Schema(name = "CoachReplyRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ReplyRequest(
            @NotNull UUID conversationId,
            @NotNull UUID requestId,
            @NotBlank @Size(max = ConversationService.ACTOR_TEXT_MAX_CHARS) String text,
            @Schema(nullable = true) Long revision) {
    }

    /** 대화의 한 턴. 저장은 옛 값과 같은 {@code ai} 이고 화면에는 {@code coach} 로 보인다. */
    @Schema(name = "CoachTurn", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record TurnResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int turnIndex,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String role,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text,
            @Schema(nullable = true) Instant createdAt) {
    }

    /**
     * 대화의 현재 상태. {@code coach_reply_count} 와 {@code reply_limit} 으로 화면이 남은 응답 수와 마무리
     * 예고를 그린다(상한은 시작 응답을 포함한다).
     */
    @Schema(name = "CoachConversation", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ConversationResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(nullable = true) UUID practiceId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String status,
            @Schema(nullable = true) String closeReason,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long revision,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int coachReplyCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int replyLimit,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<TurnResponse> messages,
            @Schema(nullable = true) Instant createdAt) {

        static ConversationResponse of(ConversationService.Turn turn) {
            return new ConversationResponse(
                    turn.conversationId(), null, turn.status(), turn.closeReason(), turn.revision(),
                    turn.coachReplyCount(), turn.replyLimit(),
                    turn.turns().stream()
                            .map(item -> new TurnResponse(item.turnIndex(), item.role(), item.text(), item.createdAt()))
                            .toList(),
                    null);
        }

        static ConversationResponse of(ConversationView view, int replyLimit) {
            int coachReplies = (int) view.turns().stream().filter(turn -> "coach".equals(turn.role())).count();
            return new ConversationResponse(
                    view.id(), view.practiceId(), view.status(), view.closeReason(), view.revision(),
                    coachReplies, replyLimit,
                    view.turns().stream()
                            .map(item -> new TurnResponse(item.turnIndex(), item.role(), item.text(), item.createdAt()))
                            .toList(),
                    view.createdAt());
        }
    }

    /**
     * 연습 노트. {@code kind} 는 성공·실패 표시가 아니다 — 기존 갈래는 analysis·expression, 신형은
     * action·observation·record_only 다. 초점 없이 끝난 record_only 의 제목은 NULL 이다.
     *
     * @param report 생성기가 낸 원문. 옛 공개 필드를 읽던 화면이 그대로 쓴다
     */
    @Schema(name = "CoachNote", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record NoteResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID conversationId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String format,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String kind,
            @Schema(nullable = true) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) JsonNode summaryQuotes,
            @Schema(nullable = true) String nextTake,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) JsonNode actorWords,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) JsonNode corrections,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) JsonNode tags,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean fallback,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long sourceRevision,
            @Schema(nullable = true) JsonNode report,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt) {

        static NoteResponse of(NoteView view) {
            return view == null
                    ? null
                    : new NoteResponse(
                            view.id(), view.conversationId(), view.format(), view.kind(), view.title(),
                            view.summaryQuotes(), view.nextTake(), view.actorWords(), view.corrections(),
                            view.tags(), view.fallback(), view.sourceRevision(), view.legacyReport(),
                            view.createdAt());
        }
    }

    /** 한 턴의 결과 — 대화의 현재 상태, 이번 코치 응답, 그리고 종료라면 노트. */
    @Schema(name = "CoachTurnResult", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record TurnResultResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ConversationResponse conversation,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String message,
            @Schema(nullable = true) NoteResponse note) {

        static TurnResultResponse of(ConversationService.Turn turn) {
            return new TurnResultResponse(
                    ConversationResponse.of(turn), turn.coachMessage(), NoteResponse.of(turn.note()));
        }
    }
}
