package com.acttub.actingapi.feature.ads.domain;

/** 광고 칸 규격(SOMA-876). AdMob 의 같은 이름 규격과 크기가 같다. */
public enum AdSize {
    LARGE_BANNER(320, 100),
    BANNER(320, 50),
    MEDIUM_RECTANGLE(300, 250);

    private final int width;
    private final int height;

    AdSize(int width, int height) {
        this.width = width;
        this.height = height;
    }

    public int width() {
        return width;
    }

    public int height() {
        return height;
    }
}
