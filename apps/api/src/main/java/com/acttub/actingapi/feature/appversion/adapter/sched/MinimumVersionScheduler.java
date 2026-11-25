package com.acttub.actingapi.feature.appversion.adapter.sched;

import com.acttub.actingapi.feature.appversion.app.MinimumVersionService;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.ScheduledTaskLog;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 스토어를 30분마다 보고({@code MIN_VERSION_CHECK_MS}), 올린 최소 판을 1분마다 메모리로 옮긴다(SOMA-1150). 겹쳐 뜬
 * 컨테이너가 같이 돌아도 올리기는 DB 에서 한 번만 일어난다({@code MinimumVersionStore#raise}).
 */
@Component
@ConditionalOnProperty(name = "MIN_VERSION_AUTO_RAISE", havingValue = "true")
class MinimumVersionScheduler {

    private final MinimumVersionService service;
    private final FailureReporter failures;

    MinimumVersionScheduler(MinimumVersionService service, FailureReporter failures) {
        this.service = service;
        this.failures = failures;
    }

    @Scheduled(fixedDelayString = "${MIN_VERSION_REFRESH_MS:60000}", initialDelayString = "0")
    void refresh() {
        try {
            service.refresh();
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("MinimumVersionScheduler.refresh"));
        }
    }

    @Scheduled(fixedDelayString = "${MIN_VERSION_CHECK_MS:1800000}", initialDelayString = "${MIN_VERSION_CHECK_DELAY_MS:60000}")
    void check() {
        long started = System.nanoTime();
        int raised = 0;
        try {
            raised = service.check();
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("MinimumVersionScheduler.check"));
        } finally {
            ScheduledTaskLog.drained("MinimumVersionScheduler.check", raised, started);
        }
    }
}
