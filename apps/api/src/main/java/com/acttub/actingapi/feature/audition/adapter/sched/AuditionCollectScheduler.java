package com.acttub.actingapi.feature.audition.adapter.sched;

import com.acttub.actingapi.feature.audition.app.AuditionService;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 오디션 공고를 매일 07:00·19:00(KST)에 모은다(app.audition). {@code AUDITION_ENABLED=true} 일 때만 선다 — 꺼진
 * 기동은 이 빈이 없어 네트워크를 열 자리 자체가 없다(테스트의 기본이다).
 *
 * <p>기동 뒤 {@code AUDITION_COLLECT_STARTUP_DELAY_MS}(기본 2분)에 한 번 더 본다: 한 번도 모으지 않았거나 마지막
 * 수집이 12시간보다 오래됐으면 그때 모은다. 처음 켠 서버가 다음 07시·19시까지 빈 화면을 내지 않게 하려는 것이고,
 * 평소 배포의 재시작은 마지막 수집이 12시간 안이라 출처에 요청을 더 보내지 않는다.
 */
@Component
@ConditionalOnProperty(name = "AUDITION_ENABLED", havingValue = "true")
class AuditionCollectScheduler {
    private final AuditionService auditions;
    private final FailureReporter failures;

    AuditionCollectScheduler(AuditionService auditions, FailureReporter failures) {
        this.auditions = auditions;
        this.failures = failures;
    }

    @Scheduled(cron = "${AUDITION_COLLECT_CRON:0 0 7,19 * * *}", zone = "Asia/Seoul")
    void collect() {
        try {
            auditions.collect();
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("AuditionCollectScheduler.collect"));
        }
    }

    @Scheduled(initialDelayString = "${AUDITION_COLLECT_STARTUP_DELAY_MS:120000}")
    void collectAfterStartupIfStale() {
        try {
            auditions.collectIfStale();
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("AuditionCollectScheduler.collectAfterStartupIfStale"));
        }
    }
}
