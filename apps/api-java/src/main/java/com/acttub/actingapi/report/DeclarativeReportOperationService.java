package com.acttub.actingapi.report;

import java.time.Instant;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 대안 스타일 — 선언적 {@code @Transactional} 2층 분리. <b>비교 대상</b>이며 채택하지 않았다.
 *
 * <p>바깥 메서드는 트랜잭션이 없고, 트랜잭션은 별도 빈({@link TransactionalRunner})에 있다.
 * 자기호출(self-invocation)이면 프록시를 타지 않아 트랜잭션이 아예 걸리지 않으므로
 * <b>반드시</b> 다른 빈이어야 한다.
 *
 * <p>{@link ReportOperationService} 와 외부 동작은 동일하다 — 두 구현에 같은 테스트를 돌려 확인한다.
 * 채택하지 않은 이유는 M0-findings.md 에 적었다(요약: 빈이 하나 늘고,
 * "이 메서드에는 왜 {@code @Transactional} 이 없는가"라는 자기호출 함정이 영구히 남는다).
 */
@Service
public class DeclarativeReportOperationService {

    private final TransactionalRunner runner;

    public DeclarativeReportOperationService(TransactionalRunner runner) {
        this.runner = runner;
    }

    public ReportCompletion completeReportOperation(UUID operationId, UUID leaseToken,
            UUID coachSessionId, ActingReportPayload report, Instant now) {
        Instant at = now == null ? Instant.now() : now;
        try {
            return runner.run(operationId, leaseToken, coachSessionId, report, at);
        } catch (DataIntegrityViolationException exc) {
            if (DuplicateReportDetector.isDuplicateReport(exc)) {
                return null;
            }
            throw exc;
        }
    }

    /** 트랜잭션 경계 전용 빈. 여기서 던진 예외는 프록시가 롤백한 <i>뒤에</i> 호출자에게 나간다. */
    @Component
    public static class TransactionalRunner {

        private final ReportOperationWork work;

        public TransactionalRunner(ReportOperationWork work) {
            this.work = work;
        }

        @Transactional(propagation = Propagation.REQUIRES_NEW)
        public ReportCompletion run(UUID operationId, UUID leaseToken, UUID coachSessionId,
                ActingReportPayload report, Instant now) {
            return work.execute(operationId, leaseToken, coachSessionId, report, now);
        }
    }
}
