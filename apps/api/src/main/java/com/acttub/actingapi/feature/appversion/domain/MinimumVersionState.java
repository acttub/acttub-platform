package com.acttub.actingapi.feature.appversion.domain;

import java.time.Instant;

/**
 * 플랫폼 하나의 자동 최소 판 기록. {@code minimum} 은 서버가 올린 최소 판(없으면 null),
 * {@code storeVersion} 은 마지막으로 본 스토어 판, {@code liveSince} 는 그 판을 처음 본 시각이다.
 */
public record MinimumVersionState(
        StorePlatform platform, AppVersion minimum, AppVersion storeVersion, Instant liveSince) {

    public static MinimumVersionState empty(StorePlatform platform) {
        return new MinimumVersionState(platform, null, null, null);
    }
}
