package com.acttub.actingapi.feature.practice.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeViews;
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

    /**
     * 회차 시작. 경험 판은 본문이 아니라 {@code X-Acttub-Contract} 헤더가 정한다. {@code title} 은 새 묶음의 제목이고
     * 선택이다(앞뒤 공백을 떼고, 비면 없는 것) — 이어하기는 받지 않는다.
     */
    @Schema(name = "PracticeCreateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CreateRequest(
            @NotNull UUID requestId,
            // 영상 없이 말로 하는 코칭(SOMA-745)은 영상을 보내지 않고 목적(stuck·character·concern)을 보낸다. 짝이 틀리면 값 모양 오류 422(배열)다.
            @Schema(nullable = true) UUID videoId,
            @Schema(nullable = true) @Valid SceneInput scene,
            @Schema(nullable = true) @Valid BlockageInput blockage,
            @Schema(nullable = true) @Size(max = PracticeRules.GROUP_TITLE_MAX_CHARS) String title,
            @Schema(nullable = true, allowableValues = {"evaluate", "stuck", "character", "concern"})
            @jakarta.validation.constraints.Pattern(regexp = "evaluate|stuck|character|concern") String sessionPurpose,
            @Schema(nullable = true, description = "얼굴 가리기. 기본 false. 켜면 분석·코치는 원본 대신 서버가 얼굴을 가린 사본을 본다. 사본을 만들지 못하면(얼굴을 못 찾음 포함) 원본을 쓰지 않고 분석이 실패로 닫힌다. 원본은 지우지 않는다. 영상 없는 회차에서는 무시한다.")
            Boolean faceMosaic,
            @Schema(nullable = true, description = "리딩 녹음으로 시작(SOMA-791). 내 리딩 회차 id. 보내면 video_id·session_purpose 는 빼고, 서버가 목적을 reading 으로 둔다. 그 회차의 소리 든 내 대사 녹음이 3줄 미만이면 422 reading_voice_not_enough_audio, 남의·없는 회차면 404 session_not_found. 같은 리딩 회차로 이미 시작했으면 그 회차를 돌려준다.")
            UUID readingSessionId) {

        /**
         * 영상이 없으면 말로 하는 목적이어야 한다(SOMA-745). 영상을 빼고 목적도 없으면 예전처럼 값 모양 오류 422(배열)다.
         * 리딩 녹음으로 시작하면(SOMA-791) 영상도 목적도 보내지 않는다.
         */
        @com.fasterxml.jackson.annotation.JsonIgnore
        @Schema(hidden = true)
        @jakarta.validation.constraints.AssertTrue
        boolean isVideoOrTalkPurpose() {
            if (readingSessionId != null) return videoId == null && (sessionPurpose == null || sessionPurpose.isBlank());
            return PracticeRules.videoMatchesPurpose(videoId != null, PracticeRules.sessionPurpose(sessionPurpose));
        }
    }

    /** 이어하기. 영상을 보내지 않으면 이어받을 회차의 영상을 그대로 쓴다. 세션 목적은 묶음 첫 회차의 것을 물려받는다. */
    @Schema(name = "PracticeContinueRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ContinueRequest(
            @NotNull UUID requestId,
            @Schema(nullable = true) UUID videoId,
            @Schema(nullable = true) @Valid SceneInput scene,
            @Schema(nullable = true) @Valid BlockageInput blockage,
            @Schema(nullable = true, description = "얼굴 가리기. 생략·null 이면 이어받을 회차의 값을 그대로 쓴다. 뜻은 회차 시작과 같다.")
            Boolean faceMosaic) {
    }

    /** 분석 재시도. */
    @Schema(name = "PracticeAnalyzeRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AnalyzeRequest(@NotNull UUID requestId) {
    }

    @Schema(name = "PracticeAnalysis", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AnalysisResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"legacy", "video_record_v1"}) String format,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"ready", "partial"}) String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    anyOf = {PracticeSessionDtos.ObservationPackResponse.class, PracticeSessionDtos.VideoRecordSummaryResponse.class})
            Object summary) {
        static AnalysisResponse of(PracticeViews.AnalysisView view) {
            return new AnalysisResponse(view.id(), view.format(), view.status(),
                    view.videoRecord() == null ? PracticeSessionDtos.observationPack(view.observation())
                            : PracticeSessionDtos.videoRecord(view.videoRecord()));
        }
    }

    /** 묶음 속성. 보낸 것만 바꾼다. */
    @Schema(name = "PracticeGroupPatch", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record GroupPatchRequest(
            @Schema(nullable = true) Boolean favorite,
            @Schema(nullable = true) Boolean hidden,
            @Schema(nullable = true) @Size(max = PracticeRules.GROUP_TITLE_MAX_CHARS) String title) {
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

    /**
     * 회차 하나. {@code stage} 는 회차의 진행이고 {@code analysis_status} 는 관찰 기록의 상태다. {@code poster_url} 은
     * 그 회차 영상의 첫 장면 JPEG 의 10분 서명 주소이고, 아직 만들지 않았거나 파일을 파기했으면 {@code null} 이다.
     */
    @Schema(name = "Practice", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PracticeResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID rootId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int ordinal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID videoId,
            @Schema(nullable = true) String posterUrl,
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
            @Schema(nullable = true) JobResponse job,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
            List<PreviousConversationResponse> previousConversations,
            @Schema(nullable = true, allowableValues = {"evaluate", "stuck", "character", "concern", "reading"}) String sessionPurpose) {

        static PracticeResponse of(PracticeView view) {
            return new PracticeResponse(
                    view.id(), view.rootId(), view.ordinal(), view.videoId(), view.posterUrl(), view.stage(),
                    view.closeReason(),
                    view.experienceVersion(), view.situation(), view.characterContext(), view.goal(),
                    view.blockageKind(), view.subBranch(), view.blockageNote(), view.createdAt(),
                    view.analysisStatus(), view.conversationId(), view.conversationStatus(), view.conversationCount(),
                    view.noteId(), view.noteTitle(), view.noteKind(), JobResponse.of(view.job()),
                    view.previousConversations().stream().map(PreviousConversationResponse::of).toList(),
                    view.sessionPurpose());
        }
    }

    /**
     * 그 회차의 이전 대화 하나.
     *
     * <p>새 표는 회차당 대화 하나라 <b>거의 언제나 빈 목록</b>이다. 채워지는 것은 한 연습에 대화가 여럿인 옛
     * 자료를 호환 경로로 읽을 때뿐이다 — 가장 최근 것이 {@code conversation_id} 이고 나머지가 여기 온다.
     */
    @Schema(name = "PreviousConversation", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PreviousConversationResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt) {

        static PreviousConversationResponse of(PracticeViews.PreviousConversation view) {
            return new PreviousConversationResponse(view.id(), view.status(), view.createdAt());
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
