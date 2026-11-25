package com.acttub.actingapi.feature.appversion.app;

import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.feature.appversion.domain.StorePlatform;

/** 최소 판을 올렸다고 사람에게 알린다. 실패해도 밖으로 던지지 않는다. */
public interface MinimumRaiseNotifier {

    /** @param from 올리기 전 최소 판(없었으면 null) */
    void raised(StorePlatform platform, AppVersion from, AppVersion to, AppVersion store);
}
