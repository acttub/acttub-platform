package com.acttub.actingapi.platform.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/**
 * 레이트리밋 빈을 프로파일로 가른다.
 *
 * <p>{@code advanceContractClock}·{@code reset}은 하네스 제어 표면의 것이다. 부르는
 * 곳은 {@code HarnessController} 하나뿐이고 그것도 contract 프로파일에서만 뜨지만,
 * 운영 빈이 그 메서드를 실행할 수 있는 상태로 두면 방어가 호출처 하나에만 걸린다.
 * 빈을 나눠 운영 쪽에서는 제어 자체가 거부되게 한다.
 */
@Configuration
class RateLimiterConfiguration {

    @Bean
    @Profile("!contract")
    FixedWindowRateLimiter rateLimiter() {
        return new FixedWindowRateLimiter(System::nanoTime, false);
    }

    @Bean
    @Profile("contract")
    FixedWindowRateLimiter contractRateLimiter() {
        return new FixedWindowRateLimiter(System::nanoTime, true);
    }
}
