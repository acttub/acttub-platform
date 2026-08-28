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
        String theory) {

    public CoachSessionSnapshot {
        transcripts = List.copyOf(transcripts);
        turns = List.copyOf(turns);
        prior = prior == null ? PriorContext.EMPTY : prior;
        theory = theory == null || theory.isBlank() ? null : theory;
    }

    /** 접근법을 모르는 자리에서 쓰는 생성자. 기존 호출을 그대로 두기 위한 위임이다. */
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
            List<CoachTurnSnapshot> turns,
            PriorContext prior) {
        this(sessionId, practiceSessionId, summaryId, userId, observationPack, situation,
                characterContext, goal, durationMs, blockageKind, subBranch, blockageDetail,
                transcripts, conversationSummary, analysisHandoff, status, closeReason, turns,
                prior, null);
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

    public CoachSessionSnapshot withPrior(PriorContext newPrior) {
        return new CoachSessionSnapshot(
                sessionId, practiceSessionId, summaryId, userId, observationPack, situation,
                characterContext, goal, durationMs, blockageKind, subBranch, blockageDetail,
                transcripts, conversationSummary, analysisHandoff, status, closeReason, turns,
                newPrior, theory);
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
                prior,
                theory);
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
                prior,
                theory);
    }

    /** 배우가 고른 접근법을 실어 새 스냅샷을 만든다. */
    public CoachSessionSnapshot withTheory(String newTheory) {
        return new CoachSessionSnapshot(
                sessionId, practiceSessionId, summaryId, userId, observationPack, situation,
                characterContext, goal, durationMs, blockageKind, subBranch, blockageDetail,
                transcripts, conversationSummary, analysisHandoff, status, closeReason, turns,
                prior, newTheory);
    }
}
