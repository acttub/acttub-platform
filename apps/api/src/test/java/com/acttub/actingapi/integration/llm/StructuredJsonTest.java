package com.acttub.actingapi.integration.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** 모델 출력 JSON 은 객체 하나여야 하고, 키가 겹치거나 뒤에 남는 글이 있으면 받지 않는다. */
class StructuredJsonTest {

    @Test
    void parsesASingleObject() {
        assertThat(StructuredJson.parse(" {\"chunk_id\":\"c1\"} ").path("chunk_id").asText()).isEqualTo("c1");
    }

    @Test
    void missingOversizedNonObjectDuplicateOrTrailingOutputIsRejected() {
        assertThatThrownBy(() -> StructuredJson.parse(null)).hasMessage("missing or oversized JSON output");
        assertThatThrownBy(() -> StructuredJson.parse("{\"a\":\"" + "x".repeat(1_500_000) + "\"}"))
                .hasMessage("missing or oversized JSON output");
        assertThatThrownBy(() -> StructuredJson.parse("[{\"a\":1}]")).hasMessage("JSON output must be an object");
        assertThatThrownBy(() -> StructuredJson.parse("")).hasMessage("JSON output must be an object");
        assertThatThrownBy(() -> StructuredJson.parse("{\"a\":1,\"a\":2}")).hasMessage("invalid JSON output");
        assertThatThrownBy(() -> StructuredJson.parse("{\"a\":1} {\"b\":2}")).hasMessage("invalid JSON output");
    }

    @Test
    void unknownContractsAndMissingOrUnreadableResourcesFailLoudly() {
        assertThatThrownBy(() -> StructuredJson.schema("layer9_unknown"))
                .hasMessage("unknown output contract: layer9_unknown");
        assertThatThrownBy(() -> StructuredJson.resource("/coaching/no-such.json"))
                .hasMessage("missing JSON resource: /coaching/no-such.json");
        assertThatThrownBy(() -> StructuredJson.resource("/coaching/video-record-prompt.txt"))
                .hasMessage("cannot read JSON resource: /coaching/video-record-prompt.txt");
        assertThatThrownBy(() -> StructuredJson.textResource("/coaching/no-such.txt"))
                .hasMessage("missing prompt resource: /coaching/no-such.txt");
    }

    @Test
    void schemaCarriesItsReferencedDefinitionsAndTheDraft() {
        var schema = StructuredJson.schema("layer1_chunk");

        assertThat(schema.path("$schema").asText()).isEqualTo("https://json-schema.org/draft/2020-12/schema");
        assertThat(schema.path("$defs").isObject()).isTrue();
        assertThat(StructuredJson.instructions("지침", "layer1_chunk")).startsWith("지침\n\n출력 계약의 실제 JSON Schema:\n{");
    }
}
