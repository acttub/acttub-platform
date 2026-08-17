package com.acttub.actingapi.feature.analysis.app;

import java.util.UUID;

/** 분석 operation이 외부 I/O를 시작하기 전에 읽는 불변 입력 스냅샷. */
public record AnalysisContext(
        UUID operationId,
        UUID sessionId,
        String objectKey,
        String mimeType,
        String etag,
        Integer durationMs,
        String situation,
        String characterContext,
        String goal,
        String blockageKind,
        String blockageDetail) {
}
