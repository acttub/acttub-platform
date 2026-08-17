package com.acttub.actingapi.feature.report.app;

import java.time.OffsetDateTime;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 성적표 본문과 그것이 딸린 녹화본의 위치.
 *
 * <p>{@code objectKey} 는 저장소 안의 자리일 뿐 밖으로 나가지 않는다 — 재생할 수 있는 주소로
 * 바꾸는 일은 {@link ReportPlayback} 이 한다.
 */
public record ReportDetail(
        UUID practiceSessionId,
        OffsetDateTime createdAt,
        JsonNode report,
        String objectKey) {
}
