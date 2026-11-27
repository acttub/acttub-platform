package com.acttub.actingapi.feature.practice.app;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeViews.PreviousConversation;

/**
 * 회차의 <b>이전 대화</b> — 한 연습에 대화가 여럿이던 옛 자료를 보여 주는 자리다(practice.coach).
 *
 * <p>새 표는 회차당 대화 하나이고, 옛 자료를 옮길 때 가장 최근 대화 하나만 새 표로 갔다. 나머지는 옛
 * {@code coach_sessions} 에 그대로 있어 여기서 읽는다. <b>읽기만 한다</b> — 옛 표를 고치거나 지우지 않는다.
 */
public interface PreviousConversations {

    /** 가장 최근 대화를 뺀 옛 대화들, 최근 것부터. 없거나 남의 회차면 빈 목록. */
    List<PreviousConversation> of(UUID userId, UUID practiceId);
}
