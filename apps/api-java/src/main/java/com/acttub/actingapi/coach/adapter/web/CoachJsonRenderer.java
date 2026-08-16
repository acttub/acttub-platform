package com.acttub.actingapi.coach.adapter.web;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.coach.adapter.web.CoachDtos.CoachTurnResponse;
import com.acttub.actingapi.coach.adapter.web.CoachDtos.PublicCoachTurn;
import com.acttub.actingapi.coach.adapter.web.CoachDtos.PublicHandoff;
import com.acttub.actingapi.coach.app.CoachReply;
import com.acttub.actingapi.coach.app.CoachResponseRenderer;
import com.acttub.actingapi.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.coach.domain.CoachTurnSnapshot;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

/** 코치 응답의 JSON 표기. 키 이름과 모양은 전부 여기 DTO 가 지고 있다. */
@Component
class CoachJsonRenderer implements CoachResponseRenderer {

    private static final String AI = "ai";
    private static final String CONTINUE = "continue";

    private final ObjectMapper mapper;

    CoachJsonRenderer(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public ObjectNode turn(
            CoachSessionSnapshot session,
            CoachReply reply,
            UUID handoffId,
            String branch,
            JsonNode report) {
        return mapper.valueToTree(new CoachTurnResponse(
                session.sessionId(),
                reply.message(),
                reply.status(),
                publicHandoff(handoffId, branch),
                report,
                publicTurns(session.turns())));
    }

    @Override
    public ObjectNode resumed(CoachSessionSnapshot session) {
        String message = "";
        for (int index = session.turns().size() - 1; index >= 0; index--) {
            CoachTurnSnapshot turn = session.turns().get(index);
            if (AI.equals(turn.role())) {
                message = turn.text();
                break;
            }
        }
        return mapper.valueToTree(new CoachTurnResponse(
                session.sessionId(),
                message,
                CONTINUE,
                null,
                null,
                publicTurns(session.turns())));
    }

    /**
     * 확정 응답만 손으로 조립한다.
     *
     * <p>{@code CoachConfirmResponse} 를 거치지 않는 것은 옮기기 전부터 그랬다 — {@code report} 가
     * 이미 조립된 {@code JsonNode} 라 DTO 를 한 번 더 통과시킬 이유가 없다. 필드 순서와 null 표기는
     * 여기 적힌 그대로가 계약이다.
     */
    @Override
    public ObjectNode confirmation(
            UUID coachSessionId,
            boolean confirmed,
            UUID handoffId,
            String branch,
            JsonNode report) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("session_id", coachSessionId.toString());
        payload.put("confirmed", confirmed);
        PublicHandoff handoff = publicHandoff(handoffId, branch);
        payload.set("handoff", handoff == null ? mapper.nullNode() : mapper.valueToTree(handoff));
        payload.set("report", report);
        return payload;
    }

    private List<PublicCoachTurn> publicTurns(List<CoachTurnSnapshot> turns) {
        return turns.stream()
                .map(turn -> new PublicCoachTurn(turn.role(), turn.text()))
                .toList();
    }

    private PublicHandoff publicHandoff(UUID handoffId, String branch) {
        return handoffId == null ? null : new PublicHandoff(handoffId, branch);
    }
}
