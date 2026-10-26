package com.acttub.actingapi.integration.revenuecat;

/** RevenueCat 이 꺼져 있거나 답하지 않거나 거절했다. 메시지에 비밀 키·사용자 ID 를 싣지 않는다 — 나중에 다시 부른다. */
public class RevenueCatUnavailable extends RuntimeException {
    public RevenueCatUnavailable(String message) {
        super(message);
    }
}
