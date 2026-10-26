package com.acttub.actingapi.integration.revenuecat;

/**
 * RevenueCat 고객 삭제(SOMA-818, account.withdraw). 탈퇴한 사람의 RevenueCat 고객 정보(app_user_id = 우리 user id)를 지운다.
 * 요청은 RevenueCat REST API v1 공식 문서 「Delete Customer」 — {@code DELETE /v1/subscribers/{app_user_id}},
 * {@code Authorization: Bearer <V1 비밀 키>}. 삭제는 RevenueCat 안에서 비동기로 진행되고, 문서는 200 과 404 를 모두
 * "지워졌다"로 보라고 한다.
 */
public interface RevenueCatCustomerClient {

    /** 이 서버가 RevenueCat 을 켰고({@code BILLING_REVENUECAT_ENABLED=true}) 비밀 키가 있는가. 아니면 탈퇴가 삭제를 올리지 않는다. */
    boolean enabled();

    /**
     * 고객을 지운다. 이미 없으면(404) 성공이다.
     *
     * @throws RevenueCatUnavailable 꺼져 있거나, RevenueCat 이 답하지 않거나 거절했다 — 장부가 다시 시도한다
     */
    void delete(String appUserId);
}
