package com.acttub.actingapi.feature.billing.adapter.sched;

import com.acttub.actingapi.feature.billing.app.RenewalWorker;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 매월 자동결제(SOMA-818). {@code BILLING_WEB_ENABLED=true} 일 때만 뜨고 provider 가 toss 인 구독만 처리한다. 돌 때마다 할 일(기간이 끝난 구독·다시 시도할
 * 구독·결과를 모르는 결제)이 없을 때까지 하나씩 처리한다 — 점유는 {@code FOR UPDATE SKIP LOCKED} 라 서버가 둘이어도 겹치지 않는다.
 */
@Component
@ConditionalOnProperty(name = "BILLING_WEB_ENABLED", havingValue = "true")
class BillingRenewalScheduler {
    /** 한 번에 처리하는 최대 개수 — 토스가 느려도 한 주기가 끝없이 늘어나지 않게 한다. */
    static final int MAX_PER_RUN = 200;

    private final RenewalWorker worker;
    private final FailureReporter failures;

    BillingRenewalScheduler(RenewalWorker worker, FailureReporter failures) {
        this.worker = worker;
        this.failures = failures;
    }

    @Scheduled(fixedDelayString = "${BILLING_RENEWAL_POLL_MS:600000}",
            initialDelayString = "${BILLING_RENEWAL_INITIAL_DELAY_MS:120000}")
    void run() {
        try {
            for (int i = 0; i < MAX_PER_RUN && worker.runOnce(); i++) {
                // 할 일이 없을 때까지.
            }
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("BillingRenewalScheduler.run"));
        }
    }
}
