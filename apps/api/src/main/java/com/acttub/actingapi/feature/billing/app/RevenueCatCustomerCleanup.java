package com.acttub.actingapi.feature.billing.app;

import java.time.Instant;
import java.util.UUID;

/**
 * RevenueCat 고객 삭제를 정리 장부에 올린다 (account.withdraw, SOMA-818).
 *
 * <p>바깥 호출은 커밋 뒤에 장부가 한다. 실패해도 탈퇴는 되돌리지 않고, 5분부터 다시 시도하다 7일 뒤 포기하며 알린다. 선언은
 * 쓰는 쪽(여기)에 있고 구현은 장부의 주인이 한다(ADR-017).
 */
public interface RevenueCatCustomerCleanup {

    /**
     * 부르는 쪽의 트랜잭션에 참여한다.
     *
     * @param appUserIdEncrypted RevenueCat 의 app_user_id(우리 user id)의 암호문. 평문을 넣지 않는다
     * @return 장부의 id
     */
    UUID enqueueCustomerDeletion(UUID userId, String appUserIdEncrypted, Instant now);
}
