package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import com.acttub.actingapi.feature.reading.app.SessionViews.RecordingView;
import com.acttub.actingapi.feature.reading.domain.RecordingRules;

/**
 * 녹음 행에 재생 주소를 붙인다 — 짧은 서명 주소(10분)라 저장하지 않고 조회할 때마다 만든다 (reading.recording).
 * 스토리지가 설정돼 있지 않으면 주소와 만료 시각이 {@code null} 이다. 회차 상세와 올리기 응답이 같은 규칙을 쓴다.
 */
public class RecordingPlayback {
    private final RecordingStorage storage;
    private final Clock clock;

    public RecordingPlayback(RecordingStorage storage, Clock clock) {
        this.storage = storage;
        this.clock = clock;
    }

    public RecordingView decorate(RecordingView recording) {
        String url = storage.playbackUrl(recording.objectKey(), RecordingRules.PLAYBACK_TTL_SECONDS);
        Instant expiresAt = url == null
                ? null
                : clock.instant().plus(Duration.ofSeconds(RecordingRules.PLAYBACK_TTL_SECONDS));
        return recording.withPlayback(url, expiresAt);
    }

    public List<RecordingView> decorate(List<RecordingView> recordings) {
        return recordings.stream().map(this::decorate).toList();
    }
}
