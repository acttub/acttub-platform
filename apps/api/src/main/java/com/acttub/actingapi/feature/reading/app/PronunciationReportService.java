package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository.ReportState;
import com.acttub.actingapi.platform.web.ApiException;

/**
 * 리딩 발음 보고서 조회(SOMA-606, 실험). 끝난 회차를 처음 조회하면 채점을 큐에 넣는다 — 리딩 흐름(진행 저장)은 건드리지 않는다.
 * 앱은 리딩이 끝나면 이 조회를 부르고 {@code queued}·{@code running} 이면 잠시 뒤 다시 부른다.
 */
public class PronunciationReportService {
    private final PronunciationReportRepository reports;
    private final PronunciationSettings settings;
    private final Clock clock;

    public PronunciationReportService(PronunciationReportRepository reports, PronunciationSettings settings, Clock clock) {
        this.reports = reports;
        this.settings = settings;
        this.clock = clock;
    }

    public ReportState find(UUID userId, UUID sessionId) {
        if (!settings.allows(userId)) {
            throw new ApiException(404, "pronunciation_not_available");
        }
        ReportState state = reports.findOrEnqueue(userId, sessionId, clock.instant());
        if (state == null) {
            throw new ApiException(404, "session_not_found");
        }
        return state;
    }
}
