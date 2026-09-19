package com.acttub.actingapi.feature.coach.app;

import java.util.List;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/** Python {@code acting_agent.schema.CoachSession}과 저장에 필요한 소유권 문맥. */
public record CoachSessionSnapshot(
        UUID sessionId,
        UUID practiceSessionId,
        UUID summaryId,
        UUID userId,
        JsonNode observationPack,
        String situation,
        String characterContext,
        String goal,
        int durationMs,
        String blockageKind,
        String subBranch,
        String blockageDetail,
        List<String> transcripts,
        String conversationSummary,
        JsonNode analysisHandoff,
        String status,
        String closeReason,
        List<CoachTurnSnapshot> turns,
        PriorContext prior,
        String experienceVersion,
        long stateRevision,
        JsonNode coachingState,
        // 배우가 저장한 완성된 프로필. 없으면 null — 그때 모델 입력은 프로필이 없던 때와 같다.
        // prior 와 같이 턴마다 새로 읽어 싣는 입력이고 저장하지 않는다.
        ActorProfile actorProfile) {

    public CoachSessionSnapshot {
        transcripts = List.copyOf(transcripts);
        turns = List.copyOf(turns);
        prior = prior == null ? PriorContext.EMPTY : prior;
    }

    /** 프로필을 모르는 자리에서 쓰는 생성자. 저장소에서 되살린 세션이 그렇다. */
    public CoachSessionSnapshot(UUID sessionId, UUID practiceSessionId, UUID summaryId,
            UUID userId, JsonNode observationPack, String situation, String characterContext,
            String goal, int durationMs, String blockageKind, String subBranch,
            String blockageDetail, List<String> transcripts, String conversationSummary,
            JsonNode analysisHandoff, String status, String closeReason,
            List<CoachTurnSnapshot> turns, PriorContext prior, String experienceVersion,
            long stateRevision, JsonNode coachingState) {
        this(sessionId, practiceSessionId, summaryId, userId, observationPack, situation,
                characterContext, goal, durationMs, blockageKind, subBranch, blockageDetail,
                transcripts, conversationSummary, analysisHandoff, status, closeReason, turns,
                prior, experienceVersion, stateRevision, coachingState, null);
    }

    /**
     * 모델에 넘길 지난 것. 완성된 프로필이 있으면 기억의 성별·나이를 뺀다 — 문자열 프롬프트와 구조화
     * 입력이 같은 것을 본다.
     */
    public PriorContext priorForModel() {
        return actorProfile == null ? prior : prior.withoutDemographics();
    }

    /**
     * 지난 것을 모르는 자리에서 쓰는 생성자. 대화를 여는 {@code coach_start} 만 prior 를
     * 채우고, 이후 턴은 DB 에서 되살린 세션이라 원본도 기본값({@code PriorContext()})이다.
     */
    public CoachSessionSnapshot(
            UUID sessionId,
            UUID practiceSessionId,
            UUID summaryId,
            UUID userId,
            JsonNode observationPack,
            String situation,
            String characterContext,
            String goal,
            int durationMs,
            String blockageKind,
            String subBranch,
            String blockageDetail,
            List<String> transcripts,
            String conversationSummary,
            JsonNode analysisHandoff,
            String status,
            String closeReason,
            List<CoachTurnSnapshot> turns) {
        this(sessionId, practiceSessionId, summaryId, userId, observationPack, situation,
                characterContext, goal, durationMs, blockageKind, subBranch, blockageDetail,
                transcripts, conversationSummary, analysisHandoff, status, closeReason, turns,
                PriorContext.EMPTY);
    }

    public CoachSessionSnapshot(UUID sessionId, UUID practiceSessionId, UUID summaryId,
            UUID userId, JsonNode observationPack, String situation, String characterContext,
            String goal, int durationMs, String blockageKind, String subBranch,
            String blockageDetail, List<String> transcripts, String conversationSummary,
            JsonNode analysisHandoff, String status, String closeReason,
            List<CoachTurnSnapshot> turns, PriorContext prior) {
        this(sessionId, practiceSessionId, summaryId, userId, observationPack, situation,
                characterContext, goal, durationMs, blockageKind, subBranch, blockageDetail,
                transcripts, conversationSummary, analysisHandoff, status, closeReason, turns,
                prior, "legacy", 0, null);
    }

    public boolean threeLayers() {
        return "three_layers_v1".equals(experienceVersion);
    }

    public CoachSessionSnapshot withCoachingState(String version, long revision,
            JsonNode state, String newStatus, String reason) {
        return new CoachSessionSnapshot(sessionId, practiceSessionId, summaryId, userId,
                observationPack, situation, characterContext, goal, durationMs, blockageKind,
                subBranch, blockageDetail, transcripts, conversationSummary, analysisHandoff,
                newStatus, reason, turns, prior, version, revision, state, actorProfile);
    }

    public CoachSessionSnapshot withPrior(PriorContext newPrior) {
        return new CoachSessionSnapshot(
                sessionId, practiceSessionId, summaryId, userId, observationPack, situation,
                characterContext, goal, durationMs, blockageKind, subBranch, blockageDetail,
                transcripts, conversationSummary, analysisHandoff, status, closeReason, turns,
                newPrior, experienceVersion, stateRevision, coachingState, actorProfile);
    }

    public CoachSessionSnapshot withActorProfile(ActorProfile newProfile) {
        return new CoachSessionSnapshot(
                sessionId, practiceSessionId, summaryId, userId, observationPack, situation,
                characterContext, goal, durationMs, blockageKind, subBranch, blockageDetail,
                transcripts, conversationSummary, analysisHandoff, status, closeReason, turns,
                prior, experienceVersion, stateRevision, coachingState, newProfile);
    }

    public CoachSessionSnapshot withTurns(List<CoachTurnSnapshot> newTurns) {
        return new CoachSessionSnapshot(
                sessionId,
                practiceSessionId,
                summaryId,
                userId,
                observationPack,
                situation,
                characterContext,
                goal,
                durationMs,
                blockageKind,
                subBranch,
                blockageDetail,
                transcripts,
                conversationSummary,
                analysisHandoff,
                status,
                closeReason,
                newTurns,
                prior, experienceVersion, stateRevision, coachingState, actorProfile);
    }

    public CoachSessionSnapshot withStatus(String newStatus) {
        return new CoachSessionSnapshot(
                sessionId,
                practiceSessionId,
                summaryId,
                userId,
                observationPack,
                situation,
                characterContext,
                goal,
                durationMs,
                blockageKind,
                subBranch,
                blockageDetail,
                transcripts,
                conversationSummary,
                analysisHandoff,
                newStatus,
                closeReason,
                turns,
                prior, experienceVersion, stateRevision, coachingState, actorProfile);
    }
}
