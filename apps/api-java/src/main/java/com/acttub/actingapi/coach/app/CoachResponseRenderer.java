package com.acttub.actingapi.coach.app;

import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 코치 응답의 <b>JSON 표기</b>. 무엇을 담을지는 {@link CoachService} 가 정하고, 그것이 어떤 키로
 * 어떤 모양이 되는지는 web 어댑터가 정한다.
 *
 * <p>포트가 필요한 이유는 이 바이트가 <b>응답이면서 동시에 원장에 남는 값</b>이기 때문이다.
 * 같은 요청이 두 번 들어오면 원장에 남은 것을 그대로 돌려주므로, 조립을 컨트롤러에 두고 서비스가
 * 원장에 넘기는 형태로는 규칙과 표기가 한 요청 안에서 두 번 오간다.
 */
public interface CoachResponseRenderer {

    /** 한 턴의 응답 — 이번 메시지·상태·핸드오프·성적표와 지금까지의 대화. */
    ObjectNode turn(
            CoachSessionSnapshot session,
            CoachReply reply,
            UUID handoffId,
            String branch,
            JsonNode report);

    /**
     * 열려 있던 대화를 이어 받을 때의 응답.
     *
     * <p>마지막 코치 발화를 다시 실어 보낸다 — 배우가 앱을 껐다 켜도 대화가 끊긴 자리에서
     * 이어지게 하기 위해서다.
     */
    ObjectNode resumed(CoachSessionSnapshot session);

    /** 핸드오프를 확정한 응답 — 확정 여부와 그로부터 만들어진 성적표. */
    ObjectNode confirmation(
            UUID coachSessionId,
            boolean confirmed,
            UUID handoffId,
            String branch,
            JsonNode report);
}
