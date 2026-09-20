package com.acttub.actingapi.integration.oidc;

/**
 * 네이버 토큰 API. 앱에 client secret 을 두지 않으려고 코드 교환을 서버가 한다(SOMA-528 결정 I-5).
 * 요청 형식은 네이버 로그인 개발가이드 §3.5.6(OIDC 접근 토큰 발급)과 §4.3(Token Revocation)이다.
 */
public interface NaverTokenClient {

    /**
     * authorization code 를 ID 토큰과 refresh token 으로 바꾼다. 코드는 한 번만 쓸 수 있다.
     *
     * @param codeVerifier 앱이 인가 요청에 쓴 PKCE 값
     * @param redirectUri 앱이 인가 요청에 쓴 값. 없으면 {@code null}
     * @param state 앱이 인가 요청에 쓴 값. 없으면 {@code null} — 그때는 난수를 채워 보낸다(발급 때 필수)
     * @throws InvalidIdentityToken 코드·verifier 가 잘못됐거나 이미 쓰였다
     * @throws ProviderConfigurationError Client ID·secret 이 없거나 네이버가 그것을 거절했다
     * @throws ProviderUnavailable 네이버가 답하지 않는다
     */
    NaverGrant exchange(String authorizationCode, String codeVerifier, String redirectUri, String state);

    /**
     * refresh token 을 폐기한다 — 연결된 access token 도 함께 폐기되고 네이버의 "연결된 서비스"에서
     * 빠진다. 이미 폐기된 값이어도 성공이다(네이버가 200 을 준다).
     *
     * @throws ProviderConfigurationError Client ID·secret 이 없다
     * @throws ProviderUnavailable 네이버가 답하지 않거나 거절했다 — 다시 시도한다
     */
    void revoke(String refreshToken);

    /**
     * @param idToken 아직 검증하지 않은 ID 토큰. {@link NaverProviderVerifier} 가 검증한다
     * @param refreshToken 탈퇴 때 폐기에 쓸 값. 네이버가 주지 않았으면 {@code null}
     */
    record NaverGrant(String idToken, String refreshToken) {
    }
}
