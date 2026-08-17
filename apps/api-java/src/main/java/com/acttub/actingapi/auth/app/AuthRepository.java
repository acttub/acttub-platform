package com.acttub.actingapi.auth.app;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.auth.domain.RefreshToken;
import com.acttub.actingapi.platform.security.AuthenticatedUser;

/**
 * auth 가 저장소에 요구하는 것 — 계정·신원·refresh 토큰.
 *
 * <p>없음을 {@code null} 로 알린다(ADR-018). 이 포트에서 갈래가 가장 많은 연산은
 * {@link #rotate} 인데, 그것은 실패의 종류를 {@link Rotation} 으로 <b>돌려주지</b> 예외로
 * 던지지 않는다 — 재사용 탐지는 "실패"가 아니라 그 계정의 토큰을 전부 끊어야 하는 사건이라,
 * 부르는 쪽이 두 갈래를 모두 다뤄야 한다.
 *
 * <p>교환 타입 {@link AuthenticatedUser} 가 배관({@code platform/security})의 것인 이유는
 * 7단계에 있다 — 요청 주체를 받는 여덟 도메인이 전부 {@code auth} 를 import 하지 않게 하려면
 * 그 타입이 auth 밖에 있어야 한다(ADR-017).
 */
public interface AuthRepository {

    AuthenticatedUser find(UUID id);

    AuthenticatedUser findByEmail(String email);

    AuthenticatedUser findByIdentity(String provider, String providerUid);

    /**
     * 계정과 신원을 함께 만든다.
     *
     * <p>유입 출처는 <b>가입할 때만</b> 남긴다 — 이미 있는 계정에 다시 붙이면 마지막 로그인
     * 경로가 첫 유입을 덮어써서 집계가 뒤집힌다(원본도 create 경로에만 준다).
     */
    AuthenticatedUser createUserWithIdentity(
            String provider,
            String providerUid,
            String email,
            SignupAttribution attribution);

    /**
     * 이미 있는 계정에 신원을 붙인다.
     *
     * @throws IdentityAlreadyLinkedError 그 신원이 다른 계정에 물려 있을 때
     */
    void linkIdentity(UUID userId, String provider, String providerUid);

    void issueRefresh(UUID userId, String tokenHash, Instant expiresAt, String device, Instant issuedAt);

    /** 없으면 {@code null}. */
    RefreshToken getRefresh(String tokenHash);

    /**
     * 옛 토큰을 새 토큰으로 회전한다. 판정과 교체가 한 트랜잭션·한 잠금 안에서 나야
     * 두 요청이 같은 토큰을 함께 회전시키지 못한다.
     */
    Rotation rotate(
            String oldHash,
            String newHash,
            Instant expiresAt,
            String device,
            Instant now);

    boolean revoke(String tokenHash, Instant now);

    /**
     * 회전의 결과.
     *
     * @param id 새로 발급된 토큰의 식별자. 회전하지 못했으면 {@code null}
     * @param reused 이미 대체된 토큰이 다시 왔는가 — 그때 그 계정의 살아 있는 토큰은 전부 끊긴다
     */
    record Rotation(UUID id, boolean reused) {
    }
}
