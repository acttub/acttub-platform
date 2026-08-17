package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.CoachSessionLedger;
import com.acttub.actingapi.feature.coach.app.CoachSessionNotFound;
import com.acttub.actingapi.feature.coach.app.CoachSessionRepository;
import com.acttub.actingapi.feature.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.feature.coach.app.OwnedCoachSessionContext;
import com.acttub.actingapi.feature.coach.app.OwnedPracticeSessionContext;
import com.acttub.actingapi.feature.report.app.OwnedReportSource;
import com.acttub.actingapi.feature.report.app.ReportSourceProvider;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 코치 세션의 조회·저장 포트를 손으로 쓴 SQL 로 구현한다 (Python {@code PostgresStore}).
 *
 * <p><b>이 클래스가 트랜잭션 경계다.</b> 실제 SQL 은 {@link CoachSessionWork} 가 갖고 있고 그쪽에는
 * 경계가 없다 — 어느 쿼리들이 한 트랜잭션인지가 여기 한 파일에 모여 보이게 하기 위해서다.
 *
 * <p>포트 셋을 함께 구현한다. {@link CoachSessionRepository}·{@link CoachSessionLedger} 는 코치
 * 자신의 요구이고, {@link ReportSourceProvider} 는 <b>성적표 쪽의 요구</b>다 — 성적표를 만드는
 * 쪽이 무엇이 필요한지 선언하고 코치가 그것을 만족시킨다(ADR-017).
 */
@Repository
public class PostgresCoachSessionRepository
        implements CoachSessionRepository, CoachSessionLedger, ReportSourceProvider {

    private final CoachSessionWork work;
    private final TransactionTemplate transactionTemplate;

    public PostgresCoachSessionRepository(
            CoachSessionWork work,
            PlatformTransactionManager transactionManager) {
        this.work = work;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    @Override
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

    @Override
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

    @Override
    public String getPracticeSessionStatus(UUID userId, UUID practiceSessionId) {
        return transactionTemplate.execute(
                status -> work.practiceSessionStatus(userId, practiceSessionId));
    }

    @Override
    public OwnedPracticeSessionContext getOwnedPracticeSessionContext(
            UUID userId, UUID practiceSessionId) {
        return transactionTemplate.execute(
                status -> work.ownedPracticeSessionContext(userId, practiceSessionId));
    }

    @Override
    public boolean hasReportForPracticeSession(UUID practiceSessionId) {
        return Boolean.TRUE.equals(transactionTemplate.execute(
                status -> work.hasReportForPracticeSession(practiceSessionId)));
    }

    @Override
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

    @Override
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

    @Override
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

    @Override
    public OwnedReportSource getOwnedReportSource(
            UUID userId,
            UUID coachSessionId) {
        return transactionTemplate.execute(
                status -> work.ownedReportSource(userId, coachSessionId));
    }

    @Override
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
            if (source == null) {
                throw new CoachSessionNotFound("coach session not found");
            }
            if (source.handoffId() == null) {
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
