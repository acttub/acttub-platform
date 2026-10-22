package com.acttub.actingapi.feature.practice.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.practice.app.CoachingPlan;
import com.acttub.actingapi.feature.practice.app.LegacyPracticeReader;
import com.acttub.actingapi.feature.practice.app.PracticePosters;
import com.acttub.actingapi.feature.practice.app.PracticeRepository;
import com.acttub.actingapi.feature.practice.app.PracticeService;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 0.1.0 회차 서비스의 조립. 신형 생성 플래그는 옛 흐름과 같은 환경변수를 읽는다 — 두 흐름이 공존하는 동안
 * 한 스위치로 켜고 끈다(practice.start).
 */
@Configuration
class PracticeConfiguration {

    @Bean
    PracticeService practiceService(
            PracticeRepository practices,
            LegacyPracticeReader legacy,
            PracticePosters posters,
            @Value("${ACTTUB_THREE_LAYERS_ENABLED:false}") boolean threeLayersEnabled,
            @Value("${ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED:true}") boolean guestDailyAnalysisLimitEnabled,
            ObjectProvider<CoachingPlan> plan,
            Clock clock) {
        // 무료 코칭 한도(SOMA-818)는 결제 도메인이 구현한다. 그 빈이 없는 조립(좁은 테스트 등)에서는 한도가 없다.
        return new PracticeService(practices, legacy, posters, threeLayersEnabled, guestDailyAnalysisLimitEnabled,
                plan.getIfAvailable(() -> CoachingPlan.UNLIMITED), clock);
    }
}
