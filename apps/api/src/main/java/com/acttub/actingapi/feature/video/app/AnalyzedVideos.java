package com.acttub.actingapi.feature.video.app;

import java.time.Instant;
import java.util.UUID;

import tools.jackson.databind.JsonNode;

/**
 * 분석이 영상에서 알아낸 것을 영상 쪽에 적는다 (practice.analyze). 영상과 받아쓰기의 테이블은 {@code video} 의 것이라 분석은
 * 이 Port 로 적는다(ADR-040). 구현은 <b>트랜잭션을 열지 않는다</b> — 분석 결과를 저장하는 트랜잭션에 참여한다.
 */
public interface AnalyzedVideos {

    /** 길이를 모르던(0) 영상에만 적는다. 이미 아는 길이는 덮지 않는다. */
    void recordDuration(UUID videoId, int durationMs, Instant now);

    /**
     * 받아쓰기 묶음을 남긴다. 묶음은 <b>영상당 하나</b>다 — 같은 영상의 다음 회차가 분석돼도 새로 만들지 않고 먼저 만든 묶음이
     * 그대로 쓰인다.
     */
    void keepTranscript(UUID videoId, JsonNode segments, Instant now);
}
