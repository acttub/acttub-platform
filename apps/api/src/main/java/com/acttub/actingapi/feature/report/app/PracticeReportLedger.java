package com.acttub.actingapi.feature.report.app;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 성적표 행과 원장 행을 <b>한 트랜잭션에서 함께</b> 남긴다.
 *
 * <p>{@link ReportRepository} 와 나뉘어 있는 이유는 트랜잭션 경계다. 여기 연산은 호출한 쪽의
 * 트랜잭션과 분리된 새 것으로 돌아, 뒤이어 무엇이 실패하더라도 만들어진 성적표와 그것을 끝낸
 * 작업이 함께 남는다. 조회 계열과 같은 포트에 두면 그 차이가 이름에서 사라진다.
 *
 * <p>{@link ReportOperationLedger} 와도 다르다 — 저쪽은 요청 하나를 한 번만 처리하게 하는
 * 멱등 경계이고 {@code operation} 이 구현한다. 이쪽은 성적표를 쓰는 저장 연산이다.
 */
public interface PracticeReportLedger {

    /**
     * 성적표를 남기고 그것을 만든 작업을 성공으로 닫는다.
     *
     * @return 남겼으면 {@code true}. 같은 핸드오프로 이미 성적표가 있으면 {@code false}
     * @throws com.acttub.actingapi.platform.ledger.LeaseOwnershipException 리스를 이미 잃었을 때
     */
    boolean completePracticeReportOperation(
            UUID operationId,
            UUID leaseToken,
            UUID practiceSessionId,
            String reportType,
            JsonNode reportJson,
            UUID sourceHandoffId,
            JsonNode responsePayload,
            Instant now);
}
