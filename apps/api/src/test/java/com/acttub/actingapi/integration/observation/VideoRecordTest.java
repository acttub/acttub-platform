package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.*;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class VideoRecordTest {
    ObjectNode chunk() { return (ObjectNode) StructuredJson.resource("/coaching/chunk.json").deepCopy(); }
    ObjectNode empty(int duration) {
        return VideoRecord.empty(UUID.randomUUID(), duration, true, new ActorMaterial("", "", "", "그 외", "", duration));
    }
    @Test void rejectsMissingTailBrokenReferencesAndUnknownFields() {
        ObjectNode chunk = chunk();
        VideoRecord.validateChunk(chunk, chunk.path("chunk_id").asText(), 8000);
        ((ObjectNode) chunk.path("segments").get(2)).put("end_ms", 7900);
        assertThatThrownBy(() -> VideoRecord.validateChunk(chunk, chunk.path("chunk_id").asText(), 8000)).hasMessageContaining("final interval");
        ObjectNode broken = chunk();
        ((ObjectNode) broken.path("events").get(0)).put("subject_id", "stranger");
        assertThatThrownBy(() -> VideoRecord.validateChunk(broken, broken.path("chunk_id").asText(), 8000)).hasMessageContaining("subject");
        broken.put("interpretation", "배우는 불안하다");
        assertThatThrownBy(() -> VideoRecord.validateChunk(broken, broken.path("chunk_id").asText(), 8000)).hasMessageContaining("layer1_chunk");
    }
    @Test void rebuildsOnlySegmentIndexesFromOverlappingEvidence() {
        ObjectNode original = chunk();
        ObjectNode broken = original.deepCopy();
        broken.path("segments").forEach(segment -> {
            for (String key : List.of("utterance_ids", "event_ids", "limitation_ids")) {
                ((ObjectNode) segment).putArray(key).add("unknown");
            }
        });
        ObjectNode before = broken.deepCopy();
        ObjectNode repaired = VideoRecord.prepareChunk(broken, broken.path("chunk_id").asText(), 8000);
        // Includes cross-boundary events and excludes utterances ending/starting at the boundary.
        assertThat(repaired).isEqualTo(original);
        assertThat(broken).isEqualTo(before);
        assertThat(VideoRecord.prepareChunk(repaired, repaired.path("chunk_id").asText(), 8000)).isEqualTo(repaired);
    }
    @Test void rebuildingIndexesDoesNotAcceptInvalidEvidenceOrInventMissingCoverage() {
        for (String failure : List.of("subject", "utterance", "range", "duplicate", "coverage", "limitation")) {
            ObjectNode broken = chunk();
            ObjectNode event = (ObjectNode) broken.path("events").get(0);
            switch (failure) {
                case "subject" -> event.put("subject_id", "unknown");
                case "utterance" -> event.putArray("utterance_ids").add("unknown");
                case "range" -> event.put("end_ms", 9000);
                case "duplicate" -> event.put("id", "u1");
                case "coverage" -> ((ObjectNode) broken.path("segments").get(2)).put("end_ms", 7900);
                case "limitation" -> {
                    broken.putArray("limitations");
                    ((ObjectNode) broken.path("segments").get(0).path("channel_status")).put("visual", "unavailable");
                }
            }
            assertThatThrownBy(() -> VideoRecord.prepareChunk(broken, broken.path("chunk_id").asText(), 8000))
                    .as(failure).isInstanceOf(IllegalArgumentException.class);
        }
    }
    @Test void offsetsEverySourceAndPreservesAllObservationsAndWordGaps() {
        ObjectNode record = empty(16000);
        VideoRecord.append(record, chunk().put("chunk_id", "c0"), 0);
        VideoRecord.append(record, chunk().put("chunk_id", "c1"), 8000);
        List<SpeechFacts.Word> words = new ArrayList<>();
        for (int i = 0; i < 20; i++) words.add(new SpeechFacts.Word("말", i * .7, i * .7 + .2));
        VideoRecord.finish(record, SpeechFacts.calculate("말 ".repeat(20), words));
        assertThat(record.path("events")).hasSize(28);
        assertThat(record.path("speech").path("utterances").get(1).path("start_ms").asInt()).isEqualTo(12000);
        assertThat(record.path("speech").path("word_timings").path("items")).hasSize(20);
        assertThat(record.path("speech").path("word_gaps").path("items")).hasSize(19);
        assertThat(record.path("speech").path("status").asText()).isEqualTo("partial");
        assertThat(VideoRecord.sources(record)).containsKey("c1:e4");
        record.path("limitations").forEach(l -> StructuredJson.validate("layer1_limitation", l));
    }
    @Test void partialFailureIsExplicitAndPreservesGoodChunks() {
        ObjectNode record = empty(16000);
        VideoRecord.append(record, chunk(), 0);
        VideoRecord.missing(record, 8000, 16000);
        VideoRecord.finish(record, null);
        assertThat(record.path("processing").path("status").asText()).isEqualTo("partial");
        assertThat(record.path("processing").path("missing_ranges").get(0).path("start_ms").asInt()).isEqualTo(8000);
        assertThat(record.path("speech").path("utterances")).hasSize(1);
        record.path("limitations").forEach(l -> StructuredJson.validate("layer1_limitation", l));
        ObjectNode failed = empty(8000);
        VideoRecord.missing(failed, 0, 8000);
        assertThatThrownBy(() -> VideoRecord.finish(failed, null)).isInstanceOf(SummaryParseError.class);
    }
    @Test void strictJsonRejectsTrailingAndDuplicateFields() {
        assertThatThrownBy(() -> StructuredJson.parse("{} {}"));
        assertThatThrownBy(() -> StructuredJson.parse("{\"action\":\"respond\",\"action\":\"lookup\"}"));
    }
}
