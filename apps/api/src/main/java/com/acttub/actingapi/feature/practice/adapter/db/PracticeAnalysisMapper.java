package com.acttub.actingapi.feature.practice.adapter.db;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.domain.Observation;
import com.acttub.actingapi.feature.practice.domain.VideoRecordSummary;
import com.fasterxml.jackson.databind.JsonNode;

/** 옛·새 저장소가 같은 공개 관찰 요약을 만드는 변환. 내부 출처와 코칭 상태는 옮기지 않는다. */
final class PracticeAnalysisMapper {
    private PracticeAnalysisMapper() { }

    static VideoRecordSummary recordSummary(JsonNode record) {
        return new VideoRecordSummary(UUID.fromString(record.path("record_id").asText()),
                record.path("record_version").asInt(), record.path("media").path("duration_ms").asLong(),
                record.path("processing").path("status").asText(),
                ranges(record.path("processing").path("processed_ranges")),
                ranges(record.path("processing").path("missing_ranges")),
                record.path("overview").path("observed_scene").findValuesAsText("text"),
                record.path("overview").path("spoken_content").findValuesAsText("text"),
                java.util.stream.StreamSupport.stream(record.path("limitations").spliterator(), false)
                        .map(item -> new VideoRecordSummary.Limit(item.path("start_ms").asLong(),
                                item.path("end_ms").asLong(), item.path("description").asText())).toList());
    }

    static List<VideoRecordSummary.Range> ranges(JsonNode ranges) {
        return java.util.stream.StreamSupport.stream(ranges.spliterator(), false)
                .map(range -> new VideoRecordSummary.Range(range.path("start_ms").asLong(),
                        range.path("end_ms").asLong())).toList();
    }

    static List<Observation> observations(JsonNode node) {
        if (node == null) {
            return List.of();
        }
        List<Observation> items = new ArrayList<>();
        // what 은 SOMA-490 이 되살린 이름이고, label 은 그 이전에 저장된 관찰이다.
        // 화면 계약(label)은 그대로 두고 읽는 쪽에서만 둘 다 받는다.
        node.forEach(item -> items.add(new Observation(
                item.path("start_ms").bigIntegerValue(),
                item.path("end_ms").bigIntegerValue(),
                item.has("what") ? item.path("what").textValue() : item.path("label").textValue(),
                item.path("confidence").decimalValue())));
        return List.copyOf(items);
    }

    static List<String> uncertainties(JsonNode node) {
        if (node == null) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        node.forEach(item -> values.add(item.textValue()));
        return List.copyOf(values);
    }

}
