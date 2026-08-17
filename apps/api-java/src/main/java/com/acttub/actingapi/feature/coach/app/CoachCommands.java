package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

/**
 * 코치에게 들어오는 요청 셋.
 *
 * <p>요청 DTO 를 그대로 넘기지 않는다 — DTO 는 JSON 표기(스네이크 케이스·unknown key 거부)를
 * 지고 있고, 그 표기는 HTTP 어댑터의 사정이다.
 */
public final class CoachCommands {

    private CoachCommands() {
    }

    /** 대화를 연다. {@code restart} 면 열려 있던 대화를 닫고 새로 시작한다. */
    public record CoachStart(UUID practiceSessionId, boolean restart) {
    }

    /** 배우가 이번 턴에 한 말. */
    public record ActorMessage(UUID coachSessionId, String text) {
    }

    /**
     * 코치가 낸 핸드오프에 대한 배우의 판단.
     *
     * <p>{@code confirmed} 가 거짓이면 {@code rebuttalText} 가 반드시 있다 — 무엇이 아니라고
     * 생각하는지 적히지 않으면 다음 대화가 그것을 쓸 수 없다.
     */
    public record HandoffDecision(UUID coachSessionId, boolean confirmed, String rebuttalText) {
    }
}
