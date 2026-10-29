package com.acttub.actingapi.feature.ads.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.ads.app.AdAdminService;
import com.acttub.actingapi.feature.ads.app.AdImages;
import com.acttub.actingapi.feature.ads.app.AdRepository;
import com.acttub.actingapi.feature.ads.app.AdService;
import com.acttub.actingapi.feature.ads.app.AdSlotSwitches;
import com.acttub.actingapi.feature.ads.app.ProStatusReader;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 광고 칸 서비스의 조립(SOMA-876). Pro 판정은 결제 도메인의 구현이 있으면 그것을, 없으면 항상 무료로 본다. */
@Configuration
class AdConfiguration {

    @Bean
    AdService adService(
            AdRepository repository,
            AdSlotSwitches switches,
            ObjectProvider<ProStatusReader> proStatus,
            Clock clock,
            @Value("${ADS_ENABLED:true}") boolean enabled,
            @Value("${ADS_PRACTICE_SLOT_PERCENT:50}") int practiceSlotPercent) {
        return new AdService(repository, proStatus.getIfAvailable(() -> ProStatusReader.ALWAYS_FREE),
                new AdService.Settings(enabled, practiceSlotPercent), switches, clock);
    }

    @Bean
    AdAdminService adAdminService(AdRepository repository, AdImages images, Clock clock) {
        return new AdAdminService(repository, images, clock);
    }
}
