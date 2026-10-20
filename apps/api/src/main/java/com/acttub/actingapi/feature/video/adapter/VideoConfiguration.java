package com.acttub.actingapi.feature.video.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.feature.video.app.VideoPosterWorker;
import com.acttub.actingapi.feature.video.app.VideoRepository;
import com.acttub.actingapi.feature.video.app.VideoService;
import com.acttub.actingapi.feature.video.app.VideoStorage;
import com.acttub.actingapi.integration.media.PosterFrameExtractor;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 보관함 서비스의 조립. 정리 장부는 장부의 주인인 {@code profile} 이 구현한 포트로 받는다. 포스터 추출기는 영상
 * 파이프라인과 같은 ffmpeg 실행이며 테스트가 다른 실행기를 끼울 수 있게 빈으로 둔다.
 */
@Configuration
class VideoConfiguration {

    @Bean
    VideoService videoService(
            VideoRepository videos, VideoStorage storage, VideoObjectCleanup cleanup, Clock clock,
            // 올리기가 끝나면 코칭이 첫 질문용 영상을 미리 준비한다(SOMA-780). 코칭이 꺼져 있으면 없다.
            org.springframework.beans.factory.ObjectProvider<com.acttub.actingapi.feature.video.app.VideoUploadWarmup> warmup) {
        return new VideoService(videos, storage, cleanup, clock,
                warmup.getIfAvailable(() -> com.acttub.actingapi.feature.video.app.VideoUploadWarmup.NONE));
    }

    @Bean
    @ConditionalOnMissingBean
    PosterFrameExtractor posterFrameExtractor() {
        return new PosterFrameExtractor();
    }

    @Bean
    VideoPosterWorker videoPosterWorker(
            VideoRepository videos,
            VideoStorage storage,
            PosterFrameExtractor frames,
            VideoObjectCleanup cleanup,
            FailureReporter failures,
            Clock clock) {
        return new VideoPosterWorker(videos, storage, frames, cleanup, failures, clock);
    }
}
