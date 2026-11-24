package com.acttub.actingapi.feature.coach.app;

import java.util.LinkedHashMap;
import java.util.Map;

import com.acttub.actingapi.integration.llm.StructuredJson;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import com.acttub.actingapi.platform.json.LenientJson;

/** 코치 대화 상태의 빈 모양과, handoff 가 인용하는 근거 목록을 다루는 도우미. */
final class CoachingStateReducer {
    private CoachingStateReducer() { }

    static ObjectNode empty() {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode().put("revision", 0);
        ObjectNode context = state.putObject("context");
        context.putNull("direction");
        context.putObject("scene_context").putNull("situation").putNull("character_goal")
                .putNull("partner_action");
        context.putNull("focus").putNull("reading").putArray("open_points");
        state.putNull("active_proposal_id");
        state.putArray("proposals");
        state.putArray("attempts");
        state.put("response_style", "normal");
        state.putArray("source_catalog");
        return state;
    }

    static Map<String, JsonNode> catalog(JsonNode array) {
        Map<String, JsonNode> result = new LinkedHashMap<>();
        array.forEach(item -> result.put(LenientJson.asText(item.path("id")), item.deepCopy()));
        return result;
    }

    static ObjectNode source(String id, String kind, String text) {
        return StructuredJson.MAPPER.createObjectNode().put("id", id).put("kind", kind).put("text", text)
                .putNull("record_id").putNull("record_version").putNull("start_ms").putNull("end_ms");
    }

    static void require(boolean condition, String message) {
        if (!condition) { throw new IllegalArgumentException(message); }
    }
}
