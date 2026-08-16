package com.acttub.actingapi.coach.app;

import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * coach 가 저장소에 요구하는 <b>조회</b>. 남기는 일은 {@link CoachSessionLedger} 가 따로 맡는다 —
 * 그쪽은 세션·핸드오프·원장 행을 한 트랜잭션에서 함께 닫으므로 경계가 다르다.
 *
 * <p>없거나 남의 것이면 {@code null} 이다. 조회 연산은 갈릴 것이 "있다/없다" 하나뿐이라 예외를
 * 쓸 이유가 없다(ADR-018). 없음을 상태코드로 옮기는 일은 {@link CoachService} 가 한다.
 *
 * <p><b>소유권이 인자로 따라다닌다.</b> 코치 세션은 그 연습의 주인에게만 보이고, 숨긴 연습의
 * 것은 주인에게도 보이지 않는다 — 조건은 SQL 의 {@code WHERE} 에 들어간다.
 */
public interface CoachSessionRepository {

    /** 소유권 확인이 끝난 코치 세션. 없거나 남의 것이면 {@code null}. */
    OwnedCoachSessionContext getOwnedCoachSession(UUID userId, UUID coachSessionId);

    /** 그 연습에 아직 열려 있는 가장 오래된 코치 세션. 없으면 {@code null}. */
    OwnedCoachSessionContext getOldestOpenCoachSession(UUID userId, UUID practiceSessionId);

    /** 연습의 분석 상태. 없거나 남의 것이면 {@code null}. */
    String getPracticeSessionStatus(UUID userId, UUID practiceSessionId);

    /** 코치를 시작하는 데 필요한 연습 문맥. 없거나 남의 것이면 {@code null}. */
    OwnedPracticeSessionContext getOwnedPracticeSessionContext(UUID userId, UUID practiceSessionId);

    /** 그 연습에 성적표가 이미 있는지. 있으면 코치를 새로 열지 않는다. */
    boolean hasReportForPracticeSession(UUID practiceSessionId);

    /** 그 핸드오프로 이미 만들어진 성적표. 없으면 {@code null}. */
    JsonNode getPracticeReportForHandoff(UUID handoffId);
}
