package com.acttub.actingapi.feature.practice.app;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeViews.GroupView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.PracticeView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.PreviousConversation;

/**
 * 아직 옮기지 않은 옛 연습을 <b>새 응답 모양</b>으로 읽는다 (02-practice 「1.0.0 스키마 전환」 ②).
 *
 * <p>넓히기와 새 쓰기 사이에는 같은 배우의 자료가 두 표에 나뉘어 있다. 새 조회 API 는 새 표를 먼저 보고
 * 없으면 여기로 온다 — 화면은 어느 표에서 왔는지 알 필요가 없다.
 *
 * <p><b>옛 테이블은 읽기만 한다.</b> 여기서 무엇도 고치거나 지우지 않는다. 전환 명령이 옮기지 않기로 한 자료
 * (가지 친 이어하기, 진행 중 회차 둘)도 이 경로로 계속 보인다.
 *
 * <p>구형 관찰은 <b>요약만</b> 낸다 — 관찰 기록의 상태({@code ready}·{@code partial})까지가 새 모양에 들어가는
 * 전부이고, 구형 분리 배열을 신형 기록으로 위장하지 않는다.
 */
public interface LegacyPracticeReader {

    /** 옛 세션 하나. 이미 옮겼거나 없거나 남의 것이면 {@code null}. */
    PracticeView find(UUID userId, UUID practiceId);

    /** 아직 옮기지 않은 묶음들. 새 묶음 목록의 뒤에 붙는다. */
    List<GroupView> groups(UUID userId, String filter);

    /**
     * 그 회차의 <b>이전 대화</b> — 한 연습에 대화가 여럿인 옛 자료를 보여 주는 자리다(practice.coach).
     *
     * <p>새 표는 회차당 대화 하나라 여기서 나오는 것은 언제나 옛 {@code coach_sessions} 다. 가장 최근 것은
     * "대화" 이고 나머지가 "이전 대화" 다 — 최근 하나로 자르지 않는다.
     */
    List<PreviousConversation> previousConversations(UUID userId, UUID practiceId);
}
