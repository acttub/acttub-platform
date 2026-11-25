package com.acttub.actingapi.feature.appversion.adapter;

import com.acttub.actingapi.feature.appversion.app.MinimumRaiseNotifier;
import com.acttub.actingapi.feature.appversion.app.MinimumVersionService;
import com.acttub.actingapi.feature.appversion.app.MinimumVersionStore;
import com.acttub.actingapi.feature.appversion.app.StoreVersions;
import java.time.Clock;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 스토어를 보고 최소 앱 판을 스스로 올리는 기능(SOMA-1150). {@code MIN_VERSION_AUTO_RAISE=true} 일 때만 선다 — 꺼져 있으면
 * {@code ClientVersionFilter} 는 환경변수 최소 판만 쓴다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "MIN_VERSION_AUTO_RAISE", havingValue = "true")
class AppVersionConfiguration {

    @Bean
    MinimumVersionService minimumVersionService(
            StoreVersions stores,
            MinimumVersionStore store,
            MinimumRaiseNotifier notifier,
            @Value("${MIN_VERSION_SETTLE_HOURS:6}") long settleHours) {
        return new MinimumVersionService(stores, store, notifier, Duration.ofHours(Math.max(0, settleHours)), Clock.systemUTC());
    }
}
