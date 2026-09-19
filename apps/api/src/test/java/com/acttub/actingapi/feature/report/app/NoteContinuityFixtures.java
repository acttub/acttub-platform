package com.acttub.actingapi.feature.report.app;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.ArrayNode;

/** Synthetic whole-scene conversation, with no actual user material. */
final class NoteContinuityFixtures {
    static ObjectNode scene() {
        ObjectNode handoff = (ObjectNode) StructuredJson.parse("""
            {"schema_version":"acttub.coach_handoff.v2","session_id":"synthetic-note-scene",
             "state_revision":4,"end_reason":"actor_finished",
             "record_ref":{"record_id":"synthetic-record","version":1,"duration_ms":12000},
             "context":{"direction":null,
               "scene_context":{"situation":null,"character_goal":{
                 "text":"떠나는 걸 막으려는 게 아니라 열쇠를 돌려받으려는 거예요.",
                 "origin":"actor_stated","source_refs":["actor-goal"]},"partner_action":null},
               "focus":{"label":"상대에게 열쇠를 돌려달라고 요구하는 장면","basis":"scene",
                 "scope":"whole_video","pattern":"changing","utterance_ref":"u1","evidence_refs":["u1","u2"]},
               "reading":null,"open_points":[]},"conversation":[],"source_catalog":[]}
            """);
        source(handoff, "u1", "video_utterance", "짐은 다 챙겼네. 열쇠는 놓고 가.", 1000, 4000);
        source(handoff, "u2", "video_utterance", "지난번에도 그냥 갔지. 이번엔 열쇠부터 줘.", 7000, 11000);
        message(handoff, "coach-old", "ai", "떠나는 상대를 붙잡으려는 장면이군요.");
        message(handoff, "actor-goal", "actor", "떠나는 걸 막으려는 게 아니라 열쇠를 돌려받으려는 거예요.");
        message(handoff, "coach-correct", "ai", "상대가 남게 하려는 게 아니라 열쇠를 돌려받으려는 장면이군요.");
        message(handoff, "actor-close", "actor", "여기까지 정리해줘");
        return handoff;
    }

    static ObjectNode output() {
        return (ObjectNode) StructuredJson.parse("""
            {"summary":[{"source_ref":"actor-goal","quote":"떠나는 걸 막으려는 게 아니라 열쇠를 돌려받으려는 거예요."},
              {"source_ref":"u2","quote":"지난번에도 그냥 갔지. 이번엔 열쇠부터 줘."}],
             "next_take":{"instruction":"상대가 열쇠를 돌려주도록 요구하는 데 집중해 장면을 이어가세요.",
               "comparison":"장면의 앞뒤에서 상대를 머물게 하기보다 열쇠를 받으려는 요구가 이어지는지 확인하세요.",
               "basis_refs":["actor-goal","u1","u2"]}}
            """);
    }

    static void message(ObjectNode handoff, String id, String role, String text) {
        ((ArrayNode) handoff.path("conversation")).addObject().put("id", id).put("role", role).put("text", text);
        source(handoff, id, role.equals("actor") ? "actor_message" : "coach_message", text, -1, -1);
    }

    static void source(ObjectNode handoff, String id, String kind, String text, long start, long end) {
        ObjectNode source = ((ArrayNode) handoff.path("source_catalog")).addObject()
                .put("id", id).put("kind", kind).put("text", text);
        if (start >= 0) source.put("record_id", "synthetic-record").put("record_version", 1)
                .put("start_ms", start).put("end_ms", end);
        else source.putNull("record_id").putNull("record_version").putNull("start_ms").putNull("end_ms");
    }
}
