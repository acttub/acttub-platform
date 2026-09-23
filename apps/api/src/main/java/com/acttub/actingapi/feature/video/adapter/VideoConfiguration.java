package com.acttub.actingapi.feature.video.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.feature.video.app.VideoRepository;
import com.acttub.actingapi.feature.video.app.VideoService;
import com.acttub.actingapi.feature.video.app.VideoStorage;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 보관함 서비스의 조립. 정리 장부는 장부의 주인인 {@code profile} 이 구현한 포트로 받는다. */
@Configuration
class VideoConfiguration {

    @Bean
    VideoService videoService(
            VideoRepository videos, VideoStorage storage, VideoObjectCleanup cleanup, Clock clock) {
        return new VideoService(videos, storage, cleanup, clock);
    }
}
