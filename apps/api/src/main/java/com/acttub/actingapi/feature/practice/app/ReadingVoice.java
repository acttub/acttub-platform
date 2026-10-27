package com.acttub.actingapi.feature.practice.app;

import java.util.UUID;

/**
 * 리딩 녹음으로 코칭을 시작할 수 있는지(SOMA-791). 리딩 도메인이 구현한다. 스위치가 꺼진 조립에서는 {@link #OFF} 다.
 */
public interface ReadingVoice {
    ReadingVoice OFF = (userId, readingSessionId) -> Check.OFF;

    Check check(UUID userId, UUID readingSessionId);

    enum Check {
        /** 소리 든 내 대사 녹음이 넉넉하다. */
        READY,
        /** 내 리딩 회차가 아니거나 없다. */
        NOT_FOUND,
        /** 소리 든 내 대사 녹음이 모자란다. */
        NOT_ENOUGH_AUDIO,
        /** 기능 스위치가 꺼져 있다. */
        OFF
    }
}
