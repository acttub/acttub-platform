package com.acttub.actingapi.feature.practice.adapter.db;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.domain.Observation;
import com.acttub.actingapi.feature.practice.domain.VideoRecordSummary;
import tools.jackson.databind.JsonNode;
import com.acttub.actingapi.platform.json.LenientJson;

/** 옛·새 저장소가 같은 공개 관찰 요약을 만드는 변환. 내부 출처와 코칭 상태는 옮기지 않는다. */
final class PracticeAnalysisMapper {
    private PracticeAnalysisMapper() { }

    static VideoRecordSummary recordSummary(JsonNode record) {
        return new VideoRecordSummary(UUID.fromString(LenientJson.asText(record.path("record_id"))),
                LenientJson.asInt(record.path("record_version")), LenientJson.asLong(record.path("media").path("duration_ms")),
                LenientJson.asText(record.path("processing").path("status")),
                ranges(record.path("processing").path("processed_ranges")),
                ranges(record.path("processing").path("missing_ranges")),
                record.path("overview").path("observed_scene").findValuesAsString("text"),
                record.path("overview").path("spoken_content").findValuesAsString("text"),
                java.util.stream.StreamSupport.stream(record.path("limitations").spliterator(), false)
                        .map(item -> new VideoRecordSummary.Limit(LenientJson.asLong(item.path("start_ms")),
                                LenientJson.asLong(item.path("end_ms")), LenientJson.asText(item.path("description")))).toList());
    }

    static List<VideoRecordSummary.Range> ranges(JsonNode ranges) {
        return java.util.stream.StreamSupport.stream(ranges.spliterator(), false)
                .map(range -> new VideoRecordSummary.Range(LenientJson.asLong(range.path("start_ms")),
                        LenientJson.asLong(range.path("end_ms")))).toList();
    }

    static List<Observation> observations(JsonNode node) {
        if (node == null) {
            return List.of();
        }
        List<Observation> items = new ArrayList<>();
        // what 은 SOMA-490 이 되살린 이름이고, label 은 그 이전에 저장된 관찰이다.
        // 화면 계약(label)은 그대로 두고 읽는 쪽에서만 둘 다 받는다.
        node.forEach(item -> items.add(new Observation(
                LenientJson.bigIntegerValue(item.path("start_ms")),
                LenientJson.bigIntegerValue(item.path("end_ms")),
                item.has("what") ? item.path("what").stringValue(null) : item.path("label").stringValue(null),
                LenientJson.decimalValue(item.path("confidence")))));
        return List.copyOf(items);
    }

    static List<String> uncertainties(JsonNode node) {
        if (node == null) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        node.forEach(item -> values.add(item.stringValue(null)));
        return List.copyOf(values);
    }

}
