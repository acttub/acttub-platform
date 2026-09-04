package com.acttub.actingapi.integration.observation;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 구간 하나의 관찰 (SOMA-490 에서 복원).
 *
 * <p>SOMA-302 가 이 자리를 {@code label} 문자열 한 줄로 줄였고, 그 결과 79초 영상이
 * 코치에게 "멈춘 뒤 말한다" 한 줄로 도착했다. 환각을 막으려던 조치였지만 관찰의
 * 정보량까지 함께 잘려 나갔다 — 판정 필드(severity·intent_impact)는 되살리지 않되,
 * 무엇이 보였는지({@code what})·어느 대사에서({@code quote})·어느 축인지
 * ({@code dimension})는 되살린다.
 */
public record ObservationItem(
        @JsonProperty("start_ms") long startMs,
        @JsonProperty("end_ms") long endMs,
        String what,
        String quote,
        String dimension,
        double confidence) {

    public ObservationItem {
        what = what == null ? "" : what;
        quote = quote == null ? "" : quote;
        dimension = dimension == null ? "" : dimension;
    }
}
