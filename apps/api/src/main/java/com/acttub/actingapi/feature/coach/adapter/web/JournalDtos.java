package com.acttub.actingapi.feature.coach.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.ActorJournal;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** 배우 일지(practice.journal, SOMA-720)의 요청·응답. 요청은 unknown key 를 거부한다. */
final class JournalDtos {
    private JournalDtos() {
    }

    @Schema(name = "JournalPracticeBasis")
    enum BasisValue { actor_report, observed, discussed }

    @Schema(name = "JournalCharacterAspect")
    enum AspectValue { wants, partner, situation }

    @Schema(name = "JournalFeedbackGiver")
    enum GiverValue { coach, other }

    @Schema(name = "JournalDraftStatus")
    enum DraftStatusValue { pending, ready, failed, skipped }

    /** 질문 1 「해 보니 어땠어요?」. 고른 선택지와 직접 쓴 글. */
    @Schema(name = "JournalFeeling", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Feeling(@Size(max = 30) @Schema(nullable = true) String choice, @Size(max = 300) @Schema(nullable = true) String text) {
    }

    /** 질문 2 「아직 헷갈리거나 궁금한 게 있어요?」. none 은 「없어요」. */
    @Schema(name = "JournalUnknown", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Unknown(@Schema(nullable = true) Boolean none, @Size(max = 300) @Schema(nullable = true) String text) {
    }

    /** 질문 3 「다음엔 뭘 해 볼래요?」. undecided 는 「아직 안 정했어요」. */
    @Schema(name = "JournalNext", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Next(@Schema(nullable = true) Boolean undecided, @Size(max = 300) @Schema(nullable = true) String text) {
    }

    /** 고정 질문 4개의 답. 건너뛴 질문은 null(또는 생략)이다. review 는 질문 4 「오늘 연습을 한 줄로 남긴다면?」. */
    @Schema(name = "JournalAnswers", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Answers(
            @Valid @Schema(nullable = true) Feeling feeling,
            @Valid @Schema(nullable = true) Unknown unknown,
            @Valid @Schema(nullable = true) Next next,
            @Size(max = 300) @Schema(nullable = true) String review) {

        ActorJournal.Answers toDomain() {
            return new ActorJournal.Answers(
                    feeling == null ? null : new ActorJournal.Feeling(feeling.choice(), feeling.text()),
                    unknown == null ? null : new ActorJournal.Unknown(Boolean.TRUE.equals(unknown.none()), unknown.text()),
                    next == null ? null : new ActorJournal.Next(Boolean.TRUE.equals(next.undecided()), next.text()),
                    review);
        }

        static Answers of(ActorJournal.Answers answers) {
            return new Answers(
                    answers.feeling() == null ? null : new Feeling(answers.feeling().choice(), answers.feeling().text()),
                    answers.unknown() == null ? null : new Unknown(answers.unknown().none(), answers.unknown().text()),
                    answers.next() == null ? null : new Next(answers.next().undecided(), answers.next().text()),
                    answers.review());
        }
    }

    @Schema(name = "JournalCreateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CreateRequest(@NotNull @Valid @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Answers answers) {
    }

    /** 오늘 한 연습 한 줄. */
    @Schema(name = "JournalPracticeItem", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PracticeItem(@NotNull @Size(max = 200) @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text,
            @Schema(nullable = true) BasisValue basis) {
    }

    /** 장면과 인물 한 줄 — wants(원하는 것)·partner(상대)·situation(직전 상황). */
    @Schema(name = "JournalCharacterItem", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CharacterItem(@NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) AspectValue aspect,
            @NotNull @Size(max = 200) @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text) {
    }

    /** 받은 피드백 한 줄. at 은 영상 시간(초), 없으면 null. */
    @Schema(name = "JournalFeedbackItem", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record FeedbackItem(@NotNull @Size(max = 200) @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text,
            @Schema(nullable = true) GiverValue giver,
            @Min(0) @Max(86400) @Schema(nullable = true) Integer at) {
    }

    @Schema(name = "JournalUpdateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record UpdateRequest(
            @NotNull @Valid @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Answers answers,
            @NotNull @Size(max = 5) @Valid @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PracticeItem> practice,
            @NotNull @Size(max = 5) @Valid @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<CharacterItem> character,
            @NotNull @Size(max = 5) @Valid @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<FeedbackItem> feedback) {

        ActorJournal.Draft draft() {
            return new ActorJournal.Draft(
                    practice.stream().map(item -> new ActorJournal.PracticeItem(item.text(),
                            item.basis() == null ? null : item.basis().name())).toList(),
                    character.stream().map(item -> new ActorJournal.CharacterItem(item.aspect().name(), item.text())).toList(),
                    feedback.stream().map(item -> new ActorJournal.FeedbackItem(item.text(),
                            item.giver() == null ? null : item.giver().name(), item.at())).toList());
        }
    }

    /**
     * @param draftStatus pending(자동 칸을 만드는 중)·ready·failed(만들지 못해 배우 답만)·skipped(대화가 없어 만들지 않음)
     * @param practice 오늘 한 연습(AI 칸) @param character 장면과 인물(AI 칸) @param feedback 받은 피드백(AI 칸)
     * @param editedAt 배우가 마지막으로 고친 때. 고친 적 없으면 null
     * @param title 장면 제목(사람·AI 가 붙인 것). 없으면 null — 화면은 목적·날짜로 대신한다
     * @param purpose 코칭 목적 evaluate·stuck·character·concern. 목적 없이 한 코칭은 null
     * @param roleName 배역 이름(AI 가 알아본 인물, 없으면 배우가 적은 짧은 인물 칸). 모르면 null
     */
    @Schema(name = "PracticeJournal", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record JournalResponse(
            UUID id,
            UUID practiceId,
            @Schema(nullable = true) UUID conversationId,
            Answers answers,
            DraftStatusValue draftStatus,
            List<PracticeOut> practice,
            List<CharacterOut> character,
            List<FeedbackOut> feedback,
            @Schema(nullable = true) Instant editedAt,
            Instant createdAt,
            Instant updatedAt,
            @Schema(nullable = true) String title,
            @Schema(nullable = true) String purpose,
            @Schema(nullable = true) String roleName) {

        static JournalResponse of(ActorJournal.View view) {
            return new JournalResponse(view.id(), view.practiceId(), view.conversationId(), Answers.of(view.answers()),
                    DraftStatusValue.valueOf(view.draftStatus()),
                    view.draft().practice().stream().map(item -> new PracticeOut(item.text(), item.basis())).toList(),
                    view.draft().character().stream().map(item -> new CharacterOut(item.aspect(), item.text())).toList(),
                    view.draft().feedback().stream().map(item -> new FeedbackOut(item.text(), item.giver(), item.at())).toList(),
                    view.editedAt(), view.createdAt(), view.updatedAt(), view.title(), view.purpose(), view.roleName());
        }
    }

    @Schema(name = "JournalPracticeLine", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PracticeOut(String text, String basis) {
    }

    @Schema(name = "JournalCharacterLine", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CharacterOut(String aspect, String text) {
    }

    @Schema(name = "JournalFeedbackLine", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record FeedbackOut(String text, String giver, @Schema(nullable = true) Integer at) {
    }
}
