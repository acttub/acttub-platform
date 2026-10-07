package com.acttub.actingapi.feature.poster.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.poster.app.PosterImages;
import com.acttub.actingapi.feature.poster.app.PosterRepository;
import com.acttub.actingapi.feature.poster.app.PosterService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 공지 포스터 서비스의 조립. 운영 경로가 꺼진 기동(ADMIN_OPS_TOKEN 없음)에서도 앱 경로가 쓰므로 조건 없이 선다. */
@Configuration
class PosterConfiguration {

    @Bean
    PosterService posterService(PosterRepository posters, PosterImages images, Clock clock) {
        return new PosterService(posters, images, clock);
    }
}
