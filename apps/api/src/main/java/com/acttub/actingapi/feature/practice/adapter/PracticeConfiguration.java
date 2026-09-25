package com.acttub.actingapi.feature.practice.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.practice.app.LegacyPracticeReader;
import com.acttub.actingapi.feature.practice.app.PracticeRepository;
import com.acttub.actingapi.feature.practice.app.PracticeService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 1.0.0 회차 서비스의 조립. 신형 생성 플래그는 옛 흐름과 같은 환경변수를 읽는다 — 두 흐름이 공존하는 동안
 * 한 스위치로 켜고 끈다(practice.start).
 */
@Configuration
class PracticeConfiguration {

    @Bean
    PracticeService practiceService(
            PracticeRepository practices,
            LegacyPracticeReader legacy,
            @Value("${ACTTUB_THREE_LAYERS_ENABLED:false}") boolean threeLayersEnabled,
            @Value("${ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED:true}") boolean guestDailyAnalysisLimitEnabled,
            Clock clock) {
        return new PracticeService(practices, legacy, threeLayersEnabled, guestDailyAnalysisLimitEnabled, clock);
    }
}
