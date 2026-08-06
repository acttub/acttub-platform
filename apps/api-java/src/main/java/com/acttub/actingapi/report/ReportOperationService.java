package com.acttub.actingapi.report;

import java.time.Instant;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * <b>M0 에서 채택한 스타일</b> — {@link TransactionTemplate} 로 경계를 코드 안에 명시한다.
 *
 * <p>원본 Python:
 * <pre>
 * db = self._session_factory()
 * try:
 *     with db.begin():        # 트랜잭션
 *         ...
 *         return payload
 * except IntegrityError as exc:   # 트랜잭션 '밖'
 *     if self._is_duplicate_report_error(exc): return None
 *     raise
 * finally:
 *     db.close()
 * </pre>
 *
 * <p>핵심은 <b>무결성 위반을 트랜잭션 경계 바깥에서 잡아 정상 응답(null)으로 바꾼다</b>는 것이다.
 * Postgres 는 statement 하나가 실패하면 트랜잭션 전체를 abort 시키므로
 * (<i>current transaction is aborted, commands ignored until end of transaction block</i>)
 * 예외를 트랜잭션 <i>안에서</i> 삼키고 작업을 계속하거나 커밋할 수 없다.
 * 즉 이 구조는 취향이 아니라 필수다.
 *
 * <p>{@code @Transactional} 한 개짜리 메서드 안에서 try/catch 하는 순진한 이식이 왜 깨지는지는
 * {@code NaiveReportOperationServiceTest} 가 실제로 재현한다.
 */
@Service
public class ReportOperationService {

    private final TransactionTemplate transactionTemplate;
    private final ReportOperationWork work;

    public ReportOperationService(PlatformTransactionManager transactionManager,
            ReportOperationWork work) {
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        // 워커 스레드에서 불리고 바깥 트랜잭션에 얹히면 안 된다 (/SPEC.md §5-4-1).
        this.transactionTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.work = work;
    }

    /**
     * @return payload, 또는 이미 리포트가 있으면 {@code null}
     *         (사전 확인으로 잡힌 경우와 커밋 경쟁으로 잡힌 경우 <b>둘 다</b> null 이다)
     * @throws LeaseOwnershipException 리스를 다른 워커가 재선점했다
     */
    public ReportCompletion completeReportOperation(UUID operationId, UUID leaseToken,
            UUID coachSessionId, ActingReportPayload report, Instant now) {
        Instant at = now == null ? Instant.now() : now;
        try {
            return transactionTemplate.execute(
                    status -> work.execute(operationId, leaseToken, coachSessionId, report, at));
        } catch (DataIntegrityViolationException exc) {
            // 경로 (3): 사전 SELECT 를 통과했지만 reports_session_id_key 로 막힌 경쟁 조건.
            // 원본과 동일하게 정상 응답 null 로 바꾼다. 다른 무결성 위반은 그대로 올린다.
            if (DuplicateReportDetector.isDuplicateReport(exc)) {
                return null;
            }
            throw exc;
        }
    }
}
