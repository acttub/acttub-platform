package com.acttub.actingapi.feature.coach.app;

/**
 * 연습 루프 코치 흐름 비교(SOMA-636 A/B).
 *
 * <p>A는 지금 흐름(첫 질문 → 어긋남을 질문으로 보여 주기 → 해결책을 배우가 찾게 묻기 → 정리), B는 세 단계 흐름
 * (첫 질문 → 코치가 본 근본 문제를 대사와 이유로 먼저 말하기 → 배우의 바람에 맞춘 행동 하나를 제안하는 정리)이다.
 * 첫 응답 전에 한 번 정하고 대화 상태({@code practice_loop.flow})에 남겨, 같은 대화의 다음 턴은 저장된 값을 쓴다.
 * 배포 전에 시작한 대화(저장값 없음)는 A로 끝낸다.
 */
public interface CoachFlows {
    String A = "a";
    String B = "b";

    /** 모두 A. 비교를 끈 상태(롤백)다. */
    CoachFlows NONE = session -> A;

    /** 이 연습의 흐름. A 또는 B. */
    String assign(CoachSessionSnapshot session);
}
