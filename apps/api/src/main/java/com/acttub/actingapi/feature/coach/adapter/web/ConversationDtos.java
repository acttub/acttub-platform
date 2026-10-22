package com.acttub.actingapi.feature.coach.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.ConversationRepository.ConversationView;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NoteView;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.feature.coach.app.PurposeView;
import com.acttub.actingapi.feature.report.app.PracticeNote;
import com.acttub.actingapi.feature.report.app.PublicReport.AnalysisReport;
import com.acttub.actingapi.feature.report.app.PublicReport.ExpressionReport;
import com.acttub.actingapi.feature.report.app.PublicReport.PublicPracticeNote;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

final class ConversationDtos {
    private static final ObjectMapper JSON = new ObjectMapper();
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
            @Schema(nullable = true) Instant createdAt,
            @Schema(nullable = true, description = "목적별 코칭(SOMA-719)의 버튼·장면·카드. 목적 없이 시작한 대화는 null")
            PurposeResponse purpose) {

        static ConversationResponse of(ConversationService.Turn turn) {
            return new ConversationResponse(
                    turn.conversationId(), null, turn.status(), turn.closeReason(), turn.revision(),
                    turn.coachReplyCount(), turn.replyLimit(),
                    turn.turns().stream()
                            .map(item -> new TurnResponse(item.turnIndex(), item.role(), CoachDisplayText.keepWhole(item.role(), item.text()), item.createdAt()))
                            .toList(),
                    null,
                    PurposeResponse.of(turn.purpose()));
        }

        static ConversationResponse of(ConversationView view, int replyLimit) {
            int coachReplies = (int) view.turns().stream().filter(turn -> "coach".equals(turn.role())).count();
            return new ConversationResponse(
                    view.id(), view.practiceId(), view.status(), view.closeReason(), view.revision(),
                    coachReplies, replyLimit,
                    view.turns().stream()
                            .map(item -> new TurnResponse(item.turnIndex(), item.role(), CoachDisplayText.keepWhole(item.role(), item.text()), item.createdAt()))
                            .toList(),
                    view.createdAt(),
                    PurposeResponse.of(view.purpose()));
        }
    }

    /**
     * 목적별 코칭(SOMA-719). 화면은 서버가 준 것을 그대로 그린다. {@code choices} 는 이번 코치 답 아래의 답 버튼이고, 누르면
     * 그 {@code label} 을 배우 답으로 보낸다(직접 쓰기는 화면이 늘 함께 둔다). 정리 뒤에는 빈 목록이다.
     */
    @Schema(name = "CoachPurpose", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PurposeResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"evaluate", "stuck", "character", "concern"}) String purpose,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    description = "evaluate: card·method·wrap / stuck: reason·line·seen·method·wrap / character: view·cell·wrap"
                            + " / 영상 없이 말로(SOMA-745) stuck: reason·line·method·wrap, character: view·cell·wrap, concern: concern·need·wrap")
            String step,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<ChoiceResponse> choices,
            @Schema(nullable = true, description = "AI가 영상에서 알아본 장면") SceneResponse scene,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "AI가 받아 적은 대사와 영상 시간(초)") List<LineResponse> lines,
            @Schema(nullable = true, description = "평가 받기의 결과 카드") ResultCardResponse card,
            @Schema(nullable = true, description = "인물 이해하기의 인물 카드") CharacterCardResponse characterCard) {

        static PurposeResponse of(PurposeView view) {
            if (view == null) return null;
            return new PurposeResponse(view.purpose(), view.step(),
                    view.choices().stream().map(c -> new ChoiceResponse(c.label(), c.at())).toList(),
                    view.scene() == null ? null
                            : new SceneResponse(view.scene().situation(), view.scene().character(), view.scene().partner()),
                    view.lines().stream().map(l -> new LineResponse(l.at(), l.text())).toList(),
                    view.card() == null ? null : new ResultCardResponse(CardItemResponse.of(view.card().good()),
                            CardItemResponse.of(view.card().issue()), CardItemResponse.of(view.card().next())),
                    view.characterCard() == null ? null : new CharacterCardResponse(view.characterCard().cells().stream()
                            .map(c -> new CharacterCellResponse(c.key(), c.label(), c.value(), c.source())).toList()));
        }
    }

    /** 답 버튼. {@code at} 은 그 버튼이 가리키는 영상 시간(초)이고 없으면 null 이다. */
    @Schema(name = "CoachChoice", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ChoiceResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String label,
            @Schema(nullable = true) Integer at) {
    }

    /** 모르는 칸은 빈 문자열이다. */
    @Schema(name = "CoachScene", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record SceneResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String situation,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String character,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String partner) {
    }

    @Schema(name = "CoachLine", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record LineResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int at,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text) {
    }

    /** 칸이 없으면 null 이다. */
    @Schema(name = "CoachResultCard", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ResultCardResponse(
            @Schema(nullable = true, description = "잘 된 곳") CardItemResponse good,
            @Schema(nullable = true, description = "아쉬운 곳") CardItemResponse issue,
            @Schema(nullable = true, description = "다음 테이크") CardItemResponse next) {
    }

    @Schema(name = "CoachResultCardItem", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CardItemResponse(
            @Schema(nullable = true) Integer at,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text) {

        static CardItemResponse of(PurposeView.CardItem item) {
            return item == null ? null : new CardItemResponse(item.at(), item.text());
        }
    }

    @Schema(name = "CoachCharacterCard", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CharacterCardResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<CharacterCellResponse> cells) {
    }

    /** {@code key}: who·before·relation·want·obstacle·action. {@code source}: 내 말·같이 찾음·영상·대본. */
    @Schema(name = "CoachCharacterCell", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CharacterCellResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String key,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String label,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String value,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String source) {
    }

    /**
     * 연습 노트. {@code kind} 는 성공·실패 표시가 아니다 — 기존 갈래는 analysis·expression, 신형은
     * action·observation·record_only 다. 초점 없이 끝난 record_only 의 제목은 NULL 이다.
     *
     * @param report 저장한 원문에서 만든 공개 응답. 내부 출처 목록과 대화 상태는 노출하지 않는다
     * @param myRating 이 사람이 이 노트에 남긴 평가. 없으면 null. 노트 조회만 채운다 — 코치 응답에 실린 노트는
     *        방금 만든 것이라 언제나 null 이다
     */
    @Schema(name = "CoachNoteQuote", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record NoteQuote(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String quote,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"actor", "observation"}) String kind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String sourceRef) { }

    @Schema(name = "CoachNote", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record NoteResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID conversationId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String format,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String kind,
            @Schema(nullable = true) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<NoteQuote> summaryQuotes,
            @Schema(nullable = true) String nextTake,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> actorWords,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> corrections,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> tags,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean fallback,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long sourceRevision,
            @Schema(nullable = true, anyOf = {AnalysisReport.class, ExpressionReport.class, PublicPracticeNote.class}) JsonNode report,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt,
            @Schema(nullable = true) NoteRatingDtos.NoteRatingResponse myRating) {

        static NoteResponse of(NoteView view) {
            return of(view, null);
        }

        static NoteResponse of(NoteView view, NoteRatingDtos.NoteRatingResponse myRating) {
            return view == null
                    ? null
                    : new NoteResponse(
                            view.id(), view.conversationId(), view.format(), view.kind(), view.title(),
                            JSON.convertValue(view.summaryQuotes(), new TypeReference<List<NoteQuote>>() { }),
                            view.nextTake(), strings(view.actorWords()), strings(view.corrections()),
                            strings(view.tags()), view.fallback(), view.sourceRevision(),
                            PracticeNote.publicView(view.legacyReport()),
                            view.createdAt(),
                            myRating);
        }

        private static List<String> strings(JsonNode value) {
            return JSON.convertValue(value, new TypeReference<List<String>>() { });
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
                    ConversationResponse.of(turn), CoachDisplayText.keepWhole("coach", turn.coachMessage()), NoteResponse.of(turn.note()));
        }
    }
}
