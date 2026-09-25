package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

/**
 * 대화가 닫히고 노트까지 남은 뒤에 알린다 (practice.coach → practice.memory).
 *
 * <p>지금 듣는 것은 <b>배우 기억</b> 하나다 — 그 회차를 확인 연습으로 세어 갱신할 때가 됐으면 작업을 예약한다
 * (1·3·6·9…). 무엇을 세고 언제 예약할지는 듣는 쪽이 안다.
 *
 * <p><b>선언이 여기 있는 것은 간선의 방향 때문이다</b>(ADR-019). {@code memory} 가 이미 {@code coach/app} 을
 * 보고 있으므로({@link CoachMemory}) 반대로 코치가 기억을 부르면 두 도메인이 서로를 보게 된다. 그래서
 * {@code AnalysisCompletionListener} 와 같은 형태로 <b>포트를 부르는 쪽에 두고 구현을 듣는 쪽이 낸다</b>.
 *
 * <p>여기서 난 실패가 대화를 되돌리지 않는다 — 기억은 있으면 좋은 것이지 없다고 연습이 망가질 것은 아니다.
 */
public interface ConversationClosedListener {

    /**
     * @param practiceId 닫힌 대화의 회차. 노트를 만들지 않은 종료(기존 갈래의 짧은 대화)도 부른다 —
     *        무엇이 확인 연습인지는 듣는 쪽이 노트로 판정한다
     */
    void onConversationClosed(UUID userId, UUID practiceId);
}
