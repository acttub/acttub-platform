package com.acttub.actingapi.feature.ads.adapter;

import java.time.Clock;
import java.time.Duration;

import com.acttub.actingapi.feature.ads.app.AdFrequency;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 광고 빈도 상한이 쓰는 노출 기록({@code ad_serves}) 중 하루 지난 것을 한국 시간 새벽에 지운다. 창은 최대 24시간이라 더 필요 없다. */
@Component
@ConditionalOnProperty(name = "ACCOUNT_HOUSEKEEPING_ENABLED", havingValue = "true", matchIfMissing = true)
class AdServesCleanupScheduler {
    static final Duration RETENTION = Duration.ofHours(25);
    private final AdFrequency frequency;
    private final Clock clock;

    AdServesCleanupScheduler(AdFrequency frequency, Clock clock) {
        this.frequency = frequency;
        this.clock = clock;
    }

    @Scheduled(cron = "${AD_SERVES_CLEANUP_CRON:0 40 4 * * *}", zone = "Asia/Seoul")
    void run() {
        frequency.purgeBefore(clock.instant().minus(RETENTION));
    }
}
