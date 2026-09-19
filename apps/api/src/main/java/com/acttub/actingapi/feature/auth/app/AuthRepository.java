package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.domain.RefreshToken;
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
     * 계정·신원·동의 결정을 <b>한 트랜잭션에서</b> 만든다 — 가입 제출이 통과한 순간이다.
     *
     * <p>셋이 함께여야 한다. 계정만 생기고 동의가 빠지면 "동의 없이 개인정보를 갖고 있는" 계정이
     * 남는다.
     *
     * @param email 제공자가 검증한 이메일. 없으면 {@code null}(빈 문자열이 아니다)
     * @param providerTokenEncrypted 탈퇴 때 제공자 쪽 연결을 끊는 데 쓸 토큰의 암호문 — 애플 토큰이나
     *        네이버 refresh token. 그 밖의 제공자는 {@code null}
     * @throws org.springframework.dao.DataIntegrityViolationException 같은 신원이나 같은 이메일의
     *         계정이 그 사이 생겼을 때. 어느 쪽인지는 부르는 쪽이 다시 조회해 가른다
     */
    AuthenticatedUser createAccount(
            String provider,
            String providerUid,
            String email,
            String providerTokenEncrypted,
            List<AcceptedConsent> consents,
            Instant now);

    /**
     * 웹 게스트 — 보통의 {@code users} 행과 {@code provider=guest} 신원 하나. 이메일도 프로필도 없다.
     *
     * @param guestUid 서버가 만든 추측할 수 없는 난수
     */
    AuthenticatedUser createGuest(String guestUid);

    /** 앱으로 옮겨져 닫힌 게스트인가. 갱신의 401 사유를 가르는 데 쓴다. */
    boolean transferredGuest(UUID userId);

    /** 이 계정에 붙어 있는 제공자 이름들. 이메일 겹침 안내("이미 OO로 가입한 이메일이에요")에 쓴다. */
    List<String> providersOf(UUID userId);

    /**
     * 제공자가 준 검증된 이메일로 {@code users.email} 을 맞춘다. 다른 계정이 이미 쓰는 주소면
     * 그대로 둔다 — 오류가 아니다.
     */
    void updateEmailIfFree(UUID userId, String email);

    /**
     * 이미 있는 계정에 신원을 붙인다.
     *
     * @param providerTokenEncrypted {@link #createAccount} 와 같다
     * @throws IdentityAlreadyLinkedError 그 신원이 다른 계정에 물려 있을 때
     */
    void linkIdentity(UUID userId, String provider, String providerUid, String providerTokenEncrypted);

    /** 애플·네이버 신원인데 연결을 끊는 데 쓸 토큰이 아직 없는가. 다른 제공자는 언제나 {@code false}. */
    boolean lacksProviderToken(String provider, String providerUid);

    /** 그 신원의 토큰 암호문을 새 값으로 바꾼다. 애플·네이버 말고는 아무 일도 하지 않는다. */
    void storeProviderToken(String provider, String providerUid, String providerTokenEncrypted);

    /**
     * 제공자 쪽에서 연결이 끊긴 신원 행을 지운다. 계정과 다른 신원은 그대로다. 모르는 신원이면 아무
     * 일도 없다.
     */
    void removeIdentity(String provider, String providerUid);

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
