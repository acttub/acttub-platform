package com.acttub.actingapi.feature.report.app;

import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/** handoff 확인 및 M4 report 생성이 사용할 소유권 검증 완료 문맥. */
public record OwnedReportSource(
        UUID practiceSessionId,
        UUID coachSessionId,
        JsonNode videoSummary,
        String branchKind,
        UUID handoffId,
        JsonNode handoffJson,
        boolean confirmed,
        UUID analysisHandoffId,
        JsonNode analysisHandoffJson) {

    public OwnedReportSource withConfirmed(boolean value) {
        return new OwnedReportSource(
                practiceSessionId,
                coachSessionId,
                videoSummary,
                branchKind,
                handoffId,
                handoffJson,
                value,
                analysisHandoffId,
                analysisHandoffJson);
    }
}
