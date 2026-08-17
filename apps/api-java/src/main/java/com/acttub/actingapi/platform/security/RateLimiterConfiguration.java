package com.acttub.actingapi.platform.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 레이트리밋 빈. */
@Configuration
class RateLimiterConfiguration {

    @Bean
    FixedWindowRateLimiter rateLimiter() {
        return new FixedWindowRateLimiter(System::nanoTime);
    }
}
