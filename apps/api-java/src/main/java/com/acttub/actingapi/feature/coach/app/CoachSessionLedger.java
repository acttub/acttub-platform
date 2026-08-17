package com.acttub.actingapi.feature.coach.app;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.report.app.OwnedReportSource;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * coach 가 저장소에 요구하는 <b>쓰기</b>. 한 요청이 남기는 것들을 한 트랜잭션에 묶는다 —
 * 세션과 턴, 핸드오프와 그 확정, 성적표, 그리고 그 요청을 끝냈다는 원장 행까지.
 *
 * <p>실패를 <b>예외로</b> 알린다. 조회 포트({@link CoachSessionRepository})가 {@code null} 을 쓰는
 * 것과 다른데, 여기서는 한 연산 안에서 갈릴 것이 여럿이기 때문이다(ADR-018) — 세션이 없다,
 * 그 사이 남이 턴을 덧붙였다, 리스를 이미 잃었다가 서로 다른 응답이 된다.
 *
 * <p>⚠ <b>트랜잭션 경계가 이 포트의 계약이다.</b> 응답 바디만 보는 계약 하네스는 커밋 순서를
 * 보지 못하므로, 구현을 갈아끼울 때 무엇이 무엇과 같은 트랜잭션인지는 사람이 지켜야 한다.
 */
public interface CoachSessionLedger {

    /**
     * 대화를 연 결과를 남긴다 — 세션·턴·핸드오프·성적표와 원장 행이 한 트랜잭션이다.
     *
     * @throws LookupError 원장에 그 작업이 없거나 종류가 다를 때
     * @throws com.acttub.actingapi.platform.ledger.LeaseOwnershipException 리스를 이미 잃었을 때
     */
    boolean completeCoachStartOperation(
            UUID operationId,
            UUID leaseToken,
            CoachSessionSnapshot coachSession,
            JsonNode responsePayload,
            UUID handoffId,
            String branchKind,
            JsonNode handoffJson,
            boolean confirmed,
            JsonNode reportJson,
            boolean restart,
            Instant now);

    /**
     * 이어진 한 턴의 결과를 남긴다.
     *
     * @throws SessionWriteConflict 그 사이 남이 같은 세션에 턴을 덧붙였을 때
     * @throws LookupError 세션이나 원장 작업이 없을 때
     * @throws com.acttub.actingapi.platform.ledger.LeaseOwnershipException 리스를 이미 잃었을 때
     */
    boolean completeCoachReplyOperation(
            UUID operationId,
            UUID leaseToken,
            CoachSessionSnapshot coachSession,
            JsonNode responsePayload,
            UUID handoffId,
            String branchKind,
            JsonNode handoffJson,
            boolean confirmed,
            JsonNode reportJson,
            Instant now);

    /**
     * 가장 최근 핸드오프에 확정 여부를 남기고, 확정이면 세션을 닫는다.
     *
     * <p>이 저장은 <b>자기 트랜잭션으로 먼저 커밋된다.</b> 뒤이어 도는 성적표 생성이 실패해도
     * 배우가 "확인했다"고 누른 사실은 남아야 한다.
     *
     * @return 성적표를 만들 원본 문맥
     * @throws CoachSessionNotFound 세션이 없거나 남의 것일 때
     */
    OwnedReportSource confirmLatestHandoff(
            UUID userId,
            UUID coachSessionId,
            boolean confirmed,
            String rebuttalText,
            Instant now);
}
