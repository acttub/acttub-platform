package com.acttub.actingapi.feature.coach.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.VideoRecord;
import com.acttub.actingapi.platform.json.LenientJson;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/** 코치 답 하나를 대화에 붙이는 일: 턴 두 개를 더하고, 닫히는 답이면 노트가 읽을 handoff 를 만든다. */
final class CoachTurns {
    private CoachTurns() {
    }

    static CoachResult result(CoachSessionSnapshot session, String actorText, String message,
            ObjectNode state, String endReason) {
        // 저장 턴·handoff·응답이 모두 같은 평문을 쓰도록 여기 한 곳에서 Markdown 기호를 걷는다 (CONTRACT.md §8-5).
        message = PlainCoachText.plain(message);
        if (message.isEmpty()) throw new IllegalStateException("empty coaching reply after removing markup");
        List<CoachTurnSnapshot> turns = new ArrayList<>(session.turns());
        if (actorText != null) { turns.add(new CoachTurnSnapshot("actor", actorText)); }
        turns.add(new CoachTurnSnapshot("ai", message));
        CoachSessionSnapshot next = session.withTurns(turns).withCoachingState(session.experienceVersion(),
                LenientJson.asLong(state.path("revision")), state, endReason == null ? "open" : "closed",
                endReason == null ? "" : endReason);
        ObjectNode handoff = null;
        if (endReason != null) {
            handoff = StructuredJson.MAPPER.createObjectNode().put("schema_version", "acttub.coach_handoff.v2")
                    .put("session_id", session.sessionId().toString()).put("state_revision", next.stateRevision())
                    .put("end_reason", endReason);
            handoff.set("record_ref", VideoRecord.isRecord(session.observationPack())
                    ? VideoRecord.reference(session.observationPack()) : StructuredJson.MAPPER.nullNode());
            handoff.set("context", context(state));
            Map<String, JsonNode> sources = CoachingStateReducer.catalog(state.path("source_catalog"));
            ArrayNode conversation = handoff.putArray("conversation");
            for (int i = 0; i < turns.size(); i++) {
                CoachTurnSnapshot turn = turns.get(i);
                String id = turnId(session, i);
                ObjectNode item = conversation.addObject().put("id", id).put("role", turn.role()).put("text", turn.text());
                sources.put(id, messageSource(item));
            }
            ArrayNode catalog = handoff.putArray("source_catalog");
            sources.values().forEach(catalog::add);
            StructuredJson.validate("coach_handoff_v2", handoff);
        }
        return new CoachResult(next, new CoachReply(message, endReason == null ? "continue" : "complete", handoff));
    }

    /** 노트가 읽을 장면 맥락. 리딩 칸은 비우고, 코치가 제안한 값은 배우의 방향으로 넘기지 않는다. */
    private static ObjectNode context(JsonNode state) {
        ObjectNode context = (ObjectNode) state.path("context").deepCopy();
        context.putNull("reading");
        // An old coach suggestion must never become the actor's direction in the new dialogue.
        if ("coach_proposed".equals(LenientJson.asText(context.path("direction").path("origin")))) {
            context.putNull("direction");
        }
        ObjectNode scene = (ObjectNode) context.path("scene_context");
        for (String key : List.of("situation", "character_goal", "partner_action")) {
            if ("coach_proposed".equals(LenientJson.asText(scene.path(key).path("origin")))) scene.putNull(key);
        }
        return context;
    }

    private static ObjectNode messageSource(JsonNode message) {
        return CoachingStateReducer.source(LenientJson.asText(message.path("id")),
                "actor".equals(LenientJson.asText(message.path("role"))) ? "actor_message" : "coach_message",
                LenientJson.asText(message.path("text")));
    }

    static String turnId(CoachSessionSnapshot session, int index) {
        return "turn:" + session.sessionId() + ":" + index;
    }
}
