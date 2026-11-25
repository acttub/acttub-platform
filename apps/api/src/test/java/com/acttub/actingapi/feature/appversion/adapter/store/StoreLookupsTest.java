package com.acttub.actingapi.feature.appversion.adapter.store;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.appversion.domain.StorePlatform;
import java.time.Clock;
import org.junit.jupiter.api.Test;

class StoreLookupsTest {

    @Test
    void 플랫폼마다_그_스토어를_보고_닿지_않으면_모른다() {
        AppStoreLookup appStore = new AppStoreLookup("http://127.0.0.1:1/lookup", "6793056855", "com.acttub.app",
                AppStoreLookup.builder());
        PlayProductionTrack play = new PlayProductionTrack("", "com.acttub.app", "http://127.0.0.1:1/",
                Clock.systemUTC(), AppStoreLookup.builder());
        StoreLookups stores = new StoreLookups(appStore, play);

        assertThat(stores.live(StorePlatform.IOS)).isEmpty();
        assertThat(stores.live(StorePlatform.ANDROID)).isEmpty();
    }
}
