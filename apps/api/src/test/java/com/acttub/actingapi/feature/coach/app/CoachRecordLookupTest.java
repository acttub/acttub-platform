package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import java.util.ArrayList;
import java.util.List;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.VideoRecord;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class CoachRecordLookupTest {
    final JsonNode record = StructuredJson.resource("/coaching/record.json");
    final CoachRecordLookup lookup = new CoachRecordLookup();

    ObjectNode request(String selector) {
        ObjectNode request = StructuredJson.MAPPER.createObjectNode();
        request.set("record_ref", VideoRecord.reference(record));
        request.set("selector", StructuredJson.parse(selector));
        request.put("include_neighbors", false);
        request.putArray("dimensions");
        return request;
    }

    static List<String> ids(JsonNode items) {
        List<String> out = new ArrayList<>();
        items.forEach(item -> out.add(item.path("id").asText()));
        return out;
    }

    @Test void aSecondLookupKeepsTheEvidenceOfTheFirst() {
        ObjectNode view = lookup.initial(record);
        view = lookup.merge(view, lookup.lookup(record, request("{\"kind\":\"range\",\"start_ms\":0,\"end_ms\":4000}")));
        assertThat(ids(view.path("segments"))).contains("s1");
        assertThat(ids(view.path("events"))).contains("e1");
        view = lookup.merge(view, lookup.lookup(record, request("{\"kind\":\"utterance\",\"utterance_id\":\"u1\"}")));
        assertThat(ids(view.path("segments"))).contains("s1", "s2").doesNotHaveDuplicates();
        assertThat(ids(view.path("events"))).contains("e1", "e4").doesNotHaveDuplicates();
        assertThat(ids(view.path("speech").path("utterances"))).containsExactly("u1");
        assertThat(ids(view.path("source_catalog"))).contains("e1", "u1", "l1").doesNotHaveDuplicates();
        assertThat(view.path("last_lookup").path("status").asText()).isEqualTo("ok");
        assertThat(view.path("retrieval_status").asText()).isEqualTo("ok");
    }

    @Test void mergingTheSamePageTwiceDoesNotDuplicateSegmentReferences() {
        JsonNode page = lookup.lookup(record, request("{\"kind\":\"utterance\",\"utterance_id\":\"u1\"}"));
        ObjectNode view = lookup.merge(lookup.merge(lookup.initial(record), page), page);
        JsonNode s2 = view.path("segments").get(ids(view.path("segments")).indexOf("s2"));
        assertThat(ids(view.path("segments"))).containsOnlyOnce("s2");
        assertThat(s2.path("event_ids")).hasSize(page.path("segments").get(0).path("event_ids").size());
    }
}
