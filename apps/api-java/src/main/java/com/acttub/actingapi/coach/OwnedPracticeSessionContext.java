package com.acttub.actingapi.coach;

import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/** coach/start가 소유권 확인 뒤 외부 호출에 쓰는 practice-session 입력 묶음. */
public record OwnedPracticeSessionContext(
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
        JsonNode analysisHandoff) {

    public OwnedPracticeSessionContext {
        transcripts = List.copyOf(transcripts);
    }

    public CoachSessionSnapshot newCoachSession(UUID sessionId) {
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
                "",
                analysisHandoff,
                "open",
                "",
                List.of());
    }
}
