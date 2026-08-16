package com.acttub.actingapi.coach.domain;

import java.util.List;

/**
 * 대화에 성적표를 만들 만큼의 알맹이가 쌓였는지.
 *
 * <p>배우가 실제로 답한 게 거의 없으면 노트를 만들지 않는다. <b>첫 actor 턴은 대화가 아니라</b>
 * 폼에 적은 목표·막힌 지점이므로 빼고 세고, 마치겠다는 말도 답변으로 세지 않는다.
 *
 * <p>대화를 여는 자리({@code coach_start})에는 이 관문을 걸지 않는다. 거기에 걸면 성적표 생성이
 * 한 번도 돌지 않아 파싱 실패(502) 경로가 도달 불가가 되고, 그 502 로 재시도 소진을 확인하는
 * 계약 하네스 시나리오까지 죽는다.
 */
public final class HandoffReadiness {

    private static final int MIN_ANSWERS_FOR_REPORT = 2;
    private static final String ACTOR = "actor";

    private HandoffReadiness() {
    }

    public static boolean hasEnoughAnswers(List<CoachTurnSnapshot> turns) {
        long answered = turns.stream()
                .filter(turn -> ACTOR.equals(turn.role()))
                .skip(1)
                .filter(turn -> !ClosingIntent.isClosing(turn.text()))
                .count();
        return answered >= MIN_ANSWERS_FOR_REPORT;
    }
}
