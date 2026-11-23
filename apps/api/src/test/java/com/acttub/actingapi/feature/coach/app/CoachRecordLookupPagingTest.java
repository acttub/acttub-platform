package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.VideoRecord;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import com.acttub.actingapi.platform.json.LenientJson;

/** 코치의 기록 조회: 선택자별 검색, 이웃 구간, 차원 필터, 쪽 나누기와 이어 읽기 토큰, 기록이 없거나 잘못된 요청. */
class CoachRecordLookupPagingTest {
    final JsonNode record = StructuredJson.resource("/coaching/record.json");
    final CoachRecordLookup lookup = new CoachRecordLookup();

    ObjectNode request(JsonNode source, String selector, boolean neighbors, String... dimensions) {
        ObjectNode request = StructuredJson.MAPPER.createObjectNode();
        request.set("record_ref", VideoRecord.reference(source));
        request.set("selector", StructuredJson.parse(selector));
        request.put("include_neighbors", neighbors);
        ArrayNode array = request.putArray("dimensions");
        for (String dimension : dimensions) array.add(dimension);
        return request;
    }

    static List<String> ids(JsonNode items) {
        List<String> out = new ArrayList<>();
        items.forEach(item -> out.add(LenientJson.asText(item.path("id"))));
        return out;
    }

    @Test void aSessionWithoutARecordGetsAnUnavailableView() {
        JsonNode missing = StructuredJson.parse("{\"schema_version\":\"old\"}");
        ObjectNode view = lookup.initial(missing);
        assertThat(view.path("record_ref").isNull()).isTrue();
        assertThat(LenientJson.asText(view.path("coverage").path("status"))).isEqualTo("failed");
        assertThat(LenientJson.asText(view.path("retrieval_status"))).isEqualTo("unavailable");
        assertThat(view.path("source_catalog")).isEmpty();
        ObjectNode request = StructuredJson.MAPPER.createObjectNode();
        request.putObject("record_ref").put("record_id", "r9");
        ObjectNode result = lookup.lookup(missing, request);
        assertThat(LenientJson.asText(result.path("status"))).isEqualTo("unavailable");
        assertThat(LenientJson.asText(result.path("record_ref").path("record_id"))).isEqualTo("r9");
    }

    @Test void rejectsLookupsOutsideTheSessionRecord() {
        ObjectNode other = ((ObjectNode) record.deepCopy()).put("record_id", "someone-else");
        assertThatThrownBy(() -> lookup.lookup(record, request(other, "{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":1000}", false)))
                .hasMessage("lookup record is not the session record");
        assertThatThrownBy(() -> lookup.lookup(record, request(record, "{\"kind\":\"range\",\"start_ms\":3000,\"end_ms\":3000}", false)))
                .hasMessage("lookup range is outside the record");
        assertThatThrownBy(() -> lookup.lookup(record, request(record, "{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":9000}", false)))
                .hasMessage("lookup range is outside the record");
        assertThatThrownBy(() -> lookup.lookup(record, request(record, "{\"kind\":\"frame\",\"at_ms\":10}", false)))
                .hasMessage("unknown lookup selector");
        assertThatThrownBy(() -> lookup.lookup(record, request(record, "{\"kind\":\"query\",\"text\":\"  \"}", false)))
                .hasMessage("empty lookup query");
    }

    @Test void aTextQueryFindsSegmentsWhoseSourcesContainEveryWordAndSearchesTheWholeVideo() {
        ObjectNode found = lookup.lookup(record, request(record, "{\"kind\":\"query\",\"text\":\"음절 길게\"}", false));
        assertThat(LenientJson.asText(found.path("status"))).isEqualTo("ok");
        assertThat(ids(found.path("segments"))).containsExactly("s2");
        assertThat(ids(found.path("events"))).contains("e4");
        assertThat(found.path("searched_ranges").toString()).isEqualTo("[{\"start_ms\":0,\"end_ms\":8000}]");
        ObjectNode none = lookup.lookup(record, request(record, "{\"kind\":\"query\",\"text\":\"웃는다\"}", false));
        assertThat(LenientJson.asText(none.path("status"))).isEqualTo("not_found");
        assertThat(none.path("segments")).isEmpty();
    }

    @Test void neighboursAreAddedAroundAnUtteranceAndAdjacentRangesMerge() {
        ObjectNode result = lookup.lookup(record, request(record, "{\"kind\":\"utterance\",\"utterance_id\":\"u1\"}", true));
        assertThat(ids(result.path("segments"))).containsExactly("s1", "s2", "s3");
        assertThat(result.path("searched_ranges").toString()).isEqualTo("[{\"start_ms\":0,\"end_ms\":8000}]");
        assertThat(LenientJson.asText(result.path("segments").get(0).path("refs_scope"))).isEqualTo("this_page");
        ObjectNode unknown = lookup.lookup(record, request(record, "{\"kind\":\"utterance\",\"utterance_id\":\"u9\"}", true));
        assertThat(LenientJson.asText(unknown.path("status"))).isEqualTo("not_found");
        ObjectNode separate = lookup.lookup(record, request(record, "{\"kind\":\"range\",\"start_ms\":100,\"end_ms\":200}", true));
        assertThat(ids(separate.path("segments"))).containsExactly("s1", "s2");
    }

    @Test void dimensionsLimitObservationsAndDropWordFactsForVisualOnlyRequests() {
        ObjectNode withWords = record.deepCopy();
        ObjectNode timings = (ObjectNode) withWords.path("speech").path("word_timings");
        timings.put("status", "recorded");
        timings.putArray("items").addObject().put("word", "가지").put("start_ms", 4000).put("end_ms", 4600);
        ObjectNode gaze = lookup.lookup(withWords, request(withWords, "{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":8000}", false, "gaze"));
        assertThat(ids(gaze.path("events"))).containsExactly("e1", "e3");
        assertThat(gaze.path("speech").path("word_timings").path("items")).isEmpty();
        ObjectNode voice = lookup.lookup(withWords, request(withWords, "{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":8000}", false, "voice"));
        assertThat(ids(voice.path("events"))).containsExactly("e4", "e10", "e13");
        assertThat(LenientJson.asText(voice.path("speech").path("word_timings").path("status"))).isEqualTo("recorded");
        assertThat(voice.path("speech").path("word_timings").path("items").toString())
                .isEqualTo("[{\"word\":\"가지\",\"start_ms\":4000,\"end_ms\":4600}]");
    }

    @Test void aPartiallyProcessedRecordSaysSo() {
        ObjectNode partial = record.deepCopy();
        ((ArrayNode) partial.path("processing").path("missing_ranges")).addObject().put("start_ms", 7000).put("end_ms", 8000);
        ObjectNode result = lookup.lookup(partial, request(partial, "{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":1000}", false));
        assertThat(LenientJson.asText(result.path("record_status"))).isEqualTo("partial");
    }

    ObjectNode bulky(int events, int repeat) {
        ObjectNode big = record.deepCopy();
        ArrayNode list = big.putArray("events");
        ArrayNode ids = ((ObjectNode) big.path("segments").get(0)).putArray("event_ids");
        for (int i = 0; i < events; i++) {
            list.addObject().put("id", "b" + i).put("subject_id", "p1").put("start_ms", 0).put("end_ms", 4000)
                    .put("channel", "visual").put("dimension", "gaze").put("description", "관찰 " + i + " " + "가".repeat(repeat))
                    .put("timing_basis", "estimated").put("clarity", "clear").putArray("utterance_ids");
            ids.add("b" + i);
        }
        return big;
    }

    @Test void largeResultsArePagedAndTheTokenResumesWhereThePageStopped() {
        ObjectNode big = bulky(60, 400);
        ObjectNode first = request(big, "{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":4000}", false);
        ObjectNode page1 = lookup.lookup(big, first);
        assertThat(LenientJson.asText(page1.path("status"))).isEqualTo("partial");
        assertThat(page1.path("has_more").asBoolean()).isTrue();
        assertThat(page1.toString().length()).isLessThanOrEqualTo(CoachRecordLookup.MAX_RESULT_CHARS);
        List<String> seen = new ArrayList<>(ids(page1.path("events")));
        ObjectNode next = first.deepCopy().put("continuation_token", LenientJson.asText(page1.path("continuation_token")));
        ObjectNode page2 = lookup.lookup(big, next);
        assertThat(ids(page2.path("events"))).doesNotContainAnyElementsOf(seen);
        seen.addAll(ids(page2.path("events")));
        assertThat(seen).startsWith("b0", "b1");

        ObjectNode merged = lookup.merge(lookup.merge(lookup.initial(big), page1), page2);
        assertThat(ids(merged.path("events"))).containsExactlyElementsOf(seen);
        assertThat(LenientJson.asText(merged.path("speech").path("status"))).isEqualTo("recorded");
        assertThat(LenientJson.asText(merged.path("speech").path("word_timings").path("status"))).isEqualTo("unavailable");
    }

    @Test void aTokenFromAnotherRequestOrGarbageIsRejected() {
        ObjectNode big = bulky(60, 400);
        ObjectNode first = request(big, "{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":4000}", false);
        String token = LenientJson.asText(lookup.lookup(big, first).path("continuation_token"));
        ObjectNode otherSelector = request(big, "{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":5000}", false).put("continuation_token", token);
        assertThatThrownBy(() -> lookup.lookup(big, otherSelector)).hasMessage("invalid lookup continuation");
        ObjectNode otherNeighbours = request(big, "{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":4000}", true).put("continuation_token", token);
        assertThatThrownBy(() -> lookup.lookup(big, otherNeighbours)).hasMessage("invalid lookup continuation");
        ObjectNode otherDimensions = request(big, "{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":4000}", false, "gaze").put("continuation_token", token);
        assertThatThrownBy(() -> lookup.lookup(big, otherDimensions)).hasMessage("invalid lookup continuation");
        String beyond = Base64.getUrlEncoder().withoutPadding().encodeToString("{\"offset\":9999}".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> lookup.lookup(big, first.deepCopy().put("continuation_token", beyond))).hasMessage("invalid lookup continuation");
        assertThatThrownBy(() -> lookup.lookup(big, first.deepCopy().put("continuation_token", "not-base64!")))
                .hasMessage("invalid lookup continuation");
    }

    @Test void aSingleFactLargerThanThePageIsReportedInsteadOfLooping() {
        ObjectNode huge = bulky(1, 30_000);
        ObjectNode first = request(huge, "{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":4000}", false);
        ObjectNode segmentOnly = lookup.lookup(huge, first);
        assertThat(LenientJson.asText(segmentOnly.path("status"))).isEqualTo("partial");
        assertThat(segmentOnly.path("events")).isEmpty();
        ObjectNode result = lookup.lookup(huge, first.deepCopy().put("continuation_token", LenientJson.asText(segmentOnly.path("continuation_token"))));
        assertThat(LenientJson.asText(result.path("status"))).isEqualTo("unavailable");
        assertThat(LenientJson.asText(result.path("reason"))).isEqualTo("single_fact_exceeds_budget");
        assertThat(result.path("continuation_token").isNull()).isTrue();
    }

    @Test void theOpeningViewDisclosesWhatItLeftOut() {
        ObjectNode heavy = record.deepCopy();
        ArrayNode utterances = (ArrayNode) heavy.path("speech").path("utterances");
        for (int i = 2; i < 40; i++) {
            utterances.addObject().put("id", "u" + i).put("speaker_id", "p1").put("start_ms", 0).put("end_ms", 100)
                    .put("text", "대사".repeat(150)).put("transcription_status", "clear").put("timing_basis", "estimated");
        }
        ArrayNode limitations = (ArrayNode) heavy.path("limitations");
        limitations.addObject().put("id", "l9").put("start_ms", 0).put("end_ms", 8000).put("subject_id", "p1")
                .put("kind", "visibility").put("description", "한계".repeat(3000)).putArray("dimensions").add("movement");
        heavy.putArray("events");
        ObjectNode view = lookup.initial(heavy);
        assertThat(view.path("utterance_index_complete").asBoolean()).isFalse();
        assertThat(view.path("utterance_index").size()).isLessThan(39);
        assertThat(view.path("limitations_complete").asBoolean()).isFalse();
        assertThat(ids(view.path("source_catalog"))).contains("l1").doesNotContain("l9");
        assertThat(view.path("timeline")).isEmpty();
        assertThat(view.path("timeline_complete").asBoolean()).isTrue();
    }
}
