package com.acttub.actingapi.feature.practice.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.practice.app.CoachingPlan;
import com.acttub.actingapi.feature.practice.app.CoachingRewardRepository;
import com.acttub.actingapi.feature.practice.app.PracticePosters;
import com.acttub.actingapi.feature.practice.app.PracticeRepository;
import com.acttub.actingapi.feature.practice.app.PracticeService;
import com.acttub.actingapi.feature.practice.app.PreviousConversations;
import com.acttub.actingapi.feature.practice.app.RewardedCoachingService;
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
            PreviousConversations previousConversations,
            PracticePosters posters,
            @Value("${ACTTUB_THREE_LAYERS_ENABLED:false}") boolean threeLayersEnabled,
            @Value("${ACTTUB_GUEST_DAILY_ANALYSIS_LIMIT_ENABLED:true}") boolean guestDailyAnalysisLimitEnabled,
            ObjectProvider<CoachingPlan> plan,
            ObjectProvider<com.acttub.actingapi.feature.practice.app.ReadingVoice> readingVoice,
            ObjectProvider<com.acttub.actingapi.feature.practice.app.PracticeGroupErasure> groupErasure,
            RewardedCoachingService rewardedCoaching,
            Clock clock) {
        // 무료 코칭 한도(SOMA-818)는 결제 도메인이 구현한다. 그 빈이 없는 조립(좁은 테스트 등)에서는 한도가 없다.
        // 리딩 녹음으로 시작하는 코칭(SOMA-791)은 리딩 도메인이 확인한다. 스위치가 꺼졌으면 그 빈이 없고 시작은 404 다.
        // 보상형 광고로 받은 1회(SOMA-1067)는 스위치가 꺼져 있으면 0 을 더한다.
        return new PracticeService(practices, previousConversations, posters, threeLayersEnabled, guestDailyAnalysisLimitEnabled,
                plan.getIfAvailable(() -> CoachingPlan.UNLIMITED), clock)
                .withReadingVoice(readingVoice.getIfAvailable(() -> com.acttub.actingapi.feature.practice.app.ReadingVoice.OFF))
                .withGroupErasure(groupErasure.getIfAvailable())
                .withCoachingBonus(rewardedCoaching);
    }

    /**
     * 무료 코칭 한도 뒤 「광고 보고 1회 더」(SOMA-1067). 기본은 꺼짐이고 하루 1회다. 장부 빈이 없는 조립(좁은 테스트 등)에서는
     * 스위치와 상관없이 꺼진다 — 꺼진 서비스는 장부를 읽지 않는다.
     */
    @Bean
    RewardedCoachingService rewardedCoachingService(
            @Value("${COACHING_REWARDED_AD_ENABLED:false}") boolean enabled,
            @Value("${COACHING_REWARDED_AD_DAILY_LIMIT:1}") int dailyLimit,
            ObjectProvider<CoachingPlan> plan,
            ObjectProvider<CoachingRewardRepository> rewards,
            Clock clock) {
        CoachingRewardRepository repository = rewards.getIfAvailable();
        return new RewardedCoachingService(enabled && repository != null, dailyLimit,
                plan.getIfAvailable(() -> CoachingPlan.UNLIMITED), repository, clock);
    }
}
