package com.acttub.actingapi.feature.memory.app;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * memory 가 작업 큐에 요구하는 것 (ADR-017, SOMA-397 6단계).
 *
 * <p>큐가 실제로는 분석과 함께 쓰는 External Operation 원장이라는 사실은 구현만 안다. 워커는
 * "하나 집는다·무엇에 대한 잡인지 본다·성공으로 닫는다·실패로 닫는다" 넷만 알면 되고, 그래야
 * 큐를 바꾸는 일이 워커를 건드리지 않는다.
 *
 * <p>🔎 <b>연산이 둘에서 넷으로 늘어난 것은 6단계가 흘린 것을 회수했기 때문이다</b>(11단계).
 * 앞의 둘만 있던 동안 워커는 나머지를 {@code JdbcTemplate} 으로 직접 쳤고, 그래서 "큐를 바꾸는
 * 일이 워커를 건드리지 않는다"가 실제로는 성립하지 않았다.
 *
 * <p>구현은 제공하는 쪽에 있다 — {@code operation/ExternalOperationMemoryQueue}. 여기서 그 이름을
 * 적는 것은 문서일 뿐이고, memory 는 그 패키지를 import 하지 않는다.
 */
public interface MemoryUpdateQueue {

    /** 갱신 대기 중인 작업 하나를 선점한다. 집을 게 없으면 {@code null}. */
    UUID claimNext(UUID leaseToken, Duration duration, Instant now);

    /** 선점한 작업이 어느 연습의 것인지. */
    UUID practiceSessionOf(UUID operationId);

    /**
     * 작업을 성공으로 닫고 응답 본문을 남긴다. 다음 재시도는 이 본문을 받는다.
     *
     * <p>본문을 만드는 것은 <b>부르는 쪽</b>이다 — {@code coach/app/CoachOperationLedger}·
     * {@code report/app/ReportOperationLedger} 와 같은 형태다. 그 바이트가 곧 계약이라
     * 조립을 원장으로 넘기면 계약이 도메인 밖으로 나간다.
     *
     * @throws LeaseOwnershipException 리스를 이미 다른 워커가 재선점했다
     */
    void complete(UUID operationId, UUID leaseToken, JsonNode responsePayload, Instant now);

    /**
     * 작업을 실패로 닫는다.
     *
     * <p><b>연습 세션 상태는 건드리지 않는다.</b> 배우 입장에서 기억은 있으면 좋은 것이지, 없다고
     * 연습이 망가질 것은 아니다 — 파이썬 {@code fail_external_operation} 의 기본값과 같다.
     *
     * @throws LeaseOwnershipException 리스를 이미 다른 워커가 재선점했다
     */
    void fail(UUID operationId, UUID leaseToken, String errorCode, Instant now);
}
