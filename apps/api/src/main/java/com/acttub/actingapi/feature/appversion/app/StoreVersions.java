package com.acttub.actingapi.feature.appversion.app;

import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.feature.appversion.domain.StorePlatform;
import java.util.Optional;

/**
 * 지금 그 플랫폼 스토어에서 <b>누구나</b> 받을 수 있는 판. iOS 는 한국 App Store 에 보이는 판, 안드로이드는 Play 운영 트랙에서
 * 단계적 출시를 마친(100%) 판이다. 모르면(키 없음·응답 이상·실패) 비어 있고, 그러면 아무것도 바꾸지 않는다.
 */
public interface StoreVersions {

    Optional<AppVersion> live(StorePlatform platform);
}
