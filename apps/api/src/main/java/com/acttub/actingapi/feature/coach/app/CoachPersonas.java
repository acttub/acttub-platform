package com.acttub.actingapi.feature.coach.app;

/**
 * 자문위원 연습의 코치 프롬프트 배정(SOMA-622).
 *
 * <p>할 일·단계·분류는 그대로 두고, 자문위원마다 그 사람에게 맞춘 프롬프트 id 를 준다. 첫 응답 전에 한 번 정하고
 * 대화 상태({@code practice_loop.persona})에 남겨, 같은 대화의 다음 턴은 저장된 값을 쓴다. 예전 대화에 남은 "b1" 은
 * 그 대화가 끝날 때까지 그대로 이어 간다.
 */
public interface CoachPersonas {
    /** 기본 성격. 대화 상태에는 남지만 프롬프트에 덧붙는 글은 없다. */
    String DEFAULT = "a";

    /** 아무도 배정받지 않는다. */
    CoachPersonas NONE = session -> "";

    /** 배정 대상이 아니면 빈 문자열, 대상이면 그 사람의 프롬프트 id. */
    String assign(CoachSessionSnapshot session);
}
