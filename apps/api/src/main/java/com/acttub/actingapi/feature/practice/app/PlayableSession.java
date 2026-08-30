package com.acttub.actingapi.feature.practice.app;

import com.acttub.actingapi.feature.practice.domain.ClosingWords;
import com.acttub.actingapi.feature.practice.domain.ObservationPack;
import com.acttub.actingapi.feature.practice.domain.PracticeSession;

/** 재생 주소까지 붙은 세션 상세. 상세 응답이 필요로 하는 전부다. */
public record PlayableSession(
        PracticeSession session,
        String playbackUrl,
        ObservationPack summary,
        String errorCode,
        String resolutionSelfReport,
        String resolutionNote,
        ClosingWords closing) {
}
