package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

/**
 * 무료 코칭 한 번에 배우가 답할 수 있는 수(SOMA-1131). 0 이하면 무료 상한이 없다 — Pro·기존 회원 유예·한도 꺼짐이 그렇다.
 * 구현은 결제 쪽(billing adapter)에 있다 — 코치가 결제 도메인을 직접 보지 않게 한다({@link CoachPro}와 같은 모양).
 *
 * <p>"배우 답"은 첫 코치 응답 뒤 배우가 보낸 턴 수다(버튼 답도 하나). 그래서 코치 응답 상한(시작 응답 포함)은 답 수 + 1 이다.
 */
@FunctionalInterface
public interface CoachFreeReplies {
    int actorReplies(UUID userId);

    /** 무료 상한 없음(롤백·테스트용). */
    CoachFreeReplies NONE = userId -> 0;

    /**
     * 이 배우에게 걸리는 코치 응답 상한(시작 응답 포함). 없으면 0. 판정이 깨지면 상한을 걸지 않는다 — 코칭은 이어 간다.
     */
    static int coachReplyCap(CoachFreeReplies free, UUID userId) {
        if (free == null || userId == null) return 0;
        int answers;
        try {
            answers = free.actorReplies(userId);
        } catch (RuntimeException failure) {
            return 0;
        }
        return answers <= 0 ? 0 : answers + 1;
    }

    /** 기본 상한에 무료 상한을 씌운다. 무료 상한이 없거나 기본 상한보다 크면 기본 상한 그대로다. */
    static int within(int standard, int freeCap) {
        return freeCap > 0 ? Math.min(standard, freeCap) : standard;
    }
}
