package com.acttub.actingapi.feature.coach.app;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import com.fasterxml.jackson.databind.JsonNode;
import com.acttub.actingapi.integration.llm.StructuredJson;

/** Request-local aliases avoid asking the model to copy long storage IDs. Unknown IDs stay invalid. */
final class DialogueReferences {
    private final Map<String, String> encode = new HashMap<>();
    private final Map<String, String> decode = new HashMap<>();

    DialogueReferences(JsonNode sources, String reservedCoachId) {
        Set<String> ids = new java.util.LinkedHashSet<>();
        sources.forEach(source -> ids.add(source.path("id").asText()));
        ids.add(reservedCoachId);
        Set<String> occupied = new HashSet<>(ids);
        int index = 0;
        for (String id : ids) {
            if (id.length() < 32) continue;
            String alias;
            do { alias = "ref_" + ++index; } while (!occupied.add(alias));
            encode.put(id, alias);
            decode.put(alias, id);
        }
    }

    JsonNode toModel(JsonNode value) { return replace(value, encode); }
    JsonNode fromModel(JsonNode value) { return replace(value, decode); }

    private JsonNode replace(JsonNode value, Map<String, String> mapping) {
        if (value.isTextual()) return StructuredJson.MAPPER.getNodeFactory()
                .textNode(mapping.getOrDefault(value.asText(), value.asText()));
        if (value.isObject()) {
            var result = StructuredJson.MAPPER.createObjectNode();
            value.fields().forEachRemaining(field -> result.set(field.getKey(), replace(field.getValue(), mapping)));
            return result;
        }
        if (value.isArray()) {
            var result = StructuredJson.MAPPER.createArrayNode();
            value.forEach(item -> result.add(replace(item, mapping)));
            return result;
        }
        return value.deepCopy();
    }
}
