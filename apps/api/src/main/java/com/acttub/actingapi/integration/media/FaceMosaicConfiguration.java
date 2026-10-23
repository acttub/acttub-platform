package com.acttub.actingapi.integration.media;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 코칭 연습의 얼굴 가리기가 쓰는 렌더러. 챌린지 참여작 모자이크와 같은 {@link FaceMosaicRenderer} 다. */
@Configuration(proxyBeanMethods = false)
class FaceMosaicConfiguration {

    /** PATH 에 ffmpeg 가 없으면 {@link FaceMosaic#available()} 가 false 이고, 얼굴 가리기 회차는 실패로 닫힌다. */
    @Bean
    FaceMosaic faceMosaic() {
        return new FaceMosaicRenderer();
    }
}
