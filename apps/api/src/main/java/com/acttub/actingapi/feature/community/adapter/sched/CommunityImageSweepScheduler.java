package com.acttub.actingapi.feature.community.adapter.sched;

import com.acttub.actingapi.feature.community.app.CommunityImageService;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 글에 붙지 않은 채 24시간 지난 게시판 사진을 매시간 지운다(SOMA-873). 대본 원본 파일 정리
 * ({@code ScriptUploadSweepScheduler})와 같은 형태다. 테스트는 시계를 돌린 뒤 {@link CommunityImageService#sweepUnattached}
 * 를 직접 부른다.
 */
@Component
@ConditionalOnProperty(name = "COMMUNITY_IMAGE_SWEEP_ENABLED", havingValue = "true", matchIfMissing = true)
class CommunityImageSweepScheduler {
    private final CommunityImageService images;
    private final FailureReporter failures;

    CommunityImageSweepScheduler(CommunityImageService images, FailureReporter failures) {
        this.images = images;
        this.failures = failures;
    }

    @Scheduled(cron = "${COMMUNITY_IMAGE_SWEEP_CRON:0 25 * * * *}", zone = "Asia/Seoul")
    void run() {
        try {
            images.sweepUnattached();
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("CommunityImageSweepScheduler.run"));
        }
    }
}
