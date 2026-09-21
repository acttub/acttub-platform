package com.acttub.actingapi.feature.practice.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeViews.GroupView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.JobView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.PracticeView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.StatusView;
import com.acttub.actingapi.feature.practice.domain.PracticeRules;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

final class PracticeDtos {
    private PracticeDtos() {
    }

    /** 상황·인물·목표. 셋 모두 선택이고 각 300자까지다 — 비우면 빈 문자열로 저장한다. */
    @Schema(name = "PracticeScene", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record SceneInput(
            @Schema(nullable = true) @Size(max = PracticeRules.SCENE_MAX_CHARS) String situation,
            @Schema(nullable = true) @Size(max = PracticeRules.SCENE_MAX_CHARS) String character,
            @Schema(nullable = true) @Size(max = PracticeRules.SCENE_MAX_CHARS) String goal) {
    }

    /** 막힘. 고르지 않으면 "그 외/그 외"이고 서술은 500자까지다. */
    @Schema(name = "PracticeBlockage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record BlockageInput(
            @Schema(nullable = true) String category,
            @Schema(nullable = true) String detail,
            @Schema(nullable = true) @Size(max = PracticeRules.BLOCKAGE_NOTE_MAX_CHARS) String note) {
    }

    /** 회차 시작. 경험 판은 본문이 아니라 {@code X-Acttub-Contract} 헤더가 정한다. */
    @Schema(name = "PracticeCreateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CreateRequest(
            @NotNull UUID requestId,
            @NotNull UUID videoId,
            @Schema(nullable = true) @Valid SceneInput scene,
            @Schema(nullable = true) @Valid BlockageInput blockage) {
    }

    /** 이어하기. 영상을 보내지 않으면 이어받을 회차의 영상을 그대로 쓴다. */
    @Schema(name = "PracticeContinueRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ContinueRequest(
            @NotNull UUID requestId,
            @Schema(nullable = true) UUID videoId,
            @Schema(nullable = true) @Valid SceneInput scene,
            @Schema(nullable = true) @Valid BlockageInput blockage) {
    }

    /** 분석 재시도. */
    @Schema(name = "PracticeAnalyzeRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AnalyzeRequest(@NotNull UUID requestId) {
    }

    /** 묶음 속성. 보낸 것만 바꾼다. */
    @Schema(name = "PracticeGroupPatch", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record GroupPatchRequest(
            @Schema(nullable = true) Boolean favorite,
            @Schema(nullable = true) Boolean hidden,
            @Schema(nullable = true) @Size(max = 200) String title) {
    }

    /** 그 회차의 마지막 분석 작업. */
    @Schema(name = "PracticeJob", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record JobResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String status,
            @Schema(nullable = true) String failureReason,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int attemptCount) {

        static JobResponse of(JobView view) {
            return view == null
                    ? null
                    : new JobResponse(view.id(), view.status(), view.failureReason(), view.attemptCount());
        }
    }

    /** 회차 하나. {@code stage} 는 회차의 진행이고 {@code analysis_status} 는 관찰 기록의 상태다. */
    @Schema(name = "Practice", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PracticeResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID rootId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int ordinal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID videoId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String stage,
            @Schema(nullable = true) String closeReason,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String experienceVersion,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String situation,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String character,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String goal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String blockageCategory,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String blockageDetail,
            @Schema(nullable = true) String blockageNote,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt,
            @Schema(nullable = true) String analysisStatus,
            @Schema(nullable = true) UUID conversationId,
            @Schema(nullable = true) String conversationStatus,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int conversationCount,
            @Schema(nullable = true) UUID noteId,
            @Schema(nullable = true) String noteTitle,
            @Schema(nullable = true) String noteKind,
            @Schema(nullable = true) JobResponse job) {

        static PracticeResponse of(PracticeView view) {
            return new PracticeResponse(
                    view.id(), view.rootId(), view.ordinal(), view.videoId(), view.stage(), view.closeReason(),
                    view.experienceVersion(), view.situation(), view.characterContext(), view.goal(),
                    view.blockageKind(), view.subBranch(), view.blockageNote(), view.createdAt(),
                    view.analysisStatus(), view.conversationId(), view.conversationStatus(), view.conversationCount(),
                    view.noteId(), view.noteTitle(), view.noteKind(), JobResponse.of(view.job()));
        }
    }

    /**
     * 묶음 하나. {@code in_progress_practice_id} 가 있으면 409 뒤 그 회차로 복귀한다 — 화면이 한 번의 조회로
     * 끝내는 값이다.
     */
    @Schema(name = "PracticeGroup", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record GroupResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID rootId,
            @Schema(nullable = true) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int ordinalCount,
            @Schema(nullable = true) Instant lastConversationAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> tags,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean favorite,
            @Schema(nullable = true) Instant hiddenAt,
            @Schema(nullable = true) UUID inProgressPracticeId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PracticeResponse> practices) {

        static GroupResponse of(GroupView view) {
            return new GroupResponse(
                    view.rootId(), view.title(), view.ordinalCount(), view.lastConversationAt(), view.tags(),
                    view.favorite(), view.hiddenAt(), view.inProgressPracticeId(),
                    view.practices().stream().map(PracticeResponse::of).toList());
        }
    }

    @Schema(name = "PracticeGroupList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record GroupListResponse(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<GroupResponse> groups) {
    }

    /** 폴링이 읽는 것. 앱 4초·웹 10초다. */
    @Schema(name = "PracticeStatus", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record StatusResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String stage,
            @Schema(nullable = true) String closeReason,
            @Schema(nullable = true) String analysisStatus,
            @Schema(nullable = true) JobResponse job) {

        static StatusResponse of(StatusView view) {
            return new StatusResponse(
                    view.stage(), view.closeReason(), view.analysisStatus(), JobResponse.of(view.job()));
        }
    }
}
