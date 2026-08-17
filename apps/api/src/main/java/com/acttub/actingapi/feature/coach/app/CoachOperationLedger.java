package com.acttub.actingapi.feature.coach.app;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.SyncOperationBegin;
import com.acttub.actingapi.platform.ledger.SyncOperationClaim;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * coach 가 멱등 원장에 요구하는 것 (ADR-017, SOMA-397 6단계).
 *
 * <p>코치 대화는 모델을 부르는 동안 사용자가 새로고침하거나 앱이 재시도하는 일이 잦다. 같은
 * 요청 ID 로 두 번 들어온 것을 두 번 처리하지 않는 규칙이 여기 선언돼 있고, 그것을
 * {@code external_operations} 테이블로 구현했다는 사실은 구현하는 쪽만 안다 — coach 는 자기
 * 요구만 적고, {@code operation} 이 그 요구를 받는다.
 *
 * <p>주고받는 타입은 어느 도메인의 것도 아닌 {@code ledger} 의 것이다. 여기에 제공자의 타입을
 * 적으면 "포트로 끊었다"가 이름뿐이 되고, 제공자가 이 인터페이스를 구현하는 순간 패키지 순환이
 * 된다.
 */
public interface CoachOperationLedger {

    /** 헤더의 요청 ID. 없으면 새로 만들고, 형식이 틀리면 422 다. */
    UUID requestId(String header);

    /** 같은 요청 ID 가 같은 내용인지 가릴 지문. */
    String fingerprint(String kind, Object payload);

    /** 작업을 새로 잡거나, 이미 끝난 응답을 되돌려 준다. */
    SyncOperationBegin begin(
            UUID userId,
            UUID practiceSessionId,
            UUID requestId,
            String operationKind,
            String requestFingerprint);

    /** 잡은 작업을 성공으로 닫고 응답 본문을 남긴다. 다음 재시도는 이 본문을 받는다. */
    void complete(SyncOperationClaim claim, JsonNode responsePayload);

    /** 잡은 작업을 실패로 닫는다. 리스를 이미 잃었으면 조용히 넘어간다. */
    void fail(SyncOperationClaim claim, String errorCode);

    /** 원장이 쓰는 시계. 저장 시각을 컨트롤러가 따로 재지 않게 한다. */
    Instant now();
}
