package com.acttub.actingapi.feature.practice.app;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.domain.AnalysisStatus;
import com.acttub.actingapi.feature.practice.domain.PracticeSession;
import com.acttub.actingapi.feature.practice.domain.SessionDetail;

/**
 * practice 가 저장소에 요구하는 것. 구현은
 * {@code adapter/db/PostgresPracticeSessionRepository} 하나뿐이지만, 선언이 이쪽에 있어야 규칙이
 * 저장 방식을 모른 채로 설 수 있다.
 *
 * <p>조회 계열은 대상이 없으면 {@code null} 을 돌려준다. 없음을 404 로 옮기는 일은 서비스가 한다.
 *
 * <p><b>소유권 검사는 구현이 진다.</b> 모든 메서드가 {@code userId} 를 함께 받고, 조건은 SQL 의
 * {@code WHERE} 에 들어간다 — 행을 먼저 읽어 와 자바에서 비교하면 남의 세션이 존재한다는 사실이
 * 응답 시간에 새어 나간다.
 */
public interface PracticeSessionRepository {

    /** 이 사용자의 업로드 의도가 실재하는지. */
    boolean uploadExists(UUID userId, UUID uploadId);

    PracticeSession find(UUID userId, UUID sessionId);

    List<PracticeSession> list(UUID userId);

    AnalysisStatus status(UUID userId, UUID sessionId);

    /** 이 연습이 어느 연습에서 이어졌는지. 없거나 남의 것·숨긴 것이면 {@code null}. */
    UUID parentOf(UUID userId, UUID sessionId);

    SessionDetail detail(UUID userId, UUID sessionId);

    /** 목록에서 감춘다. 이미 감춰졌거나 남의 것이면 거짓. */
    boolean hide(UUID userId, UUID sessionId, OffsetDateTime now);

    /**
     * 배우의 자기보고를 남긴다. 다시 답하면 덮어쓴다 — 마지막 답이 배우의 답이다.
     * 없거나 남의 것이거나 숨긴 연습이면 거짓.
     */
    boolean recordResolution(
            UUID userId, UUID sessionId, String selfReport, String note, OffsetDateTime now);

    /**
     * 실패한 분석 작업을 다시 대기 상태로 돌린다. 시도 횟수가 소진됐거나 다른 워커가 리스를 쥐고
     * 있으면 거짓 — 호출자는 그것을 409 로 옮긴다.
     */
    boolean resumeFailedOperation(UUID userId, UUID operationId, OffsetDateTime now);
}
