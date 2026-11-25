package com.acttub.actingapi.feature.appversion.domain;

import java.util.Arrays;
import java.util.Optional;

/** 최소 판을 따로 두는 스토어. {@code key} 는 {@code app_min_versions.platform} 에 적히는 값이다. */
public enum StorePlatform {
    IOS("ios"),
    ANDROID("android");

    private final String key;

    StorePlatform(String key) {
        this.key = key;
    }

    public String key() {
        return key;
    }

    public static Optional<StorePlatform> fromKey(String key) {
        return Arrays.stream(values()).filter(platform -> platform.key.equals(key)).findFirst();
    }
}
