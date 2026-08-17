package com.acttub.actingapi.feature.report.adapter.db;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.report.app.PracticeReportLedger;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 성적표 행과 원장 행을 한 트랜잭션에서 함께 남긴다.
 *
 * <p>전파를 {@code REQUIRES_NEW} 로 고정한다 — 호출한 쪽이 이미 트랜잭션 안이어도 이 두 행은
 * 자기 트랜잭션에서 커밋돼야, 뒤이어 실패하더라도 만든 성적표가 남는다.
 */
@Repository
public class PostgresPracticeReportLedger implements PracticeReportLedger {

    private final TransactionTemplate transactionTemplate;
    private final ReportOperationWork work;

    public PostgresPracticeReportLedger(
            PlatformTransactionManager transactionManager,
            ReportOperationWork work) {
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.transactionTemplate.setPropagationBehavior(
                TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.work = work;
    }

    @Override
    public boolean completePracticeReportOperation(
            UUID operationId,
            UUID leaseToken,
            UUID practiceSessionId,
            String reportType,
            JsonNode reportJson,
            UUID sourceHandoffId,
            JsonNode responsePayload,
            Instant now) {
        OffsetDateTime completedAt = (now == null ? Instant.now() : now)
                .atOffset(ZoneOffset.UTC);
        Boolean completed = transactionTemplate.execute(status -> work.execute(
                operationId,
                leaseToken,
                practiceSessionId,
                reportType,
                reportJson,
                sourceHandoffId,
                responsePayload,
                completedAt));
        return Boolean.TRUE.equals(completed);
    }
}
