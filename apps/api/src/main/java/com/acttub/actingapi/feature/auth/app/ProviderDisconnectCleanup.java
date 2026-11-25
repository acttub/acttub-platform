package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 제공자 해제(애플 토큰 폐기, 카카오 연결 끊기, 네이버 연동 해제)를 정리 장부에 올린다 (account.withdraw).
 *
 * <p>신원의 값은 탈퇴 트랜잭션에서 지워지므로, 해제에 쓸 값을 <b>지우기 전에</b> 장부로 옮긴다. 바깥 호출은 커밋 뒤에 장부가
 * 한다. 선언은 쓰는 쪽(여기)에 있고 구현은 장부의 주인이 한다(ADR-017).
 */
public interface ProviderDisconnectCleanup {

    /**
     * 부르는 쪽의 트랜잭션에 참여한다.
     *
     * @param kind {@code apple_revoke}·{@code kakao_unlink}·{@code naver_revoke}
     * @param payloadEncrypted 해제에 쓸 값의 암호문. 평문을 넣지 않는다
     * @return 장부의 id
     */
    UUID enqueue(UUID userId, String kind, String payloadEncrypted, Instant now);
}
