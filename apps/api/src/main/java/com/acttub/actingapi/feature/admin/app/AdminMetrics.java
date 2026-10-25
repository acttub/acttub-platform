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
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String videoUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, allowableValues = {"a", "b"},
                    description = "코치 흐름 A/B(SOMA-636). 기록이 없는 예전 대화는 null")
            String coachFlow) {
    }

    @Schema(name = "AdminSessions", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminSessions(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminSession> sessions,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int playbackExpiresInSec) {
    }

    /**
     * 자문위원 계정의 코치 대화 한 건(SOMA-622). 사람은 가명(md5(user_id) 앞 8자리)과 자문위원 목록의 이메일
     * 해시(advisors.txt 에 이미 공개된 값)로만 내고, 이메일·user id 는 싣지 않는다. 영상은 세션 목록과 같은 1시간
     * 재생 주소다(지워진 영상·서명 실패면 null). ops 는 이 해시로
     * 자기 쪽(비공개 저장소)에서 이름을 붙인다. persona 는 코치 성격 배정(a·b1)이고, 배정 기록이 없으면 null 이다.
     */
    @Schema(name = "AdminAdvisorSession", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminAdvisorSession(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String coachSessionId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String actor,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String advisorHash,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String persona,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String closeReason,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String situation,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true)
            String characterContext,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String goal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminTurn> turns,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String videoUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, allowableValues = {"a", "b"},
                    description = "코치 흐름 A/B(SOMA-636). 기록이 없는 예전 대화는 null")
            String coachFlow) {
    }

    /** ops 화면 검색용 가명(md5(user_id) 앞 8자리) → 프로필 이름. 이메일·user id 는 싣지 않는다. */
    @Schema(name = "AdminActorName", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminActorName(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String actor,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name) {
    }

    @Schema(name = "AdminActorNames", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminActorNames(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminActorName> actors) {
    }

    @Schema(name = "AdminAdvisorSessions", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminAdvisorSessions(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminAdvisorSession> sessions,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int advisorAccounts,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int playbackExpiresInSec) {
    }

    @Schema(name = "AdminFeedbackItem", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminFeedbackItem(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"exit_survey", "note_rating", "reading_rating"})
            String kind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String actor,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean isTeam,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    allowableValues = {"helpful", "not_helpful", "good", "bad"})
            String rating,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    allowableValues = {"answered", "dismissed"})
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"coach", "report", "practice_note", "reading"})
            String source,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    allowableValues = {"x", "leave", "back"})
            String trigger,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID practiceId,
            // 리딩 평가(reading_rating)만 채운다. 대본·대사는 회차 상세(/v2/admin/reading-sessions/{id})에서 읽는다.
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID readingSessionId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, allowableValues = {"read", "quiz"})
            String readingMode,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Boolean readingRecord) {
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

    /**
     * 운영 화면의 챌린지 목록 한 줄. 챌린지는 앱에 공개되는 글이라 대사·작품·인물을 싣는다.
     * 주최자는 원본 user id 대신 가명(md5 앞 8자리)이고, 팀 계정이 연 것인지는 {@code hostIsTeam} 으로만 알린다.
     * 이 응답은 live 운영 조회 전용이다 — 저장본(ops-core)에는 대사를 넣지 않는다.
     */
    @Schema(name = "AdminChallenge", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminChallenge(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String line,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String work,
            @Schema(nullable = true) String character,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"team", "member"}) String origin,
            @Schema(nullable = true, pattern = "^[0-9a-f]{8}$") String hostActor,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean hostIsTeam,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int durationDays,
            @Schema(nullable = true, type = "string", format = "date") String featuredOn,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime startsAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime endsAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"scheduled", "active", "ended"})
            String state,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"visible", "review", "hidden"})
            String moderation,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") int entries,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") int publicEntries,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") int outsideEntries,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0",
                    description = "삭제되지 않은 참여작이 받은 좋아요 수(팀 계정이 누른 것 포함)") int likes,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0",
                    description = "그중 팀 밖 배우가 누른 좋아요 수") int outsideLikes) {
    }

    @Schema(name = "AdminChallengePage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminChallengePage(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminChallenge> challenges,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") int count) {
    }

    @Schema(name = "AdminChallengeVideoPage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminChallengeVideoPage(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminChallengeVideo> entries,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") int count) {
    }

    /**
     * 운영 화면의 챌린지 참여작 댓글 한 줄. 댓글은 앱에서 다른 배우에게 보이는 글이라 본문을 싣는다.
     * 작성자·참여작 주인은 가명(md5 앞 8자리)뿐이고 팀 여부는 플래그로만 알린다. 지워진 댓글은 싣지 않는다.
     * live 운영 조회 전용이다 — 저장본(ops-core)에는 본문을 넣지 않는다.
     */
    @Schema(name = "AdminChallengeComment", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminChallengeComment(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID entryId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, pattern = "^[0-9a-f]{8}$") String entryActor,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean entryIsTeam,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"public", "private"})
            String entryVisibility,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, pattern = "^[0-9a-f]{8}$") String challengeRef,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, pattern = "^[0-9a-f]{8}$") String actor,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean actorIsTeam,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"visible", "hidden"})
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt) {
    }

    @Schema(name = "AdminChallengeCommentPage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminChallengeCommentPage(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminChallengeComment> comments,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0") int count) {
    }

    @Schema(name = "AdminChallengePlayback", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminChallengePlayback(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String playbackUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"600"}) int expiresIn) {
    }

    @Schema(name = "AdminUploadPlayback", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AdminUploadPlayback(
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
                    allowableValues = {"in_progress", "completed"})
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
