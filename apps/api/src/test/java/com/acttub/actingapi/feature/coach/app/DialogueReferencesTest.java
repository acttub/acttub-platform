package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import com.acttub.actingapi.integration.llm.StructuredJson;
import org.junit.jupiter.api.Test;

class DialogueReferencesTest {
    @Test void roundTripsOnlyKnownLongReferencesAndKeepsDifferentMessagesDistinct() {
        String actor = "turn:11111111-2222-3333-4444-555555555555:3";
        String previous = "turn:11111111-2222-3333-4444-555555555555:1";
        var sources = StructuredJson.MAPPER.createArrayNode();
        sources.addObject().put("id", actor);
        sources.addObject().put("id", previous);
        sources.addObject().put("id", "ref_1");
        var refs = new DialogueReferences(sources, "turn:11111111-2222-3333-4444-555555555555:4");
        var input = StructuredJson.MAPPER.createObjectNode().put("id", actor).put("text", "인용 " + actor);
        input.putArray("source_refs").add(previous).add("ref_1");
        var encoded = refs.toModel(input);
        assertThat(encoded.path("id").asText()).isEqualTo("ref_2");
        assertThat(encoded.path("source_refs").get(0).asText()).isEqualTo("ref_3");
        assertThat(encoded.path("text").asText()).isEqualTo("인용 " + actor);
        assertThat(refs.fromModel(encoded)).isEqualTo(input);
        var response = StructuredJson.MAPPER.createObjectNode().put("message", "ref_2").put("actor_quote", "ref_3");
        response.putArray("known_refs").add("ref_2").add("unknown_ref");
        var restored = refs.fromModel(response);
        assertThat(restored.path("message").asText()).isEqualTo("ref_2");
        assertThat(restored.path("actor_quote").asText()).isEqualTo("ref_3");
        assertThat(restored.path("known_refs").get(0).asText()).isEqualTo(actor);
        assertThat(restored.path("known_refs").get(1).asText()).isEqualTo("unknown_ref");
    }
}
