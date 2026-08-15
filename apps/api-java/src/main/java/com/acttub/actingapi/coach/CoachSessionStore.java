package com.acttub.actingapi.coach;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.report.OwnedReportSource;
import com.acttub.actingapi.report.ReportSourceProvider;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Python {@code PostgresStore}의 coach-session 저장 경계. */
@Repository
public class CoachSessionStore implements ReportSourceProvider {

    private final CoachSessionWork work;
    private final TransactionTemplate transactionTemplate;

    public CoachSessionStore(
            CoachSessionWork work,
            PlatformTransactionManager transactionManager) {
        this.work = work;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    public OwnedCoachSessionContext getOwnedCoachSession(
            UUID userId,
            UUID coachSessionId) {
        return transactionTemplate.execute(status -> {
            CoachSessionSnapshot session = work.loadSession(
                    coachSessionId, userId, false);
            return session == null
                    ? null
                    : new OwnedCoachSessionContext(
                            session.practiceSessionId(), session);
        });
    }

    public OwnedCoachSessionContext getOldestOpenCoachSession(
            UUID userId,
            UUID practiceSessionId) {
        return transactionTemplate.execute(status -> {
            UUID coachSessionId = work.findOldestOpenCoachSessionId(
                    userId, practiceSessionId);
            if (coachSessionId == null) {
                return null;
            }
            CoachSessionSnapshot session = work.loadSession(
                    coachSessionId, userId, false);
            return session == null
                    ? null
                    : new OwnedCoachSessionContext(
                            session.practiceSessionId(), session);
        });
    }

    public String getPracticeSessionStatus(UUID userId, UUID practiceSessionId) {
        return transactionTemplate.execute(
                status -> work.practiceSessionStatus(userId, practiceSessionId));
    }

    public OwnedPracticeSessionContext getOwnedPracticeSessionContext(
            UUID userId, UUID practiceSessionId) {
        return transactionTemplate.execute(
                status -> work.ownedPracticeSessionContext(userId, practiceSessionId));
    }

    public boolean hasReportForPracticeSession(UUID practiceSessionId) {
        return Boolean.TRUE.equals(transactionTemplate.execute(
                status -> work.hasReportForPracticeSession(practiceSessionId)));
    }

    public JsonNode getPracticeReportForHandoff(UUID handoffId) {
        return transactionTemplate.execute(
                status -> work.practiceReportForHandoff(handoffId));
    }

    /** 저장소 수준 optimistic-lock 검증을 위한 transaction boundary. */
    public void saveCoachSession(CoachSessionSnapshot session, Instant now) {
        OffsetDateTime savedAt = utc(now);
        transactionTemplate.executeWithoutResult(
                status -> work.saveCoachSession(session, savedAt));
    }

    public boolean completeCoachStartOperation(
            UUID operationId,
            UUID leaseToken,
            CoachSessionSnapshot coachSession,
            JsonNode responsePayload,
            UUID handoffId,
            String branchKind,
            JsonNode handoffJson,
            boolean confirmed,
            JsonNode reportJson,
            boolean restart,
            Instant now) {
        OffsetDateTime completedAt = utc(now);
        Boolean completed = transactionTemplate.execute(status -> {
            CoachSessionWork.OperationRow operation =
                    work.requireCoachStartOperation(operationId);
            CoachSessionSnapshot storedSession = confirmed
                    ? coachSession.withStatus("closed")
                    : coachSession;
            if (restart) {
                work.closeOpenCoachSessions(
                        operation.practiceSessionId(), completedAt);
            }
            work.addCoachSession(storedSession);
            if (handoffId != null && branchKind != null && handoffJson != null) {
                work.addHandoff(
                        handoffId,
                        storedSession.sessionId(),
                        operation.practiceSessionId(),
                        branchKind,
                        handoffJson,
                        confirmed,
                        completedAt);
                work.addPracticeReportIfPresent(
                        operation.practiceSessionId(),
                        handoffId,
                        reportJson,
                        completedAt);
            }
            work.finishExternalOperation(
                    operationId, leaseToken, responsePayload, completedAt);
            return true;
        });
        return Boolean.TRUE.equals(completed);
    }

    public boolean completeCoachReplyOperation(
            UUID operationId,
            UUID leaseToken,
            CoachSessionSnapshot coachSession,
            JsonNode responsePayload,
            UUID handoffId,
            String branchKind,
            JsonNode handoffJson,
            boolean confirmed,
            JsonNode reportJson,
            Instant now) {
        OffsetDateTime completedAt = utc(now);
        Boolean completed = transactionTemplate.execute(status -> {
            CoachSessionWork.OperationRow operation =
                    work.requireCoachReplyOperation(operationId);
            CoachSessionSnapshot storedSession = confirmed
                    ? coachSession.withStatus("closed")
                    : coachSession;
            work.saveCoachSession(storedSession, completedAt);
            if (handoffId != null && branchKind != null && handoffJson != null) {
                work.addHandoff(
                        handoffId,
                        storedSession.sessionId(),
                        operation.practiceSessionId(),
                        branchKind,
                        handoffJson,
                        confirmed,
                        completedAt);
                work.addPracticeReportIfPresent(
                        operation.practiceSessionId(), handoffId, reportJson, completedAt);
            }
            work.finishExternalOperation(
                    operationId, leaseToken, responsePayload, completedAt);
            return true;
        });
        return Boolean.TRUE.equals(completed);
    }

    public OwnedReportSource getOwnedReportSource(
            UUID userId,
            UUID coachSessionId) {
        return transactionTemplate.execute(
                status -> work.ownedReportSource(userId, coachSessionId));
    }

    public OwnedReportSource confirmLatestHandoff(
            UUID userId,
            UUID coachSessionId,
            boolean confirmed,
            String rebuttalText,
            Instant now) {
        OffsetDateTime confirmedAt = utc(now);
        return transactionTemplate.execute(status -> {
            OwnedReportSource source = work.ownedReportSource(
                    userId, coachSessionId);
            if (source == null || source.handoffId() == null) {
                return source;
            }
            work.upsertHandoffConfirmation(
                    source.handoffId(),
                    confirmed,
                    rebuttalText,
                    confirmedAt);
            if (confirmed) {
                work.closeCoachSession(coachSessionId, confirmedAt);
            }
            return source.withConfirmed(confirmed);
        });
    }

    private OffsetDateTime utc(Instant value) {
        return (value == null ? Instant.now() : value).atOffset(ZoneOffset.UTC);
    }
}
