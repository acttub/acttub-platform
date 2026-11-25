package com.acttub.actingapi.feature.appversion.adapter.store;

import com.acttub.actingapi.feature.appversion.app.StoreVersions;
import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.feature.appversion.domain.StorePlatform;
import java.util.Optional;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** 플랫폼마다 그 스토어를 본다 — iOS 는 App Store 공개 조회, 안드로이드는 Play 운영 트랙. */
@Component
@ConditionalOnProperty(name = "MIN_VERSION_AUTO_RAISE", havingValue = "true")
class StoreLookups implements StoreVersions {

    private final AppStoreLookup appStore;
    private final PlayProductionTrack play;

    StoreLookups(AppStoreLookup appStore, PlayProductionTrack play) {
        this.appStore = appStore;
        this.play = play;
    }

    @Override
    public Optional<AppVersion> live(StorePlatform platform) {
        return switch (platform) {
            case IOS -> appStore.live();
            case ANDROID -> play.live();
        };
    }
}
