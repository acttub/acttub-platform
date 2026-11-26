package com.acttub.actingapi.feature.video.app;

import java.util.Optional;
import java.util.UUID;

import tools.jackson.databind.JsonNode;

/**
 * 영상의 받아쓰기를 다른 기능이 읽는 자리 (practice.record, ADR-040). 받아쓰기는 영상당 묶음 하나이고 같은 영상의 다음 회차가
 * 그대로 읽는다.
 */
public interface VideoTranscripts {

    /** 다 된({@code ready}) 받아쓰기의 조각들. 없으면 비어 있다. */
    Optional<JsonNode> readySegments(UUID videoId);
}
