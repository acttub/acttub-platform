package com.acttub.actingapi.feature.reading.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.reading.app.ReadingRecordingCleanup;
import com.acttub.actingapi.feature.reading.app.ScriptRepository;
import com.acttub.actingapi.feature.reading.app.ScriptService;
import com.acttub.actingapi.feature.reading.app.SessionRepository;
import com.acttub.actingapi.feature.reading.app.SessionService;
import com.acttub.actingapi.platform.web.CanonicalJson;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 리딩 서비스의 조립. 정리 장부는 장부의 주인인 {@code profile} 이 구현한 포트로 받는다. */
@Configuration
class ReadingConfiguration {

    @Bean
    ScriptService scriptService(
            ScriptRepository scripts, ReadingRecordingCleanup cleanup, CanonicalJson canonical, Clock clock) {
        return new ScriptService(scripts, cleanup, canonical, clock);
    }

    @Bean
    SessionService sessionService(SessionRepository sessions, ReadingRecordingCleanup cleanup, Clock clock) {
        return new SessionService(sessions, cleanup, clock);
    }
}
