package com.acttub.actingapi.ledger;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 멱등 요청을 시작한 결과. 새로 잡았거나(claim), 같은 요청 ID 로 이미 끝난 응답이 있거나
 * (replayPayload) 둘 중 하나다.
 *
 * <p>재생분을 <b>본문으로</b> 들고 있다. 예전에는 조립된 HTTP 응답을 들고 있었는데, 그러면
 * 원장이 상태코드와 헤더까지 정하게 되어 이 기록을 쓰는 쪽이 스프링 없이는 설 수 없었다.
 */
public record SyncOperationBegin(
        SyncOperationClaim claim,
        JsonNode replayPayload) {

    public static SyncOperationBegin claimed(SyncOperationClaim claim) {
        return new SyncOperationBegin(claim, null);
    }

    public static SyncOperationBegin replayed(JsonNode payload) {
        return new SyncOperationBegin(null, payload);
    }

    public boolean isReplay() {
        return replayPayload != null;
    }
}
