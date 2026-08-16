package com.acttub.actingapi.platform.harness;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration
@Profile("contract")
public class HarnessConfiguration {
    @Bean
    OffsettableClock applicationClock() {
        return new OffsettableClock();
    }
}
