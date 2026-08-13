package com.acttub.actingapi.report;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** {@code complete_practice_report_operation}의 트랜잭션 경계. */
@Service
public class ReportOperationService {

    private final TransactionTemplate transactionTemplate;
    private final ReportOperationWork work;

    public ReportOperationService(
            PlatformTransactionManager transactionManager,
            ReportOperationWork work) {
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.transactionTemplate.setPropagationBehavior(
                TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.work = work;
    }

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
