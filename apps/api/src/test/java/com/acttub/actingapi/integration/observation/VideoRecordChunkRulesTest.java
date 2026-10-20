package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** 청크 검증의 남은 규칙 — 거꾸로 된 구간, 처음이 비는 구간, 채널 한계 없는 일부 기록, 소리 차원의 채널. */
class VideoRecordChunkRulesTest {
    private static ObjectNode chunk() {
        return (ObjectNode) StructuredJson.resource("/coaching/chunk.json").deepCopy();
    }

    private static void assertRejected(ObjectNode chunk, String reason) {
        assertThatThrownBy(() -> VideoRecord.validateChunk(chunk, "example_chunk_01", 8000))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage(reason);
    }

    @Test
    void theFixtureIsAValidChunk() {
        ObjectNode chunk = chunk();

        VideoRecord.validateChunk(chunk, "example_chunk_01", 8000);

        assertThat(chunk.path("segments")).hasSize(3);
    }

    @Test
    void observationThatEndsBeforeItStartsIsAnInvalidRange() {
        ObjectNode chunk = chunk();
        ((ObjectNode) chunk.path("events").get(0)).put("start_ms", 3200).put("end_ms", 3200);

        assertRejected(chunk, "invalid observation range");
    }

    @Test
    void firstSegmentThatDoesNotStartAtZeroLeavesAGap() {
        ObjectNode chunk = chunk();
        ((ObjectNode) chunk.path("segments").get(0)).put("start_ms", 100);

        assertRejected(chunk, "incomplete chunk coverage");
    }

    @Test
    void segmentWithoutRecordedAudioNeedsALimitation() {
        ObjectNode chunk = chunk();
        chunk.putArray("limitations");
        chunk.path("segments").forEach(segment -> ((ObjectNode) segment).putArray("limitation_ids"));
        ((ObjectNode) chunk.path("segments").get(0).path("channel_status")).put("audio", "unavailable");

        assertRejected(chunk, "missing channel limitation");
    }

    @Test
    void voiceObservationMustComeFromTheAudioChannel() {
        ObjectNode chunk = chunk();
        ((ObjectNode) chunk.path("events").get(0)).put("dimension", "voice");

        assertRejected(chunk, "wrong audio channel");
    }

    @Test
    void somethingThatIsNotAVideoRecordHasNoReferenceOrSources() {
        ObjectNode notARecord = StructuredJson.MAPPER.createObjectNode().put("schema_version", "acttub.observation.v1");

        assertThatThrownBy(() -> VideoRecord.reference(notARecord))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("video record is unavailable");
        assertThat(VideoRecord.sources(notARecord)).isEmpty();
        assertThat(VideoRecord.sources(null)).isEmpty();
    }
}
