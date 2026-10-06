package com.acttub.actingapi.feature.reading.adapter.sched;

import com.acttub.actingapi.feature.reading.app.ScriptUploadService;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 하루 지나도 어느 대본에도 연결되지 않은 원본 파일을 매시간 지운다 (reading.script 「원본 파일」). 테스트는 시계를 돌린 뒤
 * {@link ScriptUploadService#sweepUnlinked} 를 직접 부른다.
 */
@Component
@ConditionalOnProperty(name = "SCRIPT_UPLOAD_SWEEP_ENABLED", havingValue = "true", matchIfMissing = true)
class ScriptUploadSweepScheduler {
    private final ScriptUploadService uploads;
    private final FailureReporter failures;

    ScriptUploadSweepScheduler(ScriptUploadService uploads, FailureReporter failures) {
        this.uploads = uploads;
        this.failures = failures;
    }

    @Scheduled(cron = "${SCRIPT_UPLOAD_SWEEP_CRON:0 15 * * * *}", zone = "Asia/Seoul")
    void run() {
        try {
            uploads.sweepUnlinked();
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("ScriptUploadSweepScheduler.run"));
        }
    }
}
