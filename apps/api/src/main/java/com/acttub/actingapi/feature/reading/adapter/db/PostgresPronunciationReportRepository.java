package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Report;
import com.acttub.actingapi.platform.schema.ReadingSessionStatus;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 리딩 발음 보고서 장부이자 채점 작업 큐의 Postgres 구현. 문장은 {@link ReadingPronunciationReportJpaRepository} 에 있다.
 *
 * <p>집기는 잠가 읽기({@code for update … skip locked})와 임대 적기 두 문장이다. 잠근 행은 이 트랜잭션이 끝날 때까지 다른 워커가
 * 건너뛰므로 읽은 시도 수에 1 을 더한 값이 방금 적은 값이다(apps/api/CONTRACT.md §5-9).
 */
@Repository
class PostgresPronunciationReportRepository implements PronunciationReportRepository {
    private final ReadingPronunciationReportJpaRepository reports;
    private final ReadingSessionJpaRepository sessions;
    private final ReadingRecordingJpaRepository recordings;
    private final TransactionTemplate transaction;
    private final ObjectMapper mapper;

    PostgresPronunciationReportRepository(ReadingPronunciationReportJpaRepository reports, ReadingSessionJpaRepository sessions,
            ReadingRecordingJpaRepository recordings, PlatformTransactionManager transactionManager, ObjectMapper mapper) {
        this.reports = reports;
        this.sessions = sessions;
        this.recordings = recordings;
        this.transaction = new TransactionTemplate(transactionManager);
        this.mapper = mapper;
    }

    @Override
    public ReportState findOrEnqueue(UUID userId, UUID sessionId, Instant now) {
        return transaction.execute(status -> {
            ReadingSessionStatus session = sessions.statusOf(sessionId, userId).orElse(null);
            if (session == null) {
                return null;
            }
            if (session != ReadingSessionStatus.COMPLETED) {
                return new ReportState("not_ready", null);
            }
            reports.enqueue(UUID.randomUUID(), sessionId, userId, now);
            ReadingPronunciationReportJpaRepository.State row = reports.state(sessionId).orElseThrow();
            Progress progress = "running".equals(row.getStatus()) && row.getProgressDone() != null && row.getProgressTotal() != null
                    ? new Progress(row.getProgressDone(), row.getProgressTotal()) : null;
            return new ReportState(row.getStatus(), row.getResult(), progress);
        });
    }

    @Override
    public Claimed claimNext(UUID leaseToken, Duration lease, int maxAttempts, Instant now) {
        return transaction.execute(status -> {
            reports.closeExhausted(now, maxAttempts);
            List<ReadingPronunciationReportJpaRepository.Claimable> next = reports.lockNext(now, maxAttempts, Limit.of(1));
            if (next.isEmpty()) {
                return null;
            }
            ReadingPronunciationReportJpaRepository.Claimable row = next.getFirst();
            UUID reportId = row.getId();
            UUID sessionId = row.getReadingSessionId();
            int attempt = row.getAttemptCount() + 1;
            reports.lease(reportId, leaseToken, now.plus(lease), now);
            return new Claimed(reportId, sessionId, attempt);
        });
    }

    @Override
    public List<LineSource> lines(UUID sessionId) {
        return transaction.execute(status -> recordings.spokenLines(sessionId).stream()
                .map(row -> new LineSource(row.getLineNo(), row.getText(), row.getTranscript(), row.getObjectKey(),
                        row.getContentType(), row.getDurationMs()))
                .toList());
    }

    @Override
    public boolean complete(UUID reportId, UUID leaseToken, String status, String modelVersion, Report report, Instant now) {
        String json;
        try {
            json = mapper.writeValueAsString(report);
        } catch (JacksonException failure) {
            throw new IllegalStateException(failure);
        }
        Integer updated = transaction.execute(tx -> reports.complete(reportId, leaseToken, status, modelVersion, json, now));
        return updated != null && updated == 1;
    }

    @Override
    public boolean fail(UUID reportId, UUID leaseToken, String failure, boolean retry, Instant now) {
        Integer updated = transaction.execute(tx ->
                reports.fail(reportId, leaseToken, retry ? "queued" : "failed", failure, now));
        return updated != null && updated == 1;
    }

    @Override
    public boolean progress(UUID reportId, UUID leaseToken, int done, int total) {
        Integer updated = transaction.execute(tx -> reports.progress(reportId, leaseToken, done, total));
        return updated != null && updated == 1;
    }

    @Override
    public Optional<ReportOwner> owner(UUID reportId) {
        return reports.owner(reportId).map(row -> new ReportOwner(row.getUserId(), row.getCreatedAt()));
    }
}
