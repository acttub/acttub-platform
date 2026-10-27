package com.acttub.actingapi.feature.coach.app;

/**
 * 첫 코칭의 첫 말 비교.
 *
 * <p>A는 지금처럼 질문 한 줄, B는 살아 있는 곳·본 것·다음 테이크를 먼저 말하고 질문을 맨 끝에 붙인다.
 * 대상은 이 배우의 첫 코칭(이전 코치 대화 없음)인 한국어 일반 배우뿐이고, 그 밖은 항상 A다.
 * 첫 응답 전에 한 번 정해 대화 상태({@code practice_loop.opening})에 남기고, 같은 대화의 다음 턴은 저장된 값을 쓴다.
 * 배포 전에 시작한 대화(저장값 없음)는 A로 끝낸다.
 */
public interface CoachOpenings {
    String A = "a";
    String B = "b";

    /** 모두 A. 비교를 끈 상태(롤백)다. */
    CoachOpenings NONE = session -> A;

    /** 이 대화의 첫 말 쪽. A 또는 B. */
    String assign(CoachSessionSnapshot session);
}
