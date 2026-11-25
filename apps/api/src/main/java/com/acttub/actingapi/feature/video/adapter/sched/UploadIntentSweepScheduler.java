package com.acttub.actingapi.feature.video.adapter.sched;

import com.acttub.actingapi.feature.video.app.VideoService;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.ScheduledTaskLog;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 마무리 없이 시한이 지난 올리기 예약을 닫고 미확정 객체의 삭제를 장부에 올린다 (practice.record). 주기는 옛 분석 워커의
 * 정리({@code ANALYSIS_SWEEP_INTERVAL_SEC}, 기본 60초)와 같다.
 *
 * <p><b>옛 분석 워커의 정리가 같은 일을 겸하고 있어 그 워커를 지울 때까지 둘이 함께 돈다.</b> 이쪽은 예약을
 * {@code FOR UPDATE SKIP LOCKED} 로 잡고 {@code pending} 인 것만 닫고, 옛 쪽은 {@code pending} 인 행만 바꾼다. 그래서 한 예약은
 * 한쪽만 닫고 객체 삭제도 한쪽만 맡는다({@code UploadIntentSweepIT}).
 *
 * <p>스위치는 포스터 워커와 같이 둘이고 둘 다 켜져야 돈다. {@code ANALYSIS_WORKER_ENABLED} 는 옛 정리를 끄는 스위치이기도
 * 하다 — 격리 복원 때 함께 끄는 스위치는 DEPLOY-HOME §7 2단계에 있다. {@code UPLOAD_INTENT_SWEEP_ENABLED} 는 이 일만 끈다.
 * 테스트는 후자를 전역으로 끄고 {@link VideoService#sweepExpiredIntents} 를 직접 부른다.
 */
@Component
@ConditionalOnProperty(
        name = {"ANALYSIS_WORKER_ENABLED", "UPLOAD_INTENT_SWEEP_ENABLED"},
        havingValue = "true",
        matchIfMissing = true)
class UploadIntentSweepScheduler {
    private final VideoService videos;
    private final FailureReporter failures;

    UploadIntentSweepScheduler(VideoService videos, FailureReporter failures) {
        this.videos = videos;
        this.failures = failures;
    }

    @Scheduled(fixedDelayString = "${UPLOAD_INTENT_SWEEP_INTERVAL_MS:60000}", initialDelayString = "0")
    void run() {
        long started = System.nanoTime();
        int swept = 0;
        try {
            // 한 번에 정해진 수만큼 닫는다. 닫을 것이 없을 때까지 이어서 비운다.
            for (int batch = videos.sweepExpiredIntents(); batch > 0; batch = videos.sweepExpiredIntents()) {
                swept += batch;
            }
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("UploadIntentSweepScheduler.run"));
        } finally {
            ScheduledTaskLog.drained("UploadIntentSweepScheduler.run", swept, started);
        }
    }
}
