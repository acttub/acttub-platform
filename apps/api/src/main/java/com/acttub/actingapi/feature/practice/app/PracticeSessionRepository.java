package com.acttub.actingapi.feature.practice.app;

import java.util.UUID;

import com.acttub.actingapi.feature.practice.domain.SessionDetail;

/**
 * practice 가 저장소에 요구하는 것. 구현은
 * {@code adapter/db/PostgresPracticeSessionRepository} 하나뿐이지만, 선언이 이쪽에 있어야 규칙이
 * 저장 방식을 모른 채로 설 수 있다.
 *
 * <p>대상이 없으면 {@code null} 을 돌려준다. 없음을 404 로 옮기는 일은 서비스가 한다.
 *
 * <p><b>소유권 검사는 구현이 진다.</b> {@code userId} 를 함께 받고, 조건은 SQL 의
 * {@code WHERE} 에 들어간다 — 행을 먼저 읽어 와 자바에서 비교하면 남의 세션이 존재한다는 사실이
 * 응답 시간에 새어 나간다.
 */
public interface PracticeSessionRepository {

    SessionDetail detail(UUID userId, UUID sessionId);
}
