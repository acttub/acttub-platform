package com.acttub.actingapi.report.app;

import java.time.OffsetDateTime;
import java.util.UUID;

/** 목록에 걸리는 성적표 한 줄. 본문은 싣지 않고 제목만 뽑아 온다. */
public record ReportSummary(
        UUID practiceSessionId,
        String reportType,
        String title,
        OffsetDateTime createdAt) {
}
