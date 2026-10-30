package com.acttub.actingapi.feature.reading.app;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/** 리딩 녹음 서버 다시 받아쓰기 큐(V79). */
public interface RetranscribeRepository {

    /** 녹음을 줄 세운다. 같은 녹음이 이미 있으면 새 object_key 로 처음부터 다시 줄 세운다. */
    void enqueue(UUID recordingId, String objectKey, Instant now);

    /** 가장 오래된 대기 건을 임대로 집는다. 없으면 {@code null}. */
    Claimed claimNext(UUID leaseToken, Duration lease, int maxAttempts, Instant now);

    /** {@code since} 뒤에 받아쓰기 모델을 부른 횟수. */
    long transcribedSince(Instant since);

    /** 모델을 부르기 직전에 남긴다 — 호출이 실패해도 하루 한도에 센다. */
    void markTranscribing(UUID recordingId, UUID leaseToken, Instant now);

    /**
     * 받아쓴 글로 녹음의 전사·대조(원문은 녹음을 저장할 때와 같은 내 대사 줄의 소리 낼 글)를 채우고 {@code done} 으로 끝낸다. 그사이 녹음이 바뀌었거나 이미 전사가 있으면 녹음은
     * 건드리지 않고 {@code stale} 로 끝낸다.
     *
     * @return 녹음을 채웠으면 {@code true}
     */
    boolean fill(UUID recordingId, UUID leaseToken, String objectKey, String transcript, Double peakDb, Instant now);

    /** 녹음을 채우지 않고 끝낸다({@code silent}·{@code empty}·{@code stale}). */
    void finish(UUID recordingId, UUID leaseToken, String status, Double peakDb, Instant now);

    /** 실패. {@code retry} 면 다시 줄 세우고 아니면 {@code failed}. */
    void fail(UUID recordingId, UUID leaseToken, String failure, boolean retry, Instant now);

    /** 미뤘다 — 시도 횟수를 되돌리고 다시 줄 세운다(하루 한도). */
    void release(UUID recordingId, UUID leaseToken, Instant now);

    /** @param current 지금 녹음이 아직 줄 세운 그 녹음이고 기기 전사가 비어 있으면 {@code true} */
    record Claimed(UUID recordingId, String objectKey, Integer durationMs, int attempt, boolean current) {
    }
}
