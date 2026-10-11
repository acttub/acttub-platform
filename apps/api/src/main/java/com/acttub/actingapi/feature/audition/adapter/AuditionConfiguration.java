package com.acttub.actingapi.feature.audition.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.audition.app.AuditionRepository;
import com.acttub.actingapi.feature.audition.app.AuditionService;
import com.acttub.actingapi.feature.audition.app.AuditionSettings;
import com.acttub.actingapi.feature.audition.app.AuditionSources;
import com.acttub.actingapi.feature.audition.domain.AuditionRules;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 오디션 공고 모아보기의 조립. 꺼진 기동({@code AUDITION_ENABLED=false}, 기본)에도 서비스는 선다 — 목록 경로가 빈
 * {@code items} 를 내야 하기 때문이다. 수집 스케줄러만 켜졌을 때 선다({@code AuditionCollectScheduler}).
 */
@Configuration
class AuditionConfiguration {

    @Bean
    AuditionSettings auditionSettings(
            @Value("${AUDITION_ENABLED:false}") boolean enabled,
            @Value("${AUDITION_SOURCES:" + AuditionRules.DEFAULT_SOURCES + "}") String sources) {
        return AuditionSettings.of(enabled, sources);
    }

    @Bean
    AuditionService auditionService(AuditionSettings settings, AuditionSources sources,
            AuditionRepository postings, FailureReporter failures, Clock clock) {
        return new AuditionService(settings, sources, postings, failures, clock);
    }
}
