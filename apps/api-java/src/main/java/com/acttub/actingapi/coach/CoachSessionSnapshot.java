package com.acttub.actingapi.coach;

import java.util.List;
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
        List<CoachTurnSnapshot> turns) {

    public CoachSessionSnapshot {
        transcripts = List.copyOf(transcripts);
        turns = List.copyOf(turns);
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
                newTurns);
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
                turns);
    }
}
