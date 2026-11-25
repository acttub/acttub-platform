package com.acttub.actingapi.feature.appversion.app;

import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.feature.appversion.domain.MinimumVersionState;
import com.acttub.actingapi.feature.appversion.domain.StorePlatform;
import java.time.Instant;
import java.util.Map;

/** 플랫폼별 자동 최소 판 기록({@code app_min_versions}). */
public interface MinimumVersionStore {

    Map<StorePlatform, MinimumVersionState> load();

    /** 스토어 판이 바뀐 것을 적는다. 그 판을 처음 본 시각이 {@code now} 가 된다. */
    void observe(StorePlatform platform, AppVersion storeVersion, Instant now);

    /**
     * 최소 판이 아직 {@code from}(null 이면 올린 적 없음)일 때만 {@code to} 로 올린다. 올렸으면 true — 다른 서버(배포 중 겹친
     * 컨테이너)가 먼저 올렸으면 false 라 알림이 두 번 가지 않는다.
     */
    boolean raise(StorePlatform platform, AppVersion from, AppVersion to, Instant now);
}
