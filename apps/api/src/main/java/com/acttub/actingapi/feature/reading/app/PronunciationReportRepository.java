package com.acttub.actingapi.feature.reading.app;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Report;

/** 리딩 발음 보고서 장부이자 채점 작업 큐(SOMA-606). 메서드마다 자기 트랜잭션이다 — 채점(외부 호출)은 그 밖에서 한다. */
public interface PronunciationReportRepository {

    /**
     * 내 회차의 보고서. 회차가 끝났는데 보고서가 없으면 {@code queued} 로 만든다.
     *
     * @return 내 회차가 아니면 {@code null}. 끝나지 않은 회차면 상태 {@code not_ready}
     */
    ReportState findOrEnqueue(UUID userId, UUID sessionId, Instant now);

    /** 기다리는 것(또는 임대가 끝난 running) 하나를 집는다. 시도를 다 쓴 running 은 failed 로 닫는다. 없으면 {@code null}. */
    Claimed claimNext(UUID leaseToken, Duration lease, int maxAttempts, Instant now);

    /** 회차의 내 대사 줄 녹음(줄마다 최신 시도 하나), 대본 순서. */
    List<LineSource> lines(UUID sessionId);

    /** @param status {@code done} 또는 {@code skipped}. 임대를 잃었으면 {@code false} */
    boolean complete(UUID reportId, UUID leaseToken, String status, String modelVersion, Report report, Instant now);

    /** @param retry {@code true} 면 다시 queued, 아니면 failed */
    boolean fail(UUID reportId, UUID leaseToken, String failure, boolean retry, Instant now);

    /** @param resultJson 보고서 JSON. done 이 아니면 {@code null} */
    record ReportState(String status, String resultJson) {
    }

    record Claimed(UUID reportId, UUID sessionId, int attempt) {
    }

    /** @param transcript 앱이 받아쓴 글. 없으면 {@code null} */
    /** @param durationMs 앱이 잰 녹음 길이. 모르면 {@code null} */
    record LineSource(int lineNo, String text, String transcript, String objectKey, String contentType, Integer durationMs) {
    }
}
