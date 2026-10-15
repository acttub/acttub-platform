package com.acttub.actingapi.feature.profile.adapter.sched;

import com.acttub.actingapi.feature.profile.app.AirbridgeAttributionSync;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 앱이 못 보낸 가입 유입 광고를 Airbridge 에서 가져온다(SOMA-643) — 일은 {@link AirbridgeAttributionSync#runOnce} 가 한다.
 * {@code AIRBRIDGE_API_TOKEN} 이 비어 있으면 이 빈이 서지 않는다. 테스트는 토큰을 주지 않고 {@code runOnce} 를 직접 부른다.
 */
@Component
@ConditionalOnExpression("!'${AIRBRIDGE_API_TOKEN:}'.isBlank()")
class AirbridgeLookupScheduler {

    private final AirbridgeAttributionSync sync;
    private final FailureReporter failureReporter;

    AirbridgeLookupScheduler(AirbridgeAttributionSync sync, FailureReporter failureReporter) {
        this.sync = sync;
        this.failureReporter = failureReporter;
    }

    @Scheduled(
            fixedDelayString = "${AIRBRIDGE_LOOKUP_INTERVAL_MS:300000}",
            initialDelayString = "${AIRBRIDGE_LOOKUP_INITIAL_DELAY_MS:60000}")
    void run() {
        try {
            sync.runOnce();
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("AirbridgeLookupScheduler.run"));
        }
    }
}
