package com.acttub.actingapi.integration.airbridge;

/** Airbridge 가 답하지 않거나 거절했다. 메시지에 토큰·기기 ID 를 싣지 않는다 — 나중에 다시 부른다. */
public class AirbridgeUnavailable extends RuntimeException {
    public AirbridgeUnavailable(String message) {
        super(message);
    }

    public AirbridgeUnavailable(String message, Throwable cause) {
        super(message, cause);
    }
}
